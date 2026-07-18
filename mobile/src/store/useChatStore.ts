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
  set_isTyping: (v: boolean) => void;
}

// ── Processing lock + in-flight deduplication ────────────────────────────────
let _isProcessing = false;
let _lockTimestamp: number = 0;
const _inFlightIds = new Set<string>();

// ── Proactive check lock — prevents simultaneous duplicate checks ──────────────
let _proactiveCheckInProgress = false;

// ── Reply-wait polling — unified poller that covers both foreground and post-restart ──
// Only one poller runs at a time. Checks every 3 seconds while isTyping=true.
// Max 120 polls = 6 minutes, then gives up and marks message as delivered
// (backend already has it, just waiting is pointless).
let _replyPollTimer: ReturnType<typeof setInterval> | null = null;
let _replyPollCount = 0;
const MAX_REPLY_POLLS = 120; // 6 minutes

function startReplyPolling(checkFn: () => Promise<void>) {
  if (_replyPollTimer) return; // already running
  _replyPollCount = 0;
  _replyPollTimer = setInterval(async () => {
    _replyPollCount++;
    const live = useChatStore.getState();

    // Stop if reply arrived
    if (!live.isTyping) {
      stopReplyPolling();
      return;
    }

    // After max polls — give up waiting, clear typing indicator
    // The message was sent and delivered to server (202 confirmed).
    // The reply IS in the DB, user will see it next time they open the app.
    if (_replyPollCount > MAX_REPLY_POLLS) {
      console.warn('[REPLY_POLL] Max polls reached. Stopping. Reply will load on next open.');
      stopReplyPolling();
      useChatStore.getState().set_isTyping(false);
      return;
    }

    await checkFn();
  }, 3000);
  console.log('[REPLY_POLL] Started (3s interval, max 6min)');
}

function stopReplyPolling() {
  if (_replyPollTimer) {
    clearInterval(_replyPollTimer);
    _replyPollTimer = null;
    _replyPollCount = 0;
    console.log('[REPLY_POLL] Stopped');
  }
}

