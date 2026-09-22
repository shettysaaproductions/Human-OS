/**
 * UserContextSnapshot — Phase F: Shared Context Hydration Layer
 *
 * ONE CONTEXT HYDRATION per NACE pulse (or chat turn), reused across all decision stages.
 *
 * BEFORE (per-user pulse):  30+ sequential DB round-trips across 8 tables
 * AFTER  (with snapshot):   8 parallel DB round-trips, cached for full pulse duration
 *
 * Provides:
 *   - profile + timezone
 *   - temporal context
 *   - presence / availability
 *   - working memory (key-value)
 *   - recent conversation (bounded top-K)
 *   - relevant memories (bounded top-K)
 *   - canonical entities (memory_bubbles)
 *   - life threads (active)
 *   - agenda items (pending)
 *   - recent outreach (for suppression)
 *
 * Design invariants:
 *   - Snapshot is immutable after hydration (no in-place mutation by downstream stages)
 *   - Bounded queries only — no full table scans
 *   - Token-efficient: only columns/rows needed for decision-making
 *   - Private: snapshot is per-userId, never shared across users
 *   - Snapshot does NOT replace DB writes — stages still write outcomes to DB
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

// ── Snapshot type ────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  display_name?: string;
  timezone?: string;
  timezone_offset?: number;
  push_token?: string;
  voice_mode?: boolean;
  preferred_language?: string;
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
  message_preview?: string;
  sent_at?: string;
  source?: string;
  channel?: string;
  created_at?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface UserContextSnapshot {
  /** The user this snapshot belongs to */
  userId: string;
  /** UTC ISO timestamp when snapshot was hydrated */
  hydratedAt: string;
  /** True if snapshot hydration fully succeeded */
  isComplete: boolean;
  /** Partial errors (non-fatal — snapshot is still usable) */
  errors: string[];

  // ── Profile & temporal ───────────────────────────────────────────────────
  profile: UserProfile | null;
  temporalContext: Record<string, any>;

  // ── Presence & availability ──────────────────────────────────────────────
  /** Latest presence row */
  presence: Record<string, any> | null;
  /** Raw working memory key-value map */
  workingMemory: Map<string, string>;
  /** Working memory raw rows (for structured access) */
  workingMemoryRows: Array<{ key: string; value: string; updated_at?: string }>;

  // ── Conversation ─────────────────────────────────────────────────────────
  /** Recent chat messages (bounded: last N) */
  recentChat: ChatMessage[];
  /** Approximate token count of recentChat (rough estimate) */
  recentChatTokenEstimate: number;

  // ── Memory ───────────────────────────────────────────────────────────────
  /** Relevant memories (bounded top-K, importance-sorted) */
  memories: MemoryEntry[];
  /** Canonical entity bubbles */
  entityBubbles: Array<{ id: string; name: string; relation_type?: string; entity_type?: string; summary?: string }>;

  // ── Goals / commitments ──────────────────────────────────────────────────
  /** Active life threads */
  lifeThreads: LifeThreadEntry[];
  /** Pending agenda items */
  pendingAgenda: AgendaItem[];

  // ── Outreach history ─────────────────────────────────────────────────────
  /** Recent outreach log entries (for suppression checks) */
  recentOutreach: OutreachRecord[];
  /** Last outreach timestamp (ISO string or null) */
  lastOutreachAt: string | null;

  // ── Derived convenience fields ───────────────────────────────────────────
  /** True if working memory contains 'followup_suppressed_until' in the future */
  isSuppressed: boolean;
  /** True if any agenda item is overdue */
  hasOverdueAgenda: boolean;
  /** Effective minimum outreach gap in minutes (based on presence/mode) */
  effectiveMinGapMinutes: number;
}

// ── Hydration bounds ────────────────────────────────────────────────────────

