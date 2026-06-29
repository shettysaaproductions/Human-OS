import { create } from 'zustand';
import { chatService } from '../services/chatService';
import { localDatabase } from '../services/localDatabase';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'sending' | 'sent' | 'error';
  errorMessage?: string;
  timestamp: string;
}

export interface ChatDiagnostics {
  apiCount: number;
  storeCount: number;
  oldestTimestamp: string;
  newestTimestamp: string;
  activeUserId: string;
  activeConversationId: string;
}

interface ChatState {
  messages: Message[];
  conversationId: string | null;
  isTyping: boolean;
  isHydrated: boolean;
  pendingQueue: { id: string, content: string }[];
  diagnostics: ChatDiagnostics | null;
  
  hydrateMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
  processQueue: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => {
  const processQueue = async () => {
    const state = get();
    if (state.pendingQueue.length === 0) {
      set({ isTyping: false });
      return;
    }

    set({ isTyping: true });

    // Grab everything in queue
    const batch = [...state.pendingQueue];
    set({ pendingQueue: [] });

    const combinedContent = batch.map(q => q.content).join('\n\n');
    const batchIds = batch.map(q => q.id);

    try {
      const { reply, conversation_id } = await chatService.sendMessage(combinedContent, get().conversationId || undefined);
      
      const novaMsg: Message = {
        id: Date.now().toString() + '_nova',
        role: 'assistant',
        content: reply,
        status: 'sent',
        timestamp: new Date().toISOString()
      };

      // Save Assistant response to SQLite
      await localDatabase.saveMessages([novaMsg]);

      // Update sent statuses in SQLite
      const updatedUserMsgs = batch.map(q => {
        const existing = get().messages.find(m => m.id === q.id);
        return {
          id: q.id,
          role: 'user' as const,
          content: q.content,
          status: 'sent' as const,
          timestamp: existing?.timestamp || new Date().toISOString()
        };
      });
      await localDatabase.saveMessages(updatedUserMsgs);

      set((s) => {
        const updated = s.messages.map(m => batchIds.includes(m.id) ? { ...m, status: 'sent' as const } : m);
        return { 
          messages: [...updated, novaMsg], 
          conversationId: conversation_id
        };
      });
    } catch (error: any) {
      let errorMessage = 'Network error';
      if (error.response) {
        if (error.response.status === 401) {
          errorMessage = 'Unauthorized';
        } else if (error.response.status === 404) {
          errorMessage = 'Endpoint not found';
        } else if (error.response.status >= 500) {
          errorMessage = 'Server error';
        } else {
          errorMessage = error.response.data?.error || 'Failed to send';
        }
      }

      // Update failed statuses in SQLite
      const failedUserMsgs = batch.map(q => {
        const existing = get().messages.find(m => m.id === q.id);
        return {
          id: q.id,
          role: 'user' as const,
          content: q.content,
          status: 'error' as const,
          errorMessage,
          timestamp: existing?.timestamp || new Date().toISOString()
        };
      });
      await localDatabase.saveMessages(failedUserMsgs);

      set((s) => {
        const updated = s.messages.map(m => batchIds.includes(m.id) ? { ...m, status: 'error' as const, errorMessage } : m);
        return { messages: updated };
      });
    }

    // Process any new messages that arrived while we were waiting
    get().processQueue();
  };

  return {
    messages: [],
    conversationId: null,
    isTyping: false,
    isHydrated: false,
    pendingQueue: [],
    diagnostics: null,
    
    hydrateMessages: async () => {
      try {
        // 1. Load instantly from SQLite first
        const localMsgs = await localDatabase.getMessages();
        if (localMsgs.length > 0) {
          set({
            messages: localMsgs,
            isHydrated: true,
            diagnostics: {
              apiCount: 0,
              storeCount: localMsgs.length,
              oldestTimestamp: localMsgs[0]?.timestamp || '',
              newestTimestamp: localMsgs[localMsgs.length - 1]?.timestamp || '',
              activeUserId: 'LOCAL_CACHE',
              activeConversationId: 'LOCAL_CACHE'
            }
          });
        } else {
          set({ isHydrated: true });
        }

        // 2. Background Sync
        const history = await chatService.getHistory();
        if (history && history.length > 0) {
          const formattedHistory = history.map((msg: any) => ({
            id: msg.id,
            role: msg.role === 'nova' ? 'assistant' : msg.role,
            content: msg.content,
            status: 'sent',
            timestamp: msg.created_at || new Date().toISOString()
          }));

          // Merge into SQLite (using INSERT OR REPLACE in transaction)
          await localDatabase.saveMessages(formattedHistory);

          // Refresh state from SQLite database
          const updatedLocalMsgs = await localDatabase.getMessages();
          set({
            messages: updatedLocalMsgs,
            conversationId: history[0]?.conversation_id || null,
            diagnostics: {
              apiCount: history.length,
              storeCount: updatedLocalMsgs.length,
              oldestTimestamp: updatedLocalMsgs[0]?.timestamp || '',
              newestTimestamp: updatedLocalMsgs[updatedLocalMsgs.length - 1]?.timestamp || '',
              activeUserId: history[0]?.user_id || 'UNKNOWN',
              activeConversationId: history[0]?.conversation_id || 'UNKNOWN'
            }
          });
        }
      } catch (e) {
        console.error('Failed to hydrate or background sync history:', e);
        set({ isHydrated: true });
      }
    },

    sendMessage: async (content: string) => {
      const userMsg: Message = {
        id: Date.now().toString() + Math.random().toString().slice(2, 6),
        role: 'user',
        content,
        status: 'sending',
        timestamp: new Date().toISOString()
      };

      // Save user message to SQLite instantly
      await localDatabase.saveMessages([userMsg]);

      set((state) => ({ 
        messages: [...state.messages, userMsg],
        pendingQueue: [...state.pendingQueue, { id: userMsg.id, content }]
      }));

      if (!get().isTyping) {
        set({ isTyping: true });
        get().processQueue();
      }
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      const msg = state.messages.find(m => m.id === messageId);
      if (!msg) return;

      const updatedMsg = { ...msg, status: 'sending' as const };
      await localDatabase.saveMessages([updatedMsg]);

      set((s) => ({
        messages: s.messages.map(m => m.id === messageId ? { ...m, status: 'sending' as const } : m),
        pendingQueue: [...s.pendingQueue, { id: msg.id, content: msg.content }]
      }));

      if (!get().isTyping) {
        set({ isTyping: true });
        get().processQueue();
      }
    },
    
    clearMessages: () => {
      localDatabase.clearMessages().catch(console.error);
      set({ messages: [], conversationId: null, pendingQueue: [], isTyping: false });
    },
    
    processQueue
  };
});
