import { create } from 'zustand';
import { chatService } from '../services/chatService';

console.log('USECHATSTORE_LOADED');

export interface Message {
  id: string;
  role: 'user' | 'assistant'; // Switched from 'nova' to 'assistant' to match DB
  content: string;
  status: 'sending' | 'sent' | 'error';
  errorMessage?: string;
  timestamp: string;
  chunkIndex?: number;
  chunkTotal?: number;
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
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  oldestMessageId: string | null;
  pendingQueue: { id: string, content: string }[];
  diagnostics: ChatDiagnostics | null;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  
  hydrateMessages: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
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

// ── Client-side chunking for hydration ────────────────────────────────────────
function chunkText(text: string): string[] {
  if (text.length <= 1500) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  const pushChunk = (str: string) => {
    let remaining = str.trim();
    while (remaining.length > 1500) {
      chunks.push(remaining.substring(0, 1500));
      remaining = remaining.substring(1500);
    }
    if (remaining.length > 0) chunks.push(remaining);
  };

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= 1500) {
      current = candidate;
    } else {
      if (current) { pushChunk(current); current = ''; }
      if (para.length > 1500) {
        const sentences = para.match(/[^.!?]+[.!?]+\s*/g) ?? [para];
        for (const sentence of sentences) {
          const sc = current ? `${current} ${sentence}` : sentence;
          if (sc.length <= 1500) {
            current = sc;
          } else {
            if (current) pushChunk(current);
            current = sentence.trim();
          }
        }
      } else {
        current = para;
      }
    }
  }
  if (current.trim()) pushChunk(current);
  return chunks.length ? chunks : [text];
}

