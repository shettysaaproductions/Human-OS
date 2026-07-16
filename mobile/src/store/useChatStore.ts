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
let _lockTimestamp: number = 0; // Unix ms — used to force-release stale locks (90s timeout)
const _inFlightIds = new Set<string>();

// ── Proactive check lock — prevents simultaneous duplicate checks ──────────────
let _proactiveCheckInProgress = false;

// ── Queue watchdog — rescues stuck queues when internet comes back ─────────────
// Checks every 15s: if queue is non-empty and not processing, kicks processQueue().
// Also detects stale locks (>90s) and force-resets them.
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;
function startQueueWatchdog(processQueueFn: () => Promise<void>) {
  if (_watchdogTimer) return; // already running
  _watchdogTimer = setInterval(() => {
    // Force-release stale lock (if processQueue has been stuck for >90s)
    if (_isProcessing && _lockTimestamp > 0 && Date.now() - _lockTimestamp > 90_000) {
      console.warn('[WATCHDOG] Force-releasing stale processQueue lock after 90s');
      _isProcessing = false;
      _lockTimestamp = 0;
    }
    // Kick processQueue if queue has items and nothing is running
    const store = (globalThis as any).__chatStoreGet?.();
    if (store && store.pendingQueue.length > 0 && !_isProcessing) {
      console.log('[WATCHDOG] Kicking stuck queue —', store.pendingQueue.length, 'item(s) pending');
      processQueueFn();
    }
  }, 15_000);
}

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

let _queueTimeout: ReturnType<typeof setTimeout> | null = null;

