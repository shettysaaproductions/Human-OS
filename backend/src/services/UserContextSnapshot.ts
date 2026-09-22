/**
 * UserContextSnapshot — v2: Shared Hydration Foundation
 *
 * ONE CONTEXT HYDRATION per NACE pulse or chat turn.
 * Consumed by: NovaConsciousnessEngine, CognitiveContextService, SemanticTurnAgent
 *
 * v2 additions over Phase F:
 *  - short_term_memories (stm)
 *  - user_presence (direct table, not just working_memory derived)
 *  - emotional_states (latest)
 *  - episodic_memories (recent)
 *  - reflections (latest)
 *  - nova_actions (active/pending)
 *  - explicit completeness per-field
 *
 * BEFORE (per chat turn): 18+ parallel DB round-trips across CogCtx + chat route
 * AFTER  (with snapshot):  9 parallel DB round-trips, passed to ALL consumers
 *
 * Design invariants:
 *  - Immutable after hydration
 *  - Bounded queries — no full table scans
 *  - Private: one snapshot per userId, never shared across users
 *  - Partial failure degrades gracefully — isComplete=false, errors[] populated
 *  - Snapshot does NOT replace DB writes — stages still write outcomes to DB
 *  - ContextPacket (in ContextPacket.ts) is the LLM-facing bounded representation
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  preferred_name?: string;
  timezone?: string;
  timezone_offset?: number;
  push_token?: string;
  voice_mode?: boolean;
  preferred_language?: string;
  country?: string;
  companion_personality?: string;
  grammatical_gender?: string;
  current_visual_context?: string | null;
  nova_mode?: string;
  onboarding_complete?: boolean;
  created_at?: string;
  [key: string]: any;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  memory_type?: string;
  bubble_id?: string;
  importance_score?: number;
  importance?: number;
  confidence?: number;
  created_at?: string;
  is_current?: boolean;
}

export interface ShortTermMemoryEntry {
  id?: string;
  memory: string;
  emotion?: string;
  importance?: number;
  created_at?: string;
}

export interface LifeThreadEntry {
  id: string;
  topic: string;
  state: string;
  priority?: number;
  next_useful_step?: string;
  cultivation_stage?: string;
  category?: string;
  last_relevant_at?: string;
  canonical_key?: string;
  provenance?: string;
}

export interface AgendaItem {
  id: string;
  event_description: string;
  expected_time?: string;
  follow_up_question?: string;
  follow_up_after?: string;
  status: string;
  urgency?: string;
  retry_count?: number;
  max_retries?: number;
  next_retry_at?: string;
}

export interface OutreachRecord {
  id: string;
  /** The outreach message text (actual column in nova_outreach_log) */
  message?: string;
  outreach_type?: string;
  logical_key?: string;
  created_at?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reply_to_content?: string;
  created_at?: string;
}

export interface PresenceRecord {
  /** Raw status string from user_presence table */
  status?: string;
  /** Compatibility alias — same as presence_state */
  state?: string;
  last_active_at?: string;
  last_typing_at?: string;
  /** Derived from working_memory keys */
  voice_active?: boolean;
  /** Derived from working_memory keys */
  presence_state?: string;
}

export interface EpisodicEntry {
  id?: string;
  summary: string;
  emotion?: string;
  created_at?: string;
}

export interface EmotionalState {
  mood?: string;
  intensity?: number;
  notes?: string;
  created_at?: string;
}

export interface ReflectionEntry {
  summary?: string;
  key_takeaways?: string;
  created_at?: string;
}

export interface NovaActionEntry {
  id: string;
  logical_key?: string;
  title?: string;
  state: string;
  priority?: number;
  execution_class?: string;
  source_thread_id?: string;
  due_at?: string;
}

export interface UserContextSnapshot {
  /** The user this snapshot belongs to */
  userId: string;
  /** UTC ISO timestamp when snapshot was hydrated */
  hydratedAt: string;
  /** True if all 9 parallel fetches succeeded */
  isComplete: boolean;
  /** Non-fatal partial errors per source */
  errors: string[];