export const useChatStore = create<ChatState>((set, get) => {
  const processQueue = async () => {
    console.log('PROCESS_QUEUE_ENTERED');
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
          await new Promise<void>((resolve, reject) => {
            let messageIdCreated = false;
            let currentAssistantMsgId = Date.now().toString() + '_nova_' + Math.random().toString(36).substring(2, 7);
            
            // Mark user message as sent ONLY when the server confirms connection via setup event.
            // Leaving it as 'sending' ensures it shows as Red while the request is in-flight.
            // set((s) => ({
            //   messages: s.messages.map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m)
            // }));

            chatService.streamMessage(
              item.content,
              get().conversationId || undefined,
              (convId) => {
                // onSetup (The server has saved the message and begun streaming)
                set((s) => ({
                  conversationId: convId,
                  messages: s.messages.map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m)
                }));
              },
              (chunk) => {
                // onChunk
                set((s) => {
                  if (!messageIdCreated) {
                    messageIdCreated = true;
                    // First chunk: add the assistant message
                    return {
                      messages: [...s.messages, {
                        id: currentAssistantMsgId,
                        role: 'assistant',
                        content: chunk,
                        status: 'sent',
                        timestamp: new Date().toISOString()
                      }],
                      isTyping: false
                    };
                  } else {
                    // Subsequent chunks: append to existing message
                    return {
                      messages: s.messages.map(m => 
                        m.id === currentAssistantMsgId 
                          ? { ...m, content: m.content + chunk } 
                          : m
                      )
                    };
                  }
                });
              },
              () => {
                // onDone
                resolve();
              },
              (errorStr) => {
                // onError
                reject(new Error(errorStr));
              }
            ).catch(reject);
          });

          console.log('[QUEUE] success:', item.id);
        } catch (error: any) {
          // Failure is scoped to this one message only.
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

          console.log('[QUEUE] error (auto-retrying):', item.id, errorMessage);
          
          // Wait 3 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // If the SSE failed due to an expired token, react-native-sse cannot auto-refresh it
          // because it bypasses our axios interceptors. By making a lightweight axios call here,
          // we force the interceptor to catch any 401s and refresh the token BEFORE we retry!
          try {
            const { api } = await import('../services/api');
            await api.get('/onboarding/status');
          } catch (e) {
            console.log('[QUEUE] Token refresh ping failed, but continuing retry loop...');
          }
          
          // Put the message back at the FRONT of the queue
          // Note: The message status stays 'sending' in the UI.
          set((s) => ({
            pendingQueue: [item, ...s.pendingQueue]
          }));
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
    hasMoreMessages: false,
    isLoadingMore: false,
    oldestMessageId: null,
    pendingQueue: [],
    diagnostics: null,
    developerMode: false,
    setDeveloperMode: (val: boolean) => set({ developerMode: val }),
    
    hydrateMessages: async () => {
      try {
        const PAGE_SIZE = 50;
        const history = await chatService.getHistory(undefined, PAGE_SIZE);
        console.log('Diagnostics - Messages received from API:', history?.length);
        if (history && history.length > 0) {
          const formattedHistory: Message[] = [];
          for (const msg of history) {
            const role = msg.role === 'nova' ? 'assistant' : msg.role;
            const timestamp = msg.created_at || new Date().toISOString();
            
            if (role === 'assistant') {
              const initialChunks = msg.content.includes('<NOVA_MESSAGE_BREAK>')
                ? msg.content.split('<NOVA_MESSAGE_BREAK>').map((c: string) => c.trim()).filter(Boolean)
                : [msg.content];
                
              const finalChunks: string[] = [];
              initialChunks.forEach((c: string) => {
                if (c.length > 1500) {
                  finalChunks.push(...chunkText(c));
                } else {
                  finalChunks.push(c);
                }
              });

              finalChunks.forEach((chunkContent, idx) => {
                formattedHistory.push({
                  id: `${msg.id}_part_${idx + 1}`,
                  role,
                  content: chunkContent,
                  status: 'sent',
                  timestamp,
                  chunkIndex: finalChunks.length > 1 ? idx + 1 : undefined,
                  chunkTotal: finalChunks.length > 1 ? finalChunks.length : undefined,
                });
              });
            } else {
              formattedHistory.push({
                id: msg.id,
                role,
                content: msg.content,
                status: 'sent',
                timestamp
              });
            }
          }
          
          console.log('Diagnostics - Oldest message from API:', formattedHistory[0]?.timestamp);
          console.log('Diagnostics - Newest message from API:', formattedHistory[formattedHistory.length - 1]?.timestamp);
          
          // The oldest raw message ID is the cursor for loading more
          const oldestRawId = history[0]?.id || null;
          
          set({ 
            messages: formattedHistory, 
            conversationId: history[0].conversation_id,
            isHydrated: true,
            hasMoreMessages: history.length >= PAGE_SIZE,
            oldestMessageId: oldestRawId,
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
          set({ isHydrated: true, hasMoreMessages: false });
        }
      } catch (e) {
        console.error('Failed to hydrate history from backend:', e);
        set({ isHydrated: true });
      }
    },

    loadOlderMessages: async () => {
      const { isLoadingMore, hasMoreMessages, oldestMessageId, messages } = get();
      if (isLoadingMore || !hasMoreMessages) return;

      set({ isLoadingMore: true });
      try {
        const PAGE_SIZE = 50;
        const older = await chatService.getHistory(undefined, PAGE_SIZE, oldestMessageId || undefined);
        if (!older || older.length === 0) {
          set({ hasMoreMessages: false, isLoadingMore: false });
          return;
        }

        const formattedOlder: Message[] = [];
        for (const msg of older) {
          const role = msg.role === 'nova' ? 'assistant' : msg.role;
          const timestamp = msg.created_at || new Date().toISOString();

          if (role === 'assistant') {
            const initialChunks = msg.content.includes('<NOVA_MESSAGE_BREAK>')
              ? msg.content.split('<NOVA_MESSAGE_BREAK>').map((c: string) => c.trim()).filter(Boolean)
              : [msg.content];
            const finalChunks: string[] = [];
            initialChunks.forEach((c: string) => {
              finalChunks.push(...(c.length > 1500 ? chunkText(c) : [c]));
            });
            finalChunks.forEach((chunkContent, idx) => {
              formattedOlder.push({
                id: `${msg.id}_part_${idx + 1}`,
                role, content: chunkContent, status: 'sent', timestamp,
                chunkIndex: finalChunks.length > 1 ? idx + 1 : undefined,
                chunkTotal: finalChunks.length > 1 ? finalChunks.length : undefined,
              });
            });
          } else {
            formattedOlder.push({ id: msg.id, role, content: msg.content, status: 'sent', timestamp });
          }
        }

        const newOldestRawId = older[0]?.id || null;
        // Prepend older messages BEFORE the existing ones — preserves scroll position
        set({
          messages: [...formattedOlder, ...messages],
          hasMoreMessages: older.length >= PAGE_SIZE,
          oldestMessageId: newOldestRawId,
          isLoadingMore: false,
        });
      } catch (e) {
        console.error('Failed to load older messages:', e);
        set({ isLoadingMore: false });
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