// ── Queue watchdog — rescues stuck send queues ────────────────────────
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;
function startQueueWatchdog(processQueueFn: () => Promise<void>) {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(() => {
    if (_isProcessing && _lockTimestamp > 0 && Date.now() - _lockTimestamp > 90_000) {
      console.warn('[WATCHDOG] Force-releasing stale processQueue lock after 90s');
      _isProcessing = false;
      _lockTimestamp = 0;
    }
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
const DELIVERED_KEY = 'humanOs_deliveredIds';

// ── Awaiting-reply persistence — survives app restarts ────────────────────
// Stores conversationId + timestamp of last sent user message.
// On restart: if last DB message is still a user msg, resume polling.
const AWAITING_REPLY_KEY = 'humanOs_awaitingReply';
async function saveAwaitingReply(conversationId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(AWAITING_REPLY_KEY, JSON.stringify({ convId: conversationId, ts: Date.now() }));
  } catch {}
}
async function clearAwaitingReply(): Promise<void> {
  try { await SecureStore.deleteItemAsync(AWAITING_REPLY_KEY); } catch {}
}
async function loadAwaitingReply(): Promise<{ convId: string; ts: number } | null> {
  try {
    const raw = await SecureStore.getItemAsync(AWAITING_REPLY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Expire after 30 minutes — backend may be slow under load; 10 was too short
    if (Date.now() - parsed.ts > 30 * 60 * 1000) {
      await clearAwaitingReply();
      return null;
    }
    return parsed;
  } catch { return null; }
}

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

        // Check delivered status — skip if already processed, but DON'T remove from store
        // (removing from store mid-render causes the "message deleted" bug the user sees)
        const deliveredIds = await loadDeliveredIds();
        if (deliveredIds.has(primaryId)) {
          _inFlightIds.delete(primaryId);
          // Message already sent — just start polling for the reply
          startReplyPolling(get().checkProactiveMessages);
          continue;
        }

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

            // ── Update message status to 'sent' in store ─────────────────
            set((s) => ({
              conversationId: convId,
              isTyping: true, // Keep true until reply arrives
              messages: s.messages.map(m =>
                batch.some(b => b.id === m.id) 
                  ? { ...m, status: 'sent' as const, id: m.id === primaryId ? (data.user_message_id || m.id) : m.id } 
                  : m
              ),
            }));

            // ── Mark as delivered IMMEDIATELY after success ─────────────────
            await markDelivered(primaryId);
            
            // ── Save awaiting-reply state so a restart can resume polling ──────
            await saveAwaitingReply(convId);

            // ── Save message cache immediately so closing the app doesn't lose the message ──
            // This is the fix for "message deleted on reopen" — the cache must include
            // the sent message so it's available on cold start even before the DB fetch.
            saveMessageCache(get().messages, convId).catch(() => {});

            // ── Start unified reply poller ─────────────────────────────────────
            // This covers foreground use. If app is minimized, push notification
            // fires checkProactiveMessages directly via notificationService callback.
            startReplyPolling(get().checkProactiveMessages);

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
    set_isTyping: (v: boolean) => set({ isTyping: v }),
    
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
        // Filter out backend fallback and LLM-hallucinated refusal messages from UI
        // These should never appear as chat bubbles to the user
        const MOBILE_FALLBACK_FILTER = [
          'Yaar, kuch technical issue',
          'Thodi der mein phir try karo',
          'kuch technical issue aa gaya',
          'reminder set nahi kar sakta',
          'reminder system thoda busy',
          'Nova ka reminder system',
          'system busy hai',
        ];
        const isBadMessage = (content: string) =>
          MOBILE_FALLBACK_FILTER.some(p => content.includes(p));

        const formattedHistory: Message[] = [];
          for (const msg of history) {
            // Skip bad messages entirely — don't show in UI
            if (msg.role === 'assistant' && isBadMessage(msg.content)) continue;
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

          // ── Resume reply-wait polling if we were waiting for Nova's reply ──────────────
          // Check persisted awaiting-reply flag AND confirm the last DB message is
          // still a user message (not yet replied to).
          // CRITICAL: we check freshMessages (DB truth), NOT formattedHistory only.
          const awaiting = await loadAwaitingReply();
          if (awaiting) {
            // Find the actual last message from DB (ignore restored pending msgs)
            const lastDbMsg = formattedHistory[formattedHistory.length - 1];
            const lastDbMsgIsUser = lastDbMsg?.role === 'user';
            if (lastDbMsgIsUser) {
              console.log('[HYDRATE] Resuming reply-wait polling — no reply received yet');
              set({ isTyping: true });
              // Start fresh poller — stops automatically when reply arrives
              stopReplyPolling();
              startReplyPolling(get().checkProactiveMessages);
            } else {
              // Reply already in DB — mark as received and stop waiting
              console.log('[HYDRATE] Reply already in DB, clearing awaiting flag');
              clearAwaitingReply();
              // Make sure isTyping is false (could be stale from prev session)
              set({ isTyping: false });
            }
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

    // ── Proactive message check: called when push arrives or app foregrounds ───
    // Fetches any messages Nova sent while the app was backgrounded/minimized.
    // Guarded by a lock so rapid back-to-back calls don't produce duplicates.
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

          // NOTE: Timestamp filter intentionally removed — the ID+content dedup above
          // is comprehensive and prevents duplicates. The timestamp filter was silently
          // rejecting Nova's proactive follow-up messages when isTyping was false.

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
            isTyping: false,
          }));
          // Reply arrived — stop the poller and clear the persistent awaiting flag
          stopReplyPolling();
          clearAwaitingReply();
          saveMessageCache([...get().messages], get().conversationId);
        }

        // ── isTyping self-heal: if we're still 'typing' but the store already has
        // an assistant reply as the VERY LAST message, the reply was added without
        // clearing isTyping (e.g. via hydrateMessages after restart). Fix it.
        // NOTE: Only do this if newMessages is empty — if we just found new msgs
        // above, isTyping was already set to false.
        if (newMessages.length === 0 && get().isTyping) {
          const storeMsgs = get().messages;
          const lastStoreMsg = storeMsgs[storeMsgs.length - 1];
          if (lastStoreMsg?.role === 'assistant') {
            console.log('[PROACTIVE] Self-healing: isTyping stuck true but reply already in store');
            set({ isTyping: false });
            stopReplyPolling();
            clearAwaitingReply();
          }
        }

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