  // ── Profile & temporal ───────────────────────────────────────────────────
  profile: UserProfile | null;
  temporalContext: {
    hour: number;
    /** Day of week: 'Monday', 'Tuesday', etc. */
    dayOfWeek: string;
    isMorning: boolean;
    isAfternoon: boolean;
    isEvening: boolean;
    isNight: boolean;
    isSleepWindow: boolean;
    timeOfDayLabel: string;
    localIso: string;
    tzOffset: number;
    tzLabel: string;
  };

  // ── Presence & availability ──────────────────────────────────────────────
  /** Combined presence from user_presence table + working_memory keys */
  presence: PresenceRecord | null;
  /** Raw working memory key-value map */
  workingMemory: Map<string, string>;
  /** Working memory raw rows (for structured/CogCtx access) */
  workingMemoryRows: Array<{ key: string; value: string; promotion_status?: string; expires_at?: string }>;

  // ── Conversation ─────────────────────────────────────────────────────────
  /** Recent chat messages (last N, chronological order) */
  recentChat: ChatMessage[];
  /** Approximate token count of recentChat */
  recentChatTokenEstimate: number;

  // ── Memory ───────────────────────────────────────────────────────────────
  /** Long-term memories (bounded top-K, importance-sorted) */
  memories: MemoryEntry[];
  /** Short-term memories (bounded, recent) */
  shortTermMemories: ShortTermMemoryEntry[];
  /** Canonical entity bubbles */
  entityBubbles: Array<{ id: string; name: string; relation_type?: string; entity_type?: string; summary?: string }>;

  // ── Emotional & reflective state ─────────────────────────────────────────
  /** Latest emotional state */
  latestEmotion: EmotionalState | null;
  /** Recent episodic memories */
  recentEpisodic: EpisodicEntry[];
  /** Latest reflection */
  latestReflection: ReflectionEntry | null;

  // ── Goals / commitments ──────────────────────────────────────────────────
  /** Active life threads */
  lifeThreads: LifeThreadEntry[];
  /** Pending agenda items */
  pendingAgenda: AgendaItem[];
  /** Active/pending nova actions */
  novaActions: NovaActionEntry[];

  // ── Outreach history ─────────────────────────────────────────────────────
  /** Recent outreach log entries (for suppression checks) */
  recentOutreach: OutreachRecord[];
  /** Last outreach timestamp (ISO string or null) */
  lastOutreachAt: string | null;

  // ── Derived convenience fields ───────────────────────────────────────────
  /** True if 'followup_suppressed_until' is in the future */
  isSuppressed: boolean;
  /** True if any agenda item is overdue */
  hasOverdueAgenda: boolean;
  /** Effective minimum outreach gap in minutes */
  effectiveMinGapMinutes: number;
  /** True if user appears currently online (presence + working_memory) */
  isOnline: boolean;
}

// ── Hydration bounds ────────────────────────────────────────────────────────

const BOUNDS = {
  RECENT_CHAT: 20,
  MEMORIES: 30,
  LIFE_THREADS: 10,
  AGENDA: 20,
  OUTREACH: 5,
  ENTITY_BUBBLES: 25,
  STM: 15,
  EPISODIC: 5,
  ACTIONS: 10,
} as const;

// ── Helper ──────────────────────────────────────────────────────────────────

