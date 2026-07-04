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
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  
  hydrateMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearMessages: () => void;
  processQueue: () => Promise<void>;
}

// ── Processing lock ───────────────────────────────────────────────────────────
// Module-level flag (outside Zustand state) used as a guaranteed mutex.
// JS is single-threaded: setting this synchronously before the first `await`
// ensures only one processQueue body can run at a time, with zero race window.
let _isProcessing = false;

export const useChatStore = create<ChatState>((set, get) => {
  const processQueue = async () => {
    // Guard: if a processor is already running, new messages will be picked
    // up by the existing while-loop on its next iteration. Return immediately.
    if (_isProcessing) return;
    _isProcessing = true;
    set({ isTyping: true });

    console.log('[QUEUE] start');

    try {
      while (true) {
        // Read fresh state on every iteration
        const queue = get().pendingQueue;
        if (queue.length === 0) break;

        // Dequeue exactly ONE item from the front
        const [item, ...rest] = queue;
        set({ pendingQueue: rest });

        // Safety guard: if the message no longer exists in 'sending' state
        // (e.g. clearMessages was called), skip without making an API call.
        const stillExists = get().messages.some(
          m => m.id === item.id && m.status === 'sending'
        );
        if (!stillExists) {
          console.log('[QUEUE] skipped — message no longer pending:', item.id);
          continue;
        }

        console.log('[QUEUE] sending:', item.id);

        try {
          const data = await chatService.sendMessage(
            item.content,
            get().conversationId || undefined
          );
          
          let chunkMessages: Message[];

          if (data.chunks && Array.isArray(data.chunks)) {
            chunkMessages = data.chunks.map((c: any, idx: number) => {
              const label = c.total > 1 ? `Part ${c.index} of ${c.total}\n\n` : '';
              const randomSuffix = Math.random().toString(36).substring(2, 7);
              return {
                id: Date.now().toString() + '_nova_' + idx + '_' + randomSuffix,
                role: 'assistant',
                content: label + c.content,
                status: 'sent',
                timestamp: new Date().toISOString(),
              };
            });
          } else {
            // legacy fallback
            chunkMessages = [{
              id: Date.now().toString() + '_nova_0',
              role: 'assistant',
              content: data.reply,
              status: 'sent',
              timestamp: new Date().toISOString(),
            }];
          }

          set((s) => ({
            messages: [
              ...s.messages.map(m =>
                m.id === item.id ? { ...m, status: 'sent' as const } : m
              ),
              ...chunkMessages,
            ],
            conversationId: data.conversation_id,
          }));

          console.log('[QUEUE] success:', item.id);
        } catch (error: any) {
          // Failure is scoped to this one message only.
          // The while-loop continues to process any remaining queued messages.
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

          set((s) => ({
            messages: s.messages.map(m =>
              m.id === item.id
                ? { ...m, status: 'error' as const, errorMessage }
                : m
            ),
          }));

          console.log('[QUEUE] error:', item.id, errorMessage);
        }
      }
    } finally {
      // Guaranteed cleanup regardless of success, error, or unexpected exception.
      _isProcessing = false;
      set({ isTyping: false });
      console.log('[QUEUE] finished');
    }
  };

  return {
    messages: [],
    conversationId: null,
    isTyping: false,
    isHydrated: false,
    pendingQueue: [],
    diagnostics: null,
    developerMode: false,
    setDeveloperMode: (val: boolean) => set({ developerMode: val }),
    
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

      // processQueue is idempotent — safe to call unconditionally.
      // If _isProcessing is true, it returns immediately and the running
      // while-loop will pick up the new item on its next iteration.
      get().processQueue();
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      // Only retry if the message is actually in error state.
      // If the user taps Retry twice rapidly the first tap moves status to
      // 'sending' — the second tap finds no 'error' message and returns,
      // preventing a duplicate API call.
      const msg = state.messages.find(m => m.id === messageId && m.status === 'error');
      if (!msg) return;

      set((s) => ({
        messages: s.messages.map(m => m.id === messageId ? { ...m, status: 'sending' as const } : m),
        pendingQueue: [...s.pendingQueue, { id: msg.id, content: msg.content }]
      }));

      // Same idempotent call — safe whether or not a processor is already running.
      get().processQueue();
    },
    
    clearMessages: () => {
      // Setting pendingQueue: [] means the while-loop will find nothing on its
      // next iteration and exit cleanly, resetting _isProcessing itself via finally.
      set({ messages: [], conversationId: null, pendingQueue: [], isTyping: false });
    },
    
    processQueue
  };
});
