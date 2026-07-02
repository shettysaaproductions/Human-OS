import { create } from 'zustand';
import { chatService } from '../services/chatService';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'sending' | 'sent' | 'error';
  errorMessage?: string;
  timestamp: string;
  clientMsgId?: string; // idempotency key
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
  isTyping: boolean; // deprecated, use novaState
  novaState: 'idle' | 'thinking' | 'typing' | 'complete' | 'error';
  isHydrated: boolean;
  pendingQueue: { id: string, content: string, clientMsgId: string }[];
  isProcessing: boolean; // NEW: prevents re-entrancy
  diagnostics: ChatDiagnostics | null;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;

  hydrateMessages: () => Promise<void>;
  sendMessage: (content: string) => void;
  retryMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
  processQueue: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => {
  const processQueue = async () => {
    const state = get();

    // CRITICAL FIX: prevent re-entrancy. Without this, rapid sends spawn
    // multiple concurrent processQueue calls → duplicate messages + API calls.
    if (state.isProcessing) return;
    if (state.pendingQueue.length === 0) {
      set({ isTyping: false, novaState: 'idle', isProcessing: false });
      return;
    }

    set({ isTyping: true, novaState: 'thinking', isProcessing: true });

    // Take only the FIRST item in the queue (FIFO — one message at a time)
    const [item, ...rest] = state.pendingQueue;
    set({ pendingQueue: rest });

    const novaMsgId = `nova_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      await chatService.streamMessage(
        item.content,
        get().conversationId || undefined,
        {
          onStart: (data) => {
            set((s) => {
              // Avoid adding duplicate nova placeholder
              if (s.messages.find(m => m.id === novaMsgId)) return s;
              const novaMsg: Message = {
                id: novaMsgId,
                role: 'assistant',
                content: '',
                status: 'sending',
                timestamp: new Date().toISOString()
              };
              return {
                novaState: 'typing',
                messages: [...s.messages, novaMsg],
                conversationId: data.conversation_id || s.conversationId
              };
            });
          },
          onChunk: (text) => {
            set((s) => ({
              messages: s.messages.map(m =>
                m.id === novaMsgId ? { ...m, content: m.content + text } : m
              )
            }));
          },
          onDone: (data) => {
            set((s) => {
              const updated = s.messages
                .map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m)
                .map(m => m.id === novaMsgId ? { ...m, status: 'sent' as const } : m);
              return { messages: updated, novaState: 'complete', isProcessing: false };
            });
          }
        }
      );
    } catch (streamError: any) {
      console.warn('[ChatStore] Streaming failed — falling back to /chat', streamError);

      // Remove the empty placeholder if it was added
      set((s) => ({
        messages: s.messages.filter(m => !(m.id === novaMsgId && m.content === ''))
      }));

      try {
        const { reply, conversation_id } = await chatService.sendMessage(
          item.content,
          get().conversationId || undefined
        );

        const novaMsg: Message = {
          id: novaMsgId + '_fb',
          role: 'assistant',
          content: reply,
          status: 'sent',
          timestamp: new Date().toISOString()
        };

        set((s) => ({
          messages: [
            ...s.messages.map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m),
            novaMsg
          ],
          conversationId: conversation_id,
          novaState: 'complete',
          isProcessing: false
        }));
      } catch (fallbackError: any) {
        let errorMessage = 'Network error. Tap to retry.';
        if (fallbackError.response) {
          if (fallbackError.response.status === 401) errorMessage = 'Session expired. Please log in.';
          else if (fallbackError.response.status >= 500) errorMessage = 'Server error. Tap to retry.';
          else errorMessage = fallbackError.response.data?.error || 'Failed to send.';
        }
        set((s) => ({
          messages: s.messages.map(m =>
            m.id === item.id ? { ...m, status: 'error' as const, errorMessage } : m
          ),
          novaState: 'error',
          isProcessing: false
        }));
      }
    }

    // Process the next message in queue (if any) after current completes
    const next = get();
    if (next.pendingQueue.length > 0) {
      get().processQueue();
    }
  };

  return {
    messages: [],
    conversationId: null,
    isTyping: false,
    novaState: 'idle',
    isHydrated: false,
    isProcessing: false,
    pendingQueue: [],
    diagnostics: null,
    developerMode: false,
    setDeveloperMode: (val: boolean) => set({ developerMode: val }),

    hydrateMessages: async () => {
      try {
        const history = await chatService.getHistory();
        if (history && history.length > 0) {
          const formattedHistory = history.map((msg: any) => ({
            id: msg.id,
            role: msg.role === 'nova' ? 'assistant' : msg.role,
            content: msg.content,
            status: 'sent' as const,
            timestamp: msg.created_at || new Date().toISOString()
          }));

          set({
            messages: formattedHistory,
            conversationId: history[0].conversation_id,
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
        console.error('[ChatStore] Failed to hydrate history:', e);
        set({ isHydrated: true });
      }
    },

    sendMessage: (content: string) => {
      // Generate a stable client-side idempotency key
      const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const userMsg: Message = {
        id: clientMsgId,
        role: 'user',
        content,
        status: 'sending',
        timestamp: new Date().toISOString(),
        clientMsgId
      };

      set((state) => ({
        messages: [...state.messages, userMsg],
        pendingQueue: [...state.pendingQueue, { id: clientMsgId, content, clientMsgId }]
      }));

      // Only start processing if not already running
      if (!get().isProcessing) {
        get().processQueue();
      }
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      const msg = state.messages.find(m => m.id === messageId);
      if (!msg) return;

      set((s) => ({
        messages: s.messages.map(m =>
          m.id === messageId ? { ...m, status: 'sending' as const, errorMessage: undefined } : m
        ),
        pendingQueue: [...s.pendingQueue, {
          id: msg.id,
          content: msg.content,
          clientMsgId: msg.clientMsgId || msg.id
        }]
      }));

      if (!get().isProcessing) {
        get().processQueue();
      }
    },

    clearMessages: () => {
      set({
        messages: [],
        conversationId: null,
        pendingQueue: [],
        isTyping: false,
        novaState: 'idle',
        isProcessing: false
      });
    },

    processQueue
  };
});