const BOUNDS = {
  RECENT_CHAT: 20,          // Last N chat messages
  MEMORIES: 30,             // Top-K memories by importance
  LIFE_THREADS: 10,         // Active life threads
  AGENDA: 20,               // Pending agenda items
  OUTREACH: 5,              // Recent outreach log entries
  ENTITY_BUBBLES: 25,       // Canonical entity bubbles
} as const;

// ── Hydration function ──────────────────────────────────────────────────────

/**
 * Hydrate a complete UserContextSnapshot for one user.
 *
 * All DB queries run in parallel (Promise.all) — not sequentially.
 * Non-fatal query failures downgrade to partial snapshot (errors logged).
 */
export async function hydrateUserContext(userId: string): Promise<UserContextSnapshot> {
  const hydratedAt = new Date().toISOString();
  const errors: string[] = [];

  // ── 8 parallel DB fetches ──────────────────────────────────────────────
  const [
    profileResult,
    workingMemoryResult,
    agendaResult,
    outreachResult,
    chatResult,
    memoriesResult,
    lifeThreadsResult,
    entityBubblesResult,
  ] = await Promise.allSettled([
    // 1. Profile
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, timezone, timezone_offset, push_token, voice_mode, preferred_language, created_at, onboarding_complete, nova_mode')
      .eq('id', userId)
      .maybeSingle(),

    // 2. Working memory
    supabaseAdmin
      .from('working_memory')
      .select('key, value, updated_at')
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

    // 4. Recent outreach
    supabaseAdmin
      .from('nova_outreach_log')
      .select('id, message_preview, sent_at, source, channel, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(BOUNDS.OUTREACH),

    // 5. Recent chat (last N messages)
    supabaseAdmin
      .from('chat_history')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(BOUNDS.RECENT_CHAT),

    // 6. Top memories by importance
    supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type, bubble_id, importance_score, created_at')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('importance_score', { ascending: false })
      .limit(BOUNDS.MEMORIES),

    // 7. Active life threads
    supabaseAdmin
      .from('life_threads')
      .select('id, topic, state, priority, next_useful_step, cultivation_stage, category, last_relevant_at, canonical_key')
      .eq('user_id', userId)
      .eq('state', 'active')
      .order('last_relevant_at', { ascending: false })
      .limit(BOUNDS.LIFE_THREADS),

    // 8. Canonical entity bubbles
    supabaseAdmin
      .from('memory_bubbles')
      .select('id, name, relation_type, entity_type, summary')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .limit(BOUNDS.ENTITY_BUBBLES),
  ]);

  // ── Extract results ──────────────────────────────────────────────────────

  const profile = extractResult(profileResult, errors, 'profile') as UserProfile | null;
  const workingMemoryRows = extractResult(workingMemoryResult, errors, 'working_memory') as Array<{ key: string; value: string; updated_at?: string }> || [];
  const pendingAgenda = extractResult(agendaResult, errors, 'nova_agenda') as AgendaItem[] || [];
  const recentOutreach = extractResult(outreachResult, errors, 'outreach') as OutreachRecord[] || [];
  const chatRaw = extractResult(chatResult, errors, 'chat_history') as ChatMessage[] || [];
  const memories = extractResult(memoriesResult, errors, 'memories') as MemoryEntry[] || [];
  const lifeThreads = extractResult(lifeThreadsResult, errors, 'life_threads') as LifeThreadEntry[] || [];
  const entityBubbles = extractResult(entityBubblesResult, errors, 'entity_bubbles') as any[] || [];

  // ── Derive presence from working memory ─────────────────────────────────
  // Presence is stored in working_memory with key 'user_presence_state' or similar
  const workingMemory = new Map<string, string>();
  for (const row of workingMemoryRows) {
    if (row.key) workingMemory.set(row.key, row.value || '');
  }

  // Check suppression
  const suppressedUntil = workingMemory.get('followup_suppressed_until');
  const isSuppressed = suppressedUntil != null && new Date(suppressedUntil) > new Date();

  // Recent chat — reverse to chronological order (we fetched DESC)
  const recentChat = chatRaw.slice().reverse();

  // Token estimate (rough: 4 chars per token)
  const recentChatTokenEstimate = recentChat.reduce((sum, m) => sum + Math.ceil((m.content?.length || 0) / 4), 0);

  // Last outreach
  const lastOutreachAt = recentOutreach.length > 0 ? (recentOutreach[0].created_at || null) : null;

  // Overdue agenda check
  const now = new Date();
  const hasOverdueAgenda = pendingAgenda.some(a => {
    if (!a.next_retry_at && !a.expected_time) return false;
    const checkTime = a.next_retry_at || a.expected_time || '';
    return checkTime && new Date(checkTime) < now;
  });

  // Temporal context — compute synchronously from profile timezone offset
  // TemporalAwarenessService.getContext() is async and requires a DB call,
  // so we compute a lightweight version here using the profile's tzOffset.
  let temporalContext: Record<string, any> = {};
  try {
    const tzOffset = profile?.timezone_offset ?? 5.5;
    // Lightweight temporal context without a DB call
    const nowUtc = new Date();
    const localHour = (nowUtc.getUTCHours() + tzOffset) % 24;
    const hourInt = Math.floor(localHour);
    const isMorning = hourInt >= 6 && hourInt < 12;
    const isAfternoon = hourInt >= 12 && hourInt < 17;
    const isEvening = hourInt >= 17 && hourInt < 21;
    const isNight = hourInt >= 21 || hourInt < 6;
    const isSleepWindow = hourInt >= 23 || hourInt < 6;
    temporalContext = {
      hour: hourInt,
      isMorning,
      isAfternoon,
      isEvening,
      isNight,
      isSleepWindow,
      timeOfDayLabel: isMorning ? 'morning' : isAfternoon ? 'afternoon' : isEvening ? 'evening' : 'night',
      localIso: new Date(nowUtc.getTime() + tzOffset * 3600000).toISOString(),
    };
  } catch (e: any) {
    errors.push(`temporal: ${e.message}`);
  }

  // Presence (from working memory keys)
  const presence: Record<string, any> | null = (() => {
    const presenceState = workingMemory.get('presence_state') || workingMemory.get('user_status');
    const isVoice = workingMemory.get('voice_session_active') === 'true';
    if (!presenceState && !isVoice) return null;
    return { state: presenceState, voice_active: isVoice };
  })();

  // Effective min gap
  const isOnline = workingMemory.get('presence_state') === 'online';
  const effectiveMinGapMinutes = isOnline ? 1 : 15;

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
    memories,
    entityBubbles,
    lifeThreads,
    pendingAgenda,
    recentOutreach,
    lastOutreachAt,
    isSuppressed,
    hasOverdueAgenda,
    effectiveMinGapMinutes,
  };

  logger.info('[UserContextSnapshot] Hydrated', {
    userId,
    errors: errors.length,
    chat: recentChat.length,
    memories: memories.length,
    lifeThreads: lifeThreads.length,
    agenda: pendingAgenda.length,
    outreach: recentOutreach.length,
    entities: entityBubbles.length,
    tokenEstimate: recentChatTokenEstimate,
    isSuppressed,
    hasOverdueAgenda,
  });

  return snapshot;
}

/**
 * Helper to safely extract data from a PromiseSettledResult.
 * Non-fatal: logs error and returns null/[] on failure.
 */
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

/**
 * Get a working memory value from snapshot (type-safe convenience).
 */
export function snapshotWM(snapshot: UserContextSnapshot, key: string): string | null {
  return snapshot.workingMemory.get(key) ?? null;
}

/**
 * Get an entity bubble from snapshot by relation_type.
 */
export function snapshotEntity(
  snapshot: UserContextSnapshot,
  relationType: string,
): typeof snapshot.entityBubbles[0] | null {
  return snapshot.entityBubbles.find(e =>
    e.relation_type?.toLowerCase() === relationType.toLowerCase()
  ) ?? null;
}
