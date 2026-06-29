import { create } from 'zustand';
import { chatService } from '../services/chatService';

export interface Message {
  id: string;
  role: 'user' | 'assistant'; // Switched from 'nova' to 'assistant' to match DB
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

      set((s) => {
        const updated = s.messages.map(m => batchIds.includes(m.id) ? { ...m, status: 'sent' as const } : m);
        return { 
          messages: [...updated, novaMsg], 
          conversationId: conversation_id // Save the active conversation ID
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
        const history = await chatService.getHistory();
        console.log('Diagnostics - Messages received from API:', history?.length);
        if (history && history.length > 0) {
          const formattedHistory = history.map((msg: any) => ({
            id: msg.id,
            role: msg.role === 'nova' ? 'assistant' : msg.role,
            content: msg.content,
            status: 'sent',
            timestamp: msg.created_at || new Date().toISOString()
          }));
          
          console.log('Diagnostics - Oldest message from API:', formattedHistory[0]?.timestamp);
          console.log('Diagnostics - Newest message from API:', formattedHistory[formattedHistory.length - 1]?.timestamp);
          
          set({ 
            messages: formattedHistory, 
            conversationId: history[0].conversation_id, // Get ID from most recent message
            isHydrated: true,
            diagnostics: {
              apiCount: history.length,
              storeCount: formattedHistory.length,
              oldestTimestamp: formattedHistory[0]?.timestamp || '',
              newestTimestamp: formattedHistory[formattedHistory.length - 1]?.timestamp || '',
              activeUserId: history[0]?.user_id || 'UNKNOWN',
              activeConversationId: history[0]?.conversation_id || 'UNKNOWN'
            }
          });
        } else {
          set({ isHydrated: true });
        }
      } catch (e) {
        console.error('Failed to hydrate history from backend:', e);
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
      set({ messages: [], conversationId: null, pendingQueue: [], isTyping: false });
    },
    
    processQueue
  };
});