export const useChatStore = create<ChatState>((set, get) => {
  // Store get reference globally so watchdog can access queue length without circular deps
  (globalThis as any).__chatStoreGet = get;

  const processQueue = async () => {
    if (_isProcessing) return;
    _isProcessing = true;
    _lockTimestamp = Date.now();
    console.log('[QUEUE] start');

    try {
      while (true) {
        const queue = get().pendingQueue;
        if (queue.length === 0) break;

        const batch = [...queue];
        set({ pendingQueue: [] });
        // Fire and forget storage writes so we don't block the network request
        savePendingQueue([]).catch(e => console.warn(e));

        const primaryId = batch[0].id;

        // Skip if already being sent
        if (_inFlightIds.has(primaryId)) {
          continue;
        }

        _inFlightIds.add(primaryId);
        set({ isTyping: true });

        // Check delivered status in parallel to allow fast failure, 
        // but DO NOT block the network request from firing immediately
        loadDeliveredIds().then(deliveredIds => {
          if (deliveredIds.has(primaryId)) {
             _inFlightIds.delete(primaryId);
             set((s) => ({
               messages: s.messages.filter(m => !batch.some(b => b.id === m.id)),
             }));
          }
        });

        let retryDelay = 3000;
        let succeeded = false;

        const combinedContent = batch.map(b => b.content).join('\n');

        // FIRE IMMEDIATELY: Hand off to native OkHttp instantly
        // This ensures the request leaves the phone even if minimized 10ms later
        while (!succeeded) {
          try {
            const data = await chatService.sendMessageAsync(
              combinedContent,
              get().conversationId || undefined
            );

            const convId: string = data?.conversation_id || get().conversationId || '';

            set((s) => ({
              conversationId: convId,
              isTyping: true, // Keep true until background reply arrives
              messages: s.messages.map(m =>
                batch.some(b => b.id === m.id) 
                  ? { ...m, status: 'sent' as const, id: m.id === primaryId ? (data.user_message_id || m.id) : m.id } 
                  : m
              ),
            }));

            // ── Mark as delivered IMMEDIATELY after success ─────────────────
            await markDelivered(primaryId);
            
            // ── Start polling for the reply (useful if app stays in foreground) ──
            // IMPORTANT: Use useChatStore.getState() directly inside the interval,
            // NOT a captured `state` variable — the captured reference goes stale
            // and reads the old isTyping value, preventing the interval from stopping.
            let polls = 0;
            const pollInterval = setInterval(async () => {
              polls++;
              const live = useChatStore.getState();
              // Stop polling if typing was cleared (reply received) or after 60 polls (3 mins)
              if (!live.isTyping || polls > 60) {
                clearInterval(pollInterval);
                return;
              }
              await live.checkProactiveMessages();
            }, 3000);

            succeeded = true;
            console.log('[QUEUE] async send success for batch starting with:', primaryId);
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

        _inFlightIds.delete(primaryId);
      }
    } finally {
      _isProcessing = false;
      _lockTimestamp = 0;
      // We DO NOT set isTyping: false here, because we are waiting for the async reply
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
          const savedContents = new Set(history.filter((m: any) => m.role === 'user').map((m: any) => m.content.trim()));
          const pendingToRestore = filteredQueue.filter(q => !savedIds.has(q.id) && !savedContents.has(q.content.trim()));
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

      // Fire and forget, don't block the network request!
      savePendingQueue(newQueue).catch(e => console.warn(e));

      // Start the watchdog so stuck messages self-heal without restarting the app
      startQueueWatchdog(processQueue);

      if (_queueTimeout) clearTimeout(_queueTimeout);
      // Fire immediately so Android doesn't suspend the app before the request leaves
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
    // Fetches any messages Nova sent while the app was backgrounded/minimized.
    // Guarded by a lock so rapid back-to-back calls (AppState + notification)
    // don't both run and produce duplicates.
    checkProactiveMessages: async () => {
      if (_proactiveCheckInProgress) {
        console.log('[PROACTIVE] Skipping — check already in progress');
        return;
      }
      _proactiveCheckInProgress = true;
      try {
        const convId = get().conversationId;
        if (!convId) return;

        const currentMessages = get().messages;
        const latestTimestamp = currentMessages.length > 0
          ? currentMessages[currentMessages.length - 1].timestamp
          : null;

        const history = await chatService.getHistory(convId, 10);
        if (!history || history.length === 0) return;

        // Build a comprehensive set of IDs already in store:
        // includes both raw IDs (user msgs) and all _part_N variants (assistant chunks)
        const existingIds = new Set<string>();
        const existingContentByRole = new Map<string, Set<string>>(); // role -> Set<content.trim()>
        for (const m of currentMessages) {
          existingIds.add(m.id);
          // If this is a _part_N id, also register the base id so the same msg
          // fetched from backend (raw UUID) is recognised as a duplicate
          const partMatch = m.id.match(/^(.+)_part_\d+$/);
          if (partMatch) existingIds.add(partMatch[1]);
          if (!existingContentByRole.has(m.role)) existingContentByRole.set(m.role, new Set());
          existingContentByRole.get(m.role)!.add(m.content.trim());
        }

        const newMessages: Message[] = [];

        for (const msg of history) {
          const role = msg.role === 'nova' ? 'assistant' : msg.role;
          const msgId = msg.id;

          // Skip if already in store (by raw ID or any _part_N variant)
          if (existingIds.has(msgId)) continue;
          const partId1 = `${msgId}_part_1`;
          if (existingIds.has(partId1)) continue;

          // Skip if same content already exists for that role
          // (handles local temp-ID vs backend UUID mismatch that causes visible duplicates)
          if (role === 'assistant') {
            const chunks = msg.content.includes('<NOVA_MESSAGE_BREAK>')
              ? msg.content.split('<NOVA_MESSAGE_BREAK>').map((c: string) => c.trim()).filter(Boolean)
              : [msg.content];
            const contentSet = existingContentByRole.get('assistant') ?? new Set();
            // If ANY chunk already exists by content, skip the whole message
            if (chunks.some((c: string) => contentSet.has(c.trim()))) continue;
          } else {
            const contentSet = existingContentByRole.get(role) ?? new Set();
            if (contentSet.has(msg.content.trim())) continue;
          }

          // Only add messages newer than our latest (allow 60s clock skew)
          if (latestTimestamp && new Date(msg.created_at).getTime() < new Date(latestTimestamp).getTime() - 60000) continue;

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
            isTyping: false, // Reply received, clear typing indicator
          }));
          saveMessageCache([...get().messages], get().conversationId);
        }

        // Trigger proactive check (will only fire if > 4 hours since last user message)
        if (latestTimestamp) {
          proactiveReplyService.triggerProactiveCheck(latestTimestamp);
        }
      } catch (e) {
        console.warn('[PROACTIVE] Failed to check for new messages:', e);
      } finally {
        _proactiveCheckInProgress = false;
      }
    },
    
    processQueue
  };
});