function extractResult(
  result: PromiseSettledResult<any>,
  errors: string[],
  label: string,
): any | null {
  if (result.status === 'rejected') {
    errors.push(`${label}: ${result.reason?.message || 'unknown'}`);
    return null;
  }
  const { data, error } = result.value;
  if (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
  return data;
}

// ── Main hydration function ─────────────────────────────────────────────────

/**
 * Hydrate a complete UserContextSnapshot for one user.
 * All 9 DB queries run in parallel (Promise.allSettled).
 * Non-fatal failures degrade to partial snapshot — errors[] populated.
 */
export async function hydrateUserContext(userId: string): Promise<UserContextSnapshot> {
  const hydratedAt = new Date().toISOString();
  const errors: string[] = [];

  // ── 9 parallel DB fetches ─────────────────────────────────────────────────
  const [
    profileResult,
    workingMemoryResult,
    agendaResult,
    outreachResult,
    chatResult,
    memoriesResult,
    lifeThreadsResult,
    entityBubblesResult,
    supplementalResult,
  ] = await Promise.allSettled([

    // 1. Profile (all fields needed by CogCtx, chat, NACE)
    supabaseAdmin
      .from('profiles')
      .select('id, preferred_name, timezone, timezone_offset, push_token, voice_mode, preferred_language, country, companion_personality, grammatical_gender, current_visual_context, nova_mode, onboarding_complete, created_at')
      .eq('id', userId)
      .maybeSingle(),

    // 2. Working memory (full, for CogCtx filtering)
    supabaseAdmin
      .from('working_memory')
      .select('key, value, promotion_status, expires_at')
      .eq('user_id', userId)
      .limit(100),

    // 3. Pending agenda (bounded)
    supabaseAdmin
      .from('nova_agenda')
      .select('id, event_description, expected_time, follow_up_question, follow_up_after, status, urgency, retry_count, max_retries, next_retry_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('expected_time', { ascending: true })
      .limit(BOUNDS.AGENDA),

    // 4. Recent outreach (suppression)
    supabaseAdmin
      .from('nova_outreach_log')
      .select('id, message, outreach_type, logical_key, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(BOUNDS.OUTREACH),

    // 5. Recent chat (last N, DESC — reversed to chrono below)
    supabaseAdmin
      .from('chat_history')
      .select('id, role, content, reply_to_content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(BOUNDS.RECENT_CHAT),

    // 6. Long-term memories (importance-sorted, with full CogCtx fields)
    supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type, bubble_id, importance_score, importance, confidence, created_at, is_current')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('importance_score', { ascending: false })
      .limit(BOUNDS.MEMORIES),

    // 7. Active life threads
    supabaseAdmin
      .from('life_threads')
      .select('id, topic, state, priority, next_useful_step, cultivation_stage, category, last_relevant_at, canonical_key, provenance')
      .eq('user_id', userId)
      .in('state', ['active', 'waiting', 'blocked'])
      .order('last_relevant_at', { ascending: false })
      .limit(BOUNDS.LIFE_THREADS),

    // 8. Canonical entity bubbles
    supabaseAdmin
      .from('memory_bubbles')
      .select('id, name, relation_type, entity_type, summary')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .limit(BOUNDS.ENTITY_BUBBLES),

    // 9. Supplemental: STM + user_presence + emotion + episodic + reflection + actions
    //    Batched as a single Promise.allSettled to keep the outer allSettled clean
    Promise.allSettled([
      supabaseAdmin
        .from('short_term_memories')
        .select('id, memory, emotion, importance, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(BOUNDS.STM),

      supabaseAdmin
        .from('user_presence')
        .select('status, last_active_at, last_typing_at')
        .eq('user_id', userId)
        .maybeSingle(),

      supabaseAdmin
        .from('emotional_states')
        .select('mood, intensity, notes, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabaseAdmin
        .from('episodic_memories')
        .select('summary, emotion, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(BOUNDS.EPISODIC),

      supabaseAdmin
        .from('reflections')
        .select('summary, key_takeaways, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabaseAdmin
        .from('nova_actions')
        .select('id, logical_key, title, state, priority, execution_class, source_thread_id, due_at')
        .eq('user_id', userId)
        .in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked'])
        .order('created_at', { ascending: false })
        .limit(BOUNDS.ACTIONS),
    ]),
  ]);

  // ── Extract core results ──────────────────────────────────────────────────

  const profile = extractResult(profileResult, errors, 'profile') as UserProfile | null;
  const workingMemoryRaw = extractResult(workingMemoryResult, errors, 'working_memory') as Array<any> || [];
  const pendingAgenda = extractResult(agendaResult, errors, 'nova_agenda') as AgendaItem[] || [];
  const recentOutreach = extractResult(outreachResult, errors, 'outreach') as OutreachRecord[] || [];
  const chatRaw = extractResult(chatResult, errors, 'chat_history') as ChatMessage[] || [];
  const memoriesRaw = extractResult(memoriesResult, errors, 'memories') as MemoryEntry[] || [];
  const lifeThreadsRaw = extractResult(lifeThreadsResult, errors, 'life_threads') as LifeThreadEntry[] || [];
  const entityBubbles = extractResult(entityBubblesResult, errors, 'entity_bubbles') as any[] || [];

  // ── Extract supplemental results ──────────────────────────────────────────

  let shortTermMemories: ShortTermMemoryEntry[] = [];
  let presenceRow: any = null;
  let latestEmotion: EmotionalState | null = null;
  let recentEpisodic: EpisodicEntry[] = [];
  let latestReflection: ReflectionEntry | null = null;
  let novaActions: NovaActionEntry[] = [];

  if (supplementalResult.status === 'fulfilled') {
    const [stmR, presR, emotR, episR, reflR, actR] = supplementalResult.value;
    shortTermMemories = (stmR.status === 'fulfilled' ? stmR.value?.data : null) || [];
    presenceRow = (presR.status === 'fulfilled' ? presR.value?.data : null) || null;
    latestEmotion = (emotR.status === 'fulfilled' ? emotR.value?.data : null) || null;
    recentEpisodic = (episR.status === 'fulfilled' ? episR.value?.data : null) || [];
    latestReflection = (reflR.status === 'fulfilled' ? reflR.value?.data : null) || null;
    novaActions = (actR.status === 'fulfilled' ? actR.value?.data : null) || [];
    if (stmR.status === 'rejected') errors.push(`stm: ${stmR.reason?.message || 'unknown'}`);
    if (presR.status === 'rejected') errors.push(`user_presence: ${presR.reason?.message || 'unknown'}`);
    if (emotR.status === 'rejected') errors.push(`emotional_states: ${emotR.reason?.message || 'unknown'}`);
    if (episR.status === 'rejected') errors.push(`episodic_memories: ${episR.reason?.message || 'unknown'}`);
    if (reflR.status === 'rejected') errors.push(`reflections: ${reflR.reason?.message || 'unknown'}`);
    if (actR.status === 'rejected') errors.push(`nova_actions: ${actR.reason?.message || 'unknown'}`);
  } else {
    errors.push(`supplemental: ${supplementalResult.reason?.message || 'unknown'}`);
  }

  // ── Build working memory map ──────────────────────────────────────────────

  const now = new Date().toISOString();
  const workingMemoryRows = workingMemoryRaw.filter((r: any) =>
    r.promotion_status !== 'SUPERSEDED' &&
    r.promotion_status !== 'INVALIDATED' &&
    (!r.expires_at || r.expires_at > now)
  );
  const workingMemory = new Map<string, string>();
  for (const row of workingMemoryRows) {
    if (row.key) workingMemory.set(row.key, row.value || '');
  }

  // ── Derived presence (combined table + working_memory) ────────────────────

  const wmPresenceState = workingMemory.get('presence_state') || workingMemory.get('user_status');
  const isVoice = workingMemory.get('voice_session_active') === 'true';
  const presence: PresenceRecord | null = (presenceRow || wmPresenceState || isVoice)
    ? {
        status: presenceRow?.status,
        state: presenceRow?.status || wmPresenceState,  // compatibility alias for NACE
        last_active_at: presenceRow?.last_active_at,
        last_typing_at: presenceRow?.last_typing_at,
        voice_active: isVoice,
        presence_state: wmPresenceState,
      }
    : null;

  const isOnline =
    presenceRow?.status === 'online' ||
    wmPresenceState === 'online' ||
    (() => {
      if (!presenceRow?.last_active_at) return false;
      const lastActive = new Date(presenceRow.last_active_at).getTime();
      return (Date.now() - lastActive) < 5 * 60 * 1000; // active within 5 min
    })();

  // ── Derived suppression ───────────────────────────────────────────────────

  const suppressedUntil = workingMemory.get('followup_suppressed_until');
  const isSuppressed = suppressedUntil != null && new Date(suppressedUntil) > new Date();

  // ── Derived chat order (reverse DESC to chronological) ────────────────────

  const recentChat = chatRaw.slice().reverse();
  const recentChatTokenEstimate = recentChat.reduce(
    (sum, m) => sum + Math.ceil((m.content?.length || 0) / 4), 0
  );

  // ── Last outreach ─────────────────────────────────────────────────────────

  const lastOutreachAt = recentOutreach.length > 0 ? (recentOutreach[0].created_at || null) : null;

  // ── Overdue agenda ────────────────────────────────────────────────────────

  const nowDate = new Date();
  const hasOverdueAgenda = pendingAgenda.some(a => {
    const checkTime = a.next_retry_at || a.expected_time || '';
    return checkTime && new Date(checkTime) < nowDate;
  });

  // ── Temporal context ──────────────────────────────────────────────────────

  const tzOffset = profile?.timezone_offset ?? 5.5;
  const nowUtc = new Date();
  const localMs = nowUtc.getTime() + tzOffset * 3600000;
  const localDate = new Date(localMs);
  const localHour = localDate.getUTCHours();
  const tzLabel = tzOffset === 5.5 ? 'IST' : `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const temporalContext = {
    hour: localHour,
    dayOfWeek: DAY_NAMES[localDate.getUTCDay()],
    isMorning: localHour >= 6 && localHour < 12,
    isAfternoon: localHour >= 12 && localHour < 17,
    isEvening: localHour >= 17 && localHour < 21,
    isNight: localHour >= 21 || localHour < 6,
    isSleepWindow: localHour >= 23 || localHour < 6,
    timeOfDayLabel: (() => {
      if (localHour >= 6 && localHour < 12) return 'morning';
      if (localHour >= 12 && localHour < 17) return 'afternoon';
      if (localHour >= 17 && localHour < 21) return 'evening';
      return 'night';
    })(),
    localIso: localDate.toISOString(),
    tzOffset,
    tzLabel,
  };

  // ── Effective min gap ─────────────────────────────────────────────────────

  const effectiveMinGapMinutes = isOnline ? 1 : 15;

  // ── Assemble snapshot ─────────────────────────────────────────────────────

  const snapshot: UserContextSnapshot = {
    userId,
    hydratedAt,
    isComplete: errors.length === 0,
    errors,
    profile,
    temporalContext,
    presence,
    workingMemory,
    workingMemoryRows,
    recentChat,
    recentChatTokenEstimate,
    memories: memoriesRaw,
    shortTermMemories,
    entityBubbles,
    latestEmotion,
    recentEpisodic,
    latestReflection,
    lifeThreads: lifeThreadsRaw,
    pendingAgenda,
    novaActions,
    recentOutreach,
    lastOutreachAt,
    isSuppressed,
    hasOverdueAgenda,
    effectiveMinGapMinutes,
    isOnline,
  };

  logger.info('[UserContextSnapshot] Hydrated v2', {
    userId,
    errors: errors.length,
    chat: recentChat.length,
    memories: memoriesRaw.length,
    stm: shortTermMemories.length,
    lifeThreads: lifeThreadsRaw.length,
    agenda: pendingAgenda.length,
    outreach: recentOutreach.length,
    entities: entityBubbles.length,
    actions: novaActions.length,
    tokenEstimate: recentChatTokenEstimate,
    isSuppressed,
    hasOverdueAgenda,
    isOnline,
    isComplete: errors.length === 0,
  });

  return snapshot;
}

// ── Typed accessor helpers ───────────────────────────────────────────────────

/** Get a working memory value by key. */
export function snapshotWM(snapshot: UserContextSnapshot, key: string): string | null {
  return snapshot.workingMemory.get(key) ?? null;
}

/** Get an entity bubble by relation_type. */
export function snapshotEntity(
  snapshot: UserContextSnapshot,
  relationType: string,
): typeof snapshot.entityBubbles[0] | null {
  return snapshot.entityBubbles.find(e =>
    e.relation_type?.toLowerCase() === relationType.toLowerCase()
  ) ?? null;
}

/** Get a life thread by topic (case-insensitive partial match). */
export function snapshotThread(
  snapshot: UserContextSnapshot,
  topic: string,
): LifeThreadEntry | null {
  const lower = topic.toLowerCase();
  return snapshot.lifeThreads.find(t =>
    t.topic.toLowerCase().includes(lower)
  ) ?? null;
}

/** Check if a busy window key is active in working memory. */
export function snapshotIsBusyWindow(snapshot: UserContextSnapshot): boolean {
  const val = snapshot.workingMemory.get('busy_window');
  if (!val) return false;
  try { return new Date(val) > new Date(); } catch { return false; }
}

/** Get timezone offset (hours). */
export function snapshotTzOffset(snapshot: UserContextSnapshot): number {
  return snapshot.profile?.timezone_offset ?? 5.5;
}
