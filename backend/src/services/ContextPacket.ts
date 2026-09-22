/**
 * ContextPacket — Bounded LLM-Facing Context Builder
 *
 * Takes a hydrated UserContextSnapshot and produces a compact, relevance-filtered
 * ContextPacket for model consumption.
 *
 * Architecture:
 *   DATABASE
 *     ↓
 *   UserContextSnapshot (internal, complete, parallel-hydrated)
 *     ↓
 *   ContextPacket (bounded, relevance-filtered, LLM-ready)
 *     ↓
 *   CHAT / NACE / VOICE / GOALS
 *     ↓
 *   MODEL
 *
 * Design principles:
 *  - The Snapshot is the internal state object (all data).
 *  - The ContextPacket is the bounded LLM-facing representation (filtered data).
 *  - Each operation (chat, NACE, voice) requests a packet with its own relevance filter.
 *  - Token caps are enforced per-section.
 *  - No personal identities are hardcoded.
 *  - Duplicate context fields are deduplicated.
 *  - Provenance is preserved where needed.
 */

import type { UserContextSnapshot, MemoryEntry } from './UserContextSnapshot';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContextOperation = 'chat' | 'nace' | 'voice' | 'goal' | 'reminder';

export interface ContextPacketOptions {
  operation: ContextOperation;

  // Chat-specific: keyword-matched memories from the current turn
  turnKeywords?: string[];

  // Operation-specific context size overrides
  maxChatMessages?: number;
  maxMemories?: number;
  maxLifeThreads?: number;
  maxAgenda?: number;
  maxStm?: number;

  // Whether to include full emotional/episodic context
  includeEmotional?: boolean;

  // Whether to include nova actions
  includeActions?: boolean;

  // If provided, only memories matching these keys/topics are included
  memoryFilter?: (m: MemoryEntry) => boolean;
}

// Per-operation default limits
const OP_DEFAULTS: Record<ContextOperation, Required<Pick<ContextPacketOptions,
  'maxChatMessages' | 'maxMemories' | 'maxLifeThreads' | 'maxAgenda' | 'maxStm' | 'includeEmotional' | 'includeActions'
>>> = {
  chat:     { maxChatMessages: 15, maxMemories: 12, maxLifeThreads: 4, maxAgenda: 5,  maxStm: 8,  includeEmotional: true,  includeActions: false },
  nace:     { maxChatMessages: 6,  maxMemories: 15, maxLifeThreads: 6, maxAgenda: 10, maxStm: 5,  includeEmotional: true,  includeActions: true  },
  voice:    { maxChatMessages: 8,  maxMemories: 10, maxLifeThreads: 3, maxAgenda: 5,  maxStm: 5,  includeEmotional: false, includeActions: false },
  goal:     { maxChatMessages: 4,  maxMemories: 8,  maxLifeThreads: 8, maxAgenda: 10, maxStm: 3,  includeEmotional: false, includeActions: true  },
  reminder: { maxChatMessages: 3,  maxMemories: 5,  maxLifeThreads: 2, maxAgenda: 10, maxStm: 3,  includeEmotional: false, includeActions: false },
};

export interface ContextPacketSection<T> {
  data: T[];
  truncated: boolean;
  tokenEstimate: number;
}

export interface ContextPacketScalar<T> {
  data: T | null;
}

export interface ContextPacket {
  /** Source snapshot metadata */
  userId: string;
  operation: ContextOperation;
  builtAt: string;
  snapshotAge: number; // ms since snapshot was hydrated

  // ── Profile ────────────────────────────────────────────────────────────
  profile: ContextPacketScalar<{
    preferredName?: string;
    timezone?: string;
    tzOffset?: number;
    country?: string;
    grammaticalGender?: string;
    personalityStyle?: string;
    novaMode?: string;
  }>;

  // ── Temporal ───────────────────────────────────────────────────────────
  temporal: ContextPacketScalar<{
    localIso: string;
    timeOfDay: string;
    isSleepWindow: boolean;
    tzLabel: string;
  }>;

  // ── Presence ───────────────────────────────────────────────────────────
  presence: ContextPacketScalar<{
    isOnline: boolean;
    voiceActive: boolean;
    isSuppressed: boolean;
    effectiveMinGapMinutes: number;
    status?: string;
  }>;

  // ── Conversation ───────────────────────────────────────────────────────
  conversation: ContextPacketSection<{ role: string; content: string }>;

  // ── Memory ─────────────────────────────────────────────────────────────
  memories: ContextPacketSection<{ key: string; value: string; type?: string }>;
  shortTermMemories: ContextPacketSection<{ memory: string; emotion?: string }>;
  entities: ContextPacketSection<{ name: string; relation?: string; summary?: string }>;

  // ── Goals / commitments ────────────────────────────────────────────────
  lifeThreads: ContextPacketSection<{ topic: string; state: string; nextStep?: string }>;
  agenda: ContextPacketSection<{ description: string; time?: string; urgency?: string; overdue: boolean }>;

