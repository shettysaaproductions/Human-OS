import { create } from 'zustand';
import { chatService } from '../services/chatService';
import * as SecureStore from 'expo-secure-store';

console.log('USECHATSTORE_LOADED');

export interface Message {
  id: string;
  role: 'user' | 'assistant'; // Switched from 'nova' to 'assistant' to match DB
  content: string;
  status: 'sending' | 'sent' | 'responded' | 'error';
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

// ── Processing lock + in-flight deduplication ────────────────────────────────
let _isProcessing = false;
const _inFlightIds = new Set<string>();

// ── Pending queue persistence (survives app swipe-away) ─────────────────────
const QUEUE_KEY = 'humanOs_pendingQueue';
async function savePendingQueue(queue: { id: string; content: string }[]) {
  try {
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[QUEUE] Failed to persist queue:', e);
  }
}
async function loadPendingQueue(): Promise<{ id: string; content: string }[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

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
    if (_isProcessing) return;
    _isProcessing = true;
    console.log('[QUEUE] start');

    try {
      while (true) {
        const queue = get().pendingQueue;
        if (queue.length === 0) break;

        const [item, ...rest] = queue;
        set({ pendingQueue: rest });
        await savePendingQueue(rest); // persist after dequeue

        // Skip if already being sent (deduplication against parallel processQueue calls)
        if (_inFlightIds.has(item.id)) {
          console.log('[QUEUE] skipped — already in-flight:', item.id);
          continue;
        }

        // Skip if message no longer in 'sending' state (e.g. user cleared chat)
        const stillExists = get().messages.some(
          m => m.id === item.id && m.status === 'sending'
        );
        if (!stillExists) continue;

        _inFlightIds.add(item.id);
        set({ isTyping: true });

        let retryDelay = 3000; // start at 3s, cap at 30s
        let succeeded = false;

        while (!succeeded) {
          try {
            const data = await chatService.sendMessage(
              item.content,
              get().conversationId || undefined
            );

            const replyBubbles: string[] = (data?.messages && data.messages.length > 0)
              ? data.messages
              : (data?.reply ? [data.reply] : []);
            const convId: string = data?.conversation_id || get().conversationId || '';
            const now = new Date().toISOString();

            const novaMessages = replyBubbles.map((content: string, idx: number) => ({
              id: `${Date.now()}_nova_${idx}_${Math.random().toString(36).substring(2, 7)}`,
              role: 'assistant' as const,
              content,
              status: 'responded' as const,
              timestamp: now,
            }));

            set((s) => ({
              conversationId: convId,
              isTyping: false,
              messages: [
                ...s.messages.map(m =>
                  m.id === item.id ? { ...m, status: 'sent' as const } : m
                ),
                ...novaMessages,
              ],
            }));

            succeeded = true;
            console.log('[QUEUE] success:', item.id);
          } catch (err: any) {
            const isServerError = err?.response?.status >= 400 && err?.response?.status < 500;
            if (isServerError) {
              // 4xx = auth/not-found — no point retrying, mark silent send fail
              // but keep Red dot so user knows
              console.log('[QUEUE] 4xx error, not retrying:', err?.response?.status);
              set({ isTyping: false });
              succeeded = true; // exit inner while, message stays Red (sending)
            } else {
              // Network error or 5xx — retry silently with backoff
              console.log('[QUEUE] network error, retrying in', retryDelay, 'ms');
              set({ isTyping: false });
              await new Promise(r => setTimeout(r, retryDelay));
              retryDelay = Math.min(retryDelay * 1.5, 30000);
            }
          }
        }

        _inFlightIds.delete(item.id);
      }
    } finally {
      _isProcessing = false;
      set({ isTyping: false });
      await savePendingQueue([]); // clear persisted queue on completion
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
        // Restore any unsent messages from before the app was closed
        const savedQueue = await loadPendingQueue();

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
          
          // Reconstruct any persisted pending messages as 'sending' bubbles
          // Filter out any queue items that were already saved to history
          const savedIds = new Set(history.map((m: any) => m.id));
          const pendingToRestore = savedQueue.filter(q => !savedIds.has(q.id));
          const restoredMessages: Message[] = pendingToRestore.map(q => ({
            id: q.id,
            role: 'user' as const,
            content: q.content,
            status: 'sending' as const,
            timestamp: new Date().toISOString(),
          }));

          const oldestRawId = history[0]?.id || null;
          
          set({ 
            messages: [...formattedHistory, ...restoredMessages], 
            conversationId: history[0].conversation_id,
            pendingQueue: pendingToRestore,
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

          // Resume sending any restored pending messages
          if (pendingToRestore.length > 0) {
            console.log('[HYDRATE] Resuming', pendingToRestore.length, 'pending messages');
            get().processQueue();
          }
        } else {
          // No history but might have pending messages
          const restoredMessages: Message[] = savedQueue.map(q => ({
            id: q.id,
            role: 'user' as const,
            content: q.content,
            status: 'sending' as const,
            timestamp: new Date().toISOString(),
          }));
          set({
            isHydrated: true,
            hasMoreMessages: false,
            messages: restoredMessages,
            pendingQueue: savedQueue,
          });
          if (savedQueue.length > 0) get().processQueue();
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

      const newQueue = [...get().pendingQueue, { id: userMsg.id, content }];
      set((state) => ({ 
        messages: [...state.messages, userMsg],
        pendingQueue: newQueue,
      }));

      // Persist queue so it survives if the app is swiped away
      await savePendingQueue(newQueue);

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
