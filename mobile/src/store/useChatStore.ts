import { create } from 'zustand';
import { chatService } from '../services/chatService';
import * as SecureStore from 'expo-secure-store';
import { proactiveReplyService } from '../services/proactiveReplyService';

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
  checkProactiveMessages: () => Promise<void>;
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

// ── Delivered ID set (prevents re-send after force close) ────────────────────
// Stores IDs of messages that were successfully sent. On cold start, any
// pendingQueue item in this set is silently dropped — it was already delivered.
const DELIVERED_KEY = 'humanOs_deliveredIds';
const MAX_DELIVERED_IDS = 100; // Keep last 100 to avoid storage bloat

async function loadDeliveredIds(): Promise<Set<string>> {
  try {
    const raw = await SecureStore.getItemAsync(DELIVERED_KEY);
    if (!raw) return new Set();
    const arr: { id: string; ts: number }[] = JSON.parse(raw);
    // Auto-expire IDs older than 48 hours
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const fresh = arr.filter(e => e.ts > cutoff);
    return new Set(fresh.map(e => e.id));
  } catch (e) {
    return new Set();
  }
}

async function markDelivered(id: string): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(DELIVERED_KEY);
    const arr: { id: string; ts: number }[] = raw ? JSON.parse(raw) : [];
    // Append, deduplicate, keep last MAX entries
    const newArr = [...arr.filter(e => e.id !== id), { id, ts: Date.now() }]
      .slice(-MAX_DELIVERED_IDS);
    await SecureStore.setItemAsync(DELIVERED_KEY, JSON.stringify(newArr));
  } catch (e) {
    console.warn('[QUEUE] Failed to mark delivered:', e);
  }
}