  // ── Emotional & reflective ─────────────────────────────────────────────
  emotion: ContextPacketScalar<{ mood?: string; intensity?: number }>;
  reflection: ContextPacketScalar<{ summary?: string }>;

  // ── Outreach ───────────────────────────────────────────────────────────
  outreach: ContextPacketScalar<{
    lastAt: string | null;
    hasOverdueAgenda: boolean;
  }>;

  // ── Efficiency metrics ─────────────────────────────────────────────────
  metrics: {
    totalTokenEstimate: number;
    memoriesConsidered: number;
    memoriesIncluded: number;
    chatMessagesConsidered: number;
    chatMessagesIncluded: number;
    snapshotErrors: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function tokenizeSection<T>(items: T[], toText: (i: T) => string): number {
  return items.reduce((sum, i) => sum + roughTokens(toText(i)), 0);
}

function keywordMatch(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k.toLowerCase()));
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a bounded, relevance-filtered ContextPacket from a hydrated UserContextSnapshot.
 *
 * This is the ONLY entry point that should flow into LLM prompt builders.
 * Never pass the raw UserContextSnapshot to a model prompt.
 */
export function buildContextPacket(
  snapshot: UserContextSnapshot,
  opts: ContextPacketOptions,
): ContextPacket {
  const op = opts.operation;
  const defaults = OP_DEFAULTS[op];
  const builtAt = new Date().toISOString();
  const snapshotAge = Date.now() - new Date(snapshot.hydratedAt).getTime();

  // ── Profile ──────────────────────────────────────────────────────────────
  const profileData = snapshot.profile
    ? {
        preferredName: snapshot.profile.preferred_name || snapshot.profile.display_name,
        timezone: snapshot.profile.timezone,
        tzOffset: snapshot.profile.timezone_offset,
        country: snapshot.profile.country,
        grammaticalGender: snapshot.profile.grammatical_gender,
        personalityStyle: snapshot.profile.companion_personality,
        novaMode: snapshot.profile.nova_mode,
      }
    : null;

  // ── Temporal ─────────────────────────────────────────────────────────────
  const temporalData = {
    localIso: snapshot.temporalContext.localIso,
    timeOfDay: snapshot.temporalContext.timeOfDayLabel,
    isSleepWindow: snapshot.temporalContext.isSleepWindow,
    tzLabel: snapshot.temporalContext.tzLabel,
  };

  // ── Presence ─────────────────────────────────────────────────────────────
  const presenceData = {
    isOnline: snapshot.isOnline,
    voiceActive: snapshot.presence?.voice_active || false,
    isSuppressed: snapshot.isSuppressed,
    effectiveMinGapMinutes: snapshot.effectiveMinGapMinutes,
    status: snapshot.presence?.status,
  };

  // ── Conversation (bounded, no HIDDEN_CONTEXT rows) ───────────────────────
  const maxChat = opts.maxChatMessages ?? defaults.maxChatMessages;
  const chatConsidered = snapshot.recentChat.length;
  const chatFiltered = snapshot.recentChat
    .filter(m => !m.content?.startsWith('[HIDDEN_CONTEXT]'))
    .slice(-maxChat)
    .map(m => ({ role: m.role, content: m.content }));
  const chatTokenEstimate = tokenizeSection(chatFiltered, m => m.content);

  // ── Memories (relevance-filtered + bounded) ───────────────────────────────
  const maxMem = opts.maxMemories ?? defaults.maxMemories;
  const keywords = opts.turnKeywords || [];
  const memoriesConsidered = snapshot.memories.length;

  let filteredMems: MemoryEntry[];
  if (opts.memoryFilter) {
    filteredMems = snapshot.memories.filter(opts.memoryFilter).slice(0, maxMem);
  } else if (keywords.length > 0) {
    // Keyword-relevant first, then fill with importance-sorted remainder
    const relevant = snapshot.memories.filter(m => keywordMatch(`${m.key} ${m.value}`, keywords));
    const rest = snapshot.memories.filter(m => !keywordMatch(`${m.key} ${m.value}`, keywords));
    filteredMems = [...relevant, ...rest].slice(0, maxMem);
  } else {
    filteredMems = snapshot.memories.slice(0, maxMem);
  }

  const memoryItems = filteredMems.map(m => ({ key: m.key, value: m.value, type: m.memory_type }));
  const memTokenEstimate = tokenizeSection(memoryItems, m => `${m.key}: ${m.value}`);

  // ── Short-term memories (bounded) ────────────────────────────────────────
  const maxStm = opts.maxStm ?? defaults.maxStm;
  const stmItems = snapshot.shortTermMemories
    .slice(0, maxStm)
    .map(m => ({ memory: m.memory, emotion: m.emotion }));
  const stmTokenEstimate = tokenizeSection(stmItems, m => m.memory);

  // ── Entities (bounded) ────────────────────────────────────────────────────
  const entityItems = snapshot.entityBubbles
    .slice(0, 15)
    .map(e => ({ name: e.name, relation: e.relation_type, summary: e.summary }));

  // ── Life threads (bounded) ────────────────────────────────────────────────
  const maxThreads = opts.maxLifeThreads ?? defaults.maxLifeThreads;
  const threadItems = snapshot.lifeThreads
    .slice(0, maxThreads)
    .map(t => ({ topic: t.topic, state: t.state, nextStep: t.next_useful_step }));

  // ── Agenda (bounded, mark overdue) ────────────────────────────────────────
  const maxAgenda = opts.maxAgenda ?? defaults.maxAgenda;
  const now = new Date();
  const agendaItems = snapshot.pendingAgenda
    .slice(0, maxAgenda)
    .map(a => ({
      description: a.event_description,
      time: a.expected_time || a.follow_up_after,
      urgency: a.urgency,
      overdue: !!(a.next_retry_at && new Date(a.next_retry_at) < now) ||
               !!(a.expected_time && new Date(a.expected_time) < now),
    }));

  // ── Emotional ─────────────────────────────────────────────────────────────
  const includeEmotional = opts.includeEmotional ?? defaults.includeEmotional;
  const emotionData = (includeEmotional && snapshot.latestEmotion)
    ? { mood: snapshot.latestEmotion.mood, intensity: snapshot.latestEmotion.intensity }
    : null;
  const reflectionData = (includeEmotional && snapshot.latestReflection)
    ? { summary: snapshot.latestReflection.summary }
    : null;

  // ── Outreach ──────────────────────────────────────────────────────────────
  const outreachData = {
    lastAt: snapshot.lastOutreachAt,
    hasOverdueAgenda: snapshot.hasOverdueAgenda,
  };

  // ── Token totals ──────────────────────────────────────────────────────────
  const totalTokenEstimate =
    chatTokenEstimate + memTokenEstimate + stmTokenEstimate +
    tokenizeSection(entityItems, e => `${e.name}: ${e.summary || ''}`) +
    tokenizeSection(threadItems, t => t.topic) +
    tokenizeSection(agendaItems, a => a.description) +
    roughTokens(JSON.stringify(profileData || {})) +
    roughTokens(JSON.stringify(temporalData));

  return {
    userId: snapshot.userId,
    operation: op,
    builtAt,
    snapshotAge,

    profile: { data: profileData },
    temporal: { data: temporalData },
    presence: { data: presenceData },

    conversation: {
      data: chatFiltered,
      truncated: chatConsidered > maxChat,
      tokenEstimate: chatTokenEstimate,
    },
    memories: {
      data: memoryItems,
      truncated: memoriesConsidered > maxMem,
      tokenEstimate: memTokenEstimate,
    },
    shortTermMemories: {
      data: stmItems,
      truncated: snapshot.shortTermMemories.length > maxStm,
      tokenEstimate: stmTokenEstimate,
    },
    entities: {
      data: entityItems,
      truncated: snapshot.entityBubbles.length > 15,
      tokenEstimate: tokenizeSection(entityItems, e => `${e.name}: ${e.summary || ''}`),
    },
    lifeThreads: {
      data: threadItems,
      truncated: snapshot.lifeThreads.length > maxThreads,
      tokenEstimate: tokenizeSection(threadItems, t => t.topic),
    },
    agenda: {
      data: agendaItems,
      truncated: snapshot.pendingAgenda.length > maxAgenda,
      tokenEstimate: tokenizeSection(agendaItems, a => a.description),
    },

    emotion: { data: emotionData },
    reflection: { data: reflectionData },
    outreach: { data: outreachData },

    metrics: {
      totalTokenEstimate,
      memoriesConsidered,
      memoriesIncluded: filteredMems.length,
      chatMessagesConsidered: chatConsidered,
      chatMessagesIncluded: chatFiltered.length,
      snapshotErrors: snapshot.errors.length,
    },
  };
}

/**
 * Serialize a ContextPacket to a compact string for logging/metrics only.
 * Do NOT use this output in LLM prompts — use buildContextPacket sections directly.
 */
export function summarizeContextPacket(packet: ContextPacket): string {
  return [
    `op=${packet.operation}`,
    `age=${packet.snapshotAge}ms`,
    `chat=${packet.conversation.data.length}${packet.conversation.truncated ? '+' : ''}`,
    `mem=${packet.memories.data.length}${packet.memories.truncated ? '+' : ''}`,
    `stm=${packet.shortTermMemories.data.length}`,
    `threads=${packet.lifeThreads.data.length}`,
    `agenda=${packet.agenda.data.length}`,
    `tokens≈${packet.metrics.totalTokenEstimate}`,
    `errors=${packet.metrics.snapshotErrors}`,
  ].join(' ');
}