// ── Message cache (instant startup — like WhatsApp) ───────────────────────────
const MSG_CACHE_KEY = 'humanOs_messageCache';
const CONV_CACHE_KEY = 'humanOs_conversationId';
async function saveMessageCache(messages: Message[], conversationId: string | null) {
  try {
    const toCache = messages.filter(m => m.status !== 'sending' && m.status !== 'error').slice(-50);
    await SecureStore.setItemAsync(MSG_CACHE_KEY, JSON.stringify(toCache));
    if (conversationId) await SecureStore.setItemAsync(CONV_CACHE_KEY, conversationId);
  } catch (e) {
    console.warn('[CACHE] Failed to save message cache:', e);
  }
}
async function loadMessageCache(): Promise<{ messages: Message[]; conversationId: string | null }> {
  try {
    const raw = await SecureStore.getItemAsync(MSG_CACHE_KEY);
    const convId = await SecureStore.getItemAsync(CONV_CACHE_KEY);
    return {
      messages: raw ? JSON.parse(raw) : [],
      conversationId: convId || null,
    };
  } catch (e) {
    return { messages: [], conversationId: null };
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
        // ── ATOMIC DEQUEUE: update state + persist BEFORE API call ────────────
        // This means even if the app is force-closed after a successful send,
        // the queue no longer contains this item on the next cold start.
        set({ pendingQueue: rest });
        await savePendingQueue(rest);

        // Skip if already delivered (dedup against force-close re-open scenario)
        const deliveredIds = await loadDeliveredIds();
        if (deliveredIds.has(item.id)) {
          console.log('[QUEUE] skipped — already delivered:', item.id);
          // Clean up the sending bubble if it's still showing
          set((s) => ({
            messages: s.messages.filter(m => m.id !== item.id),
          }));
          continue;
        }

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

        let retryDelay = 3000;
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

            // ── Mark as delivered IMMEDIATELY after success ─────────────────
            // This is the key fix: even if the app crashes here, this ID is
            // already in the delivered set so it won't re-send on next launch.
            await markDelivered(item.id);

            succeeded = true;
            console.log('[QUEUE] success:', item.id);
          } catch (err: any) {
            const isServerError = err?.response?.status >= 400 && err?.response?.status < 500;
            if (isServerError) {
              console.log('[QUEUE] 4xx error, not retrying:', err?.response?.status);
              set({ isTyping: false });
              succeeded = true;
            } else {
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
      // ── Step 1: Load cache instantly (zero wait, no spinner) ──────────────────
      const [cachedData, savedQueue, deliveredIds] = await Promise.all([
        loadMessageCache(),
        loadPendingQueue(),
        loadDeliveredIds(),
      ]);

      // Filter out already-delivered messages from the restored queue
      const filteredQueue = savedQueue.filter(q => !deliveredIds.has(q.id));
      if (filteredQueue.length < savedQueue.length) {
        console.log('[HYDRATE] Dropped', savedQueue.length - filteredQueue.length, 'already-delivered items from queue');
        await savePendingQueue(filteredQueue);
      }

      if (cachedData.messages.length > 0) {
        const restoredPending: Message[] = filteredQueue.map(q => ({
          id: q.id,
          role: 'user' as const,
          content: q.content,
          status: 'sending' as const,
          timestamp: new Date().toISOString(),
        }));
        set({
          messages: [...cachedData.messages, ...restoredPending],
          conversationId: cachedData.conversationId,
          pendingQueue: filteredQueue,
          isHydrated: true,
        });
        if (filteredQueue.length > 0) get().processQueue();
      }

      // ── Step 2: Refresh from backend in background ─────────────────────────
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
          
          // Restore pending messages that aren't in history yet and not delivered
          const savedIds = new Set(history.map((m: any) => m.id));
          const pendingToRestore = filteredQueue.filter(q => !savedIds.has(q.id));
          const restoredMessages: Message[] = pendingToRestore.map(q => ({
            id: q.id,
            role: 'user' as const,
            content: q.content,
            status: 'sending' as const,
            timestamp: new Date().toISOString(),
          }));

          const oldestRawId = history[0]?.id || null;
          const freshMessages = [...formattedHistory, ...restoredMessages];
          
          set({ 
            messages: freshMessages,
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

          saveMessageCache(freshMessages, history[0].conversation_id);

          if (pendingToRestore.length > 0) {
            console.log('[HYDRATE] Resuming', pendingToRestore.length, 'pending messages');
            get().processQueue();
          }
        } else {
          const restoredMessages: Message[] = filteredQueue.map(q => ({
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
            pendingQueue: filteredQueue,
          });
          if (filteredQueue.length > 0) get().processQueue();
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

      await savePendingQueue(newQueue);
      get().processQueue();
    },

    retryMessage: async (messageId: string) => {
      const state = get();
      const msg = state.messages.find(m => m.id === messageId && m.status === 'error');
      if (!msg) return;

      set((s) => ({
        messages: s.messages.map(m => m.id === messageId ? { ...m, status: 'sending' as const } : m),
        pendingQueue: [...s.pendingQueue, { id: msg.id, content: msg.content }]
      }));

      get().processQueue();
    },
    
    clearMessages: () => {
      set({ messages: [], conversationId: null, pendingQueue: [], isTyping: false });
    },

    // ── Proactive message check: called when app comes to foreground ───────────
    // Fetches any messages Nova sent while the app was backgrounded/minimized
    checkProactiveMessages: async () => {
      try {
        const convId = get().conversationId;
        if (!convId) return;

        const currentMessages = get().messages;
        const latestTimestamp = currentMessages.length > 0
          ? currentMessages[currentMessages.length - 1].timestamp
          : null;

        const history = await chatService.getHistory(convId, 10);
        if (!history || history.length === 0) return;

        const existingIds = new Set(currentMessages.map(m => m.id));
        const newMessages: Message[] = [];

        for (const msg of history) {
          const role = msg.role === 'nova' ? 'assistant' : msg.role;
          const msgId = msg.id;

          // Only add truly new messages (not in our current store)
          const partId0 = `${msgId}_part_1`;
          if (existingIds.has(msgId) || existingIds.has(partId0)) continue;

          // Only add messages newer than our latest
          if (latestTimestamp && msg.created_at <= latestTimestamp) continue;

          if (role === 'assistant') {
            const chunks = msg.content.includes('<NOVA_MESSAGE_BREAK>')
              ? msg.content.split('<NOVA_MESSAGE_BREAK>').map((c: string) => c.trim()).filter(Boolean)
              : [msg.content];
            chunks.forEach((chunkContent: string, idx: number) => {
              newMessages.push({
                id: `${msgId}_part_${idx + 1}`,
                role: 'assistant',
                content: chunkContent,
                status: 'responded',
                timestamp: msg.created_at,
              });
            });
          } else {
            newMessages.push({
              id: msgId,
              role,
              content: msg.content,
              status: 'sent',
              timestamp: msg.created_at,
            });
          }
        }

        if (newMessages.length > 0) {
          console.log('[PROACTIVE] Found', newMessages.length, 'new messages from Nova while backgrounded');
          set((s) => ({
            messages: [...s.messages, ...newMessages],
          }));
          saveMessageCache([...get().messages], get().conversationId);
        }

        // Trigger proactive check (will only fire if > 4 hours since last user message)
        if (latestTimestamp) {
          proactiveReplyService.triggerProactiveCheck(latestTimestamp);
        }
      } catch (e) {
        console.warn('[PROACTIVE] Failed to check for new messages:', e);
      }
    },
    
    processQueue
  };
});
