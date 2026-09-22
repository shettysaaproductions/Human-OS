/**
 * ContextPacket - Bounded LLM-Facing Context Builder (Phase 3)
 *
 * Architecture:
 *   DATABASE -> UserContextSnapshot -> CognitiveContextService
 *   -> ContextPacket -> formatContextPacketForPrompt() -> MODEL
 *
 * formatContextPacketForPrompt() is the ONLY path from packet to promptBuilder.
 * Never pass the raw snapshot directly into a model prompt.
 */

import type { UserContextSnapshot, MemoryEntry } from './UserContextSnapshot';

// Types

export type ContextOperation = 'chat' | 'nace' | 'voice' | 'goal' | 'reminder';

export interface ContextPacketOptions {
  operation: ContextOperation;
  turnKeywords?: string[];
  maxChatMessages?: number;
  maxMemories?: number;
  maxLifeThreads?: number;
  maxAgenda?: number;
  maxStm?: number;
  includeEmotional?: boolean;
  includeActions?: boolean;
  memoryFilter?: (m: MemoryEntry) => boolean;
  /**
   * Phase 3: When provided, conflict-resolved durableFacts are used as the memories source.
   * CognitiveContext conflict resolution has authority over which memories reach the model.
   */
  cogCtx?: {
    memories?: {
      durableFacts?: Array<{ id: string; key: string; value: string; memory_type?: string; importance?: number; confidence?: number; created_at?: string }>;
      goals?: Array<{ key: string; value: string; memory_type?: string }>;
    };
    metadata?: { conflicts_detected?: number; conflicts_resolved?: number };
  };
}

/**
 * Phase 3: Prompt-builder-compatible representation. The ONLY shape that flows
 * from ContextPacket into promptBuilder.buildSystemPrompt() / NovaBrainService context.
 */
export interface ContextPacketPromptShape {
  memories: Array<{ id: string; key: string; value: string; memory_type?: string; importance?: number; confidence?: number; created_at?: string }>;
  workingMemories: Array<{ key: string; value: string }>;
  preferredName: string | undefined;
  companionPersonality: string | undefined;
  shortTermMemories: Array<{ memory: string; emotion?: string; importance?: number; timestamp?: string | null }>;
  preferredLanguage: 'en' | 'hi' | 'auto';
  grammaticalGender: string | undefined;
  profile: { preferred_name?: string; companion_personality?: string; grammatical_gender?: string; country?: string; timezone_offset?: number; push_token?: string; current_visual_context?: string | null; nova_mode?: string; preferred_language?: string } | null;
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  packetSummary: string;
  totalTokenEstimate: number;
}

const OP_DEFAULTS: Record<ContextOperation, { maxChatMessages: number; maxMemories: number; maxLifeThreads: number; maxAgenda: number; maxStm: number; includeEmotional: boolean; includeActions: boolean }> = {
  chat:     { maxChatMessages: 15, maxMemories: 12, maxLifeThreads: 4, maxAgenda: 5,  maxStm: 8,  includeEmotional: true,  includeActions: false },
  nace:     { maxChatMessages: 6,  maxMemories: 15, maxLifeThreads: 6, maxAgenda: 10, maxStm: 5,  includeEmotional: true,  includeActions: true  },
  voice:    { maxChatMessages: 8,  maxMemories: 10, maxLifeThreads: 3, maxAgenda: 5,  maxStm: 5,  includeEmotional: false, includeActions: false },
  goal:     { maxChatMessages: 4,  maxMemories: 8,  maxLifeThreads: 8, maxAgenda: 10, maxStm: 3,  includeEmotional: false, includeActions: true  },
  reminder: { maxChatMessages: 3,  maxMemories: 5,  maxLifeThreads: 2, maxAgenda: 10, maxStm: 3,  includeEmotional: false, includeActions: false },
};

export interface ContextPacketSection<T> { data: T[]; truncated: boolean; tokenEstimate: number; }
export interface ContextPacketScalar<T> { data: T | null; }

export interface ContextPacket {
  userId: string;
  operation: ContextOperation;
  builtAt: string;
  snapshotAge: number;
  profile: ContextPacketScalar<{ preferredName?: string; timezone?: string; tzOffset?: number; country?: string; grammaticalGender?: string; personalityStyle?: string; novaMode?: string }>;
  temporal: ContextPacketScalar<{ localIso: string; timeOfDay: string; isSleepWindow: boolean; tzLabel: string }>;
  presence: ContextPacketScalar<{ isOnline: boolean; voiceActive: boolean; isSuppressed: boolean; effectiveMinGapMinutes: number; status?: string }>;
  conversation: ContextPacketSection<{ role: string; content: string }>;
  memories: ContextPacketSection<{ key: string; value: string; type?: string }>;
  shortTermMemories: ContextPacketSection<{ memory: string; emotion?: string }>;
  entities: ContextPacketSection<{ name: string; relation?: string; summary?: string }>;
  lifeThreads: ContextPacketSection<{ topic: string; state: string; nextStep?: string }>;
  agenda: ContextPacketSection<{ description: string; time?: string; urgency?: string; overdue: boolean }>;
  emotion: ContextPacketScalar<{ mood?: string; intensity?: number }>;
  reflection: ContextPacketScalar<{ summary?: string }>;
  outreach: ContextPacketScalar<{ lastAt: string | null; hasOverdueAgenda: boolean }>;
  metrics: {
    totalTokenEstimate: number;
    memoriesConsidered: number;
    memoriesIncluded: number;
    chatMessagesConsidered: number;
    chatMessagesIncluded: number;
    snapshotErrors: number;
    /** Phase 3: true when cogCtx durableFacts were used */
    usedCogCtxMemories: boolean;
    /** Phase 3: conflicts resolved before model sees memories */
    conflictsResolved: number;
  };
  /** @internal raw snapshot ref for formatContextPacketForPrompt only */
  _rawSnapshot: UserContextSnapshot;
}

function roughTokens(text: string): number { return Math.ceil(text.length / 4); }
function tokenizeSection<T>(items: T[], toText: (i: T) => string): number { return items.reduce((sum, i) => sum + roughTokens(toText(i)), 0); }
function keywordMatch(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k.toLowerCase()));
}
function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Build a bounded, relevance-filtered ContextPacket from a hydrated UserContextSnapshot.
 * Phase 3: When opts.cogCtx is provided, uses conflict-resolved durableFacts as memories source.
 */
export function buildContextPacket(snapshot: UserContextSnapshot, opts: ContextPacketOptions): ContextPacket {
  const op = opts.operation;
  const defaults = OP_DEFAULTS[op];
  const builtAt = new Date().toISOString();
  const snapshotAge = Date.now() - new Date(snapshot.hydratedAt).getTime();

  const profileData = snapshot.profile ? {
    preferredName: snapshot.profile.preferred_name || snapshot.profile.display_name,
    timezone: snapshot.profile.timezone,
    tzOffset: snapshot.profile.timezone_offset,
    country: snapshot.profile.country,
    grammaticalGender: snapshot.profile.grammatical_gender,
    personalityStyle: snapshot.profile.companion_personality,
    novaMode: snapshot.profile.nova_mode,
  } : null;

  const temporalData = {
    localIso: snapshot.temporalContext.localIso,
    timeOfDay: snapshot.temporalContext.timeOfDayLabel,
    isSleepWindow: snapshot.temporalContext.isSleepWindow,
    tzLabel: snapshot.temporalContext.tzLabel,
  };

  const presenceData = {
    isOnline: snapshot.isOnline,
    voiceActive: snapshot.presence?.voice_active || false,
    isSuppressed: snapshot.isSuppressed,
    effectiveMinGapMinutes: snapshot.effectiveMinGapMinutes,
    status: snapshot.presence?.status,
  };

  const maxChat = opts.maxChatMessages ?? defaults.maxChatMessages;
  const chatConsidered = snapshot.recentChat.length;
  const chatFiltered = snapshot.recentChat
    .filter(m => !m.content?.startsWith('[HIDDEN_CONTEXT]'))
    .slice(-maxChat)
    .map(m => ({ role: m.role, content: m.content }));
  const chatTokenEstimate = tokenizeSection(chatFiltered, m => m.content);

  const maxMem = opts.maxMemories ?? defaults.maxMemories;
  const keywords = opts.turnKeywords || [];

  // Phase 3: prefer conflict-resolved CognitiveContext durableFacts when available
  let usedCogCtxMemories = false;
  let conflictsResolved = 0;
  type RawMem = { id: string; key: string; value: string; memory_type?: string; importance?: number; confidence?: number; created_at?: string };
  let rawMemorySource: RawMem[];

  if (opts.cogCtx?.memories?.durableFacts && opts.cogCtx.memories.durableFacts.length > 0) {
    const cogCtxMap = new Map<string, RawMem>();
    for (const df of opts.cogCtx.memories.durableFacts) {
      cogCtxMap.set(df.key, df);
    }
    for (const m of snapshot.memories) {
      if (!cogCtxMap.has(m.key)) {
        cogCtxMap.set(m.key, { id: m.id, key: m.key, value: m.value, memory_type: m.memory_type, importance: m.importance || m.importance_score, confidence: m.confidence, created_at: m.created_at });
      }
    }
    rawMemorySource = Array.from(cogCtxMap.values());
    usedCogCtxMemories = true;
    conflictsResolved = opts.cogCtx.metadata?.conflicts_resolved ?? 0;
  } else {
    rawMemorySource = snapshot.memories.map(m => ({ id: m.id, key: m.key, value: m.value, memory_type: m.memory_type, importance: m.importance || m.importance_score, confidence: m.confidence, created_at: m.created_at }));
  }

  const memoriesConsidered = rawMemorySource.length;
  let filteredRawMems: RawMem[];
  if (opts.memoryFilter) {
    filteredRawMems = rawMemorySource.filter(m => opts.memoryFilter!({ id: m.id, key: m.key, value: m.value, memory_type: m.memory_type, importance_score: m.importance, importance: m.importance, confidence: m.confidence, created_at: m.created_at, is_current: true, bubble_id: undefined })).slice(0, maxMem);
  } else if (keywords.length > 0) {
    const relevant = rawMemorySource.filter(m => keywordMatch(`${m.key} ${m.value}`, keywords));
    const rest = rawMemorySource.filter(m => !keywordMatch(`${m.key} ${m.value}`, keywords));
    filteredRawMems = [...relevant, ...rest].slice(0, maxMem);
  } else {
    filteredRawMems = rawMemorySource.slice(0, maxMem);
  }

  const memoryItems = filteredRawMems.map(m => ({ key: m.key, value: m.value, type: m.memory_type }));
  const memTokenEstimate = tokenizeSection(memoryItems, m => `${m.key}: ${m.value}`);

  const maxStm = opts.maxStm ?? defaults.maxStm;
  const stmItems = snapshot.shortTermMemories.slice(0, maxStm).map(m => ({ memory: m.memory, emotion: m.emotion }));
  const stmTokenEstimate = tokenizeSection(stmItems, m => m.memory);

  const entityItems = snapshot.entityBubbles.slice(0, 15).map(e => ({ name: e.name, relation: e.relation_type, summary: e.summary }));
  const maxThreads = opts.maxLifeThreads ?? defaults.maxLifeThreads;
  const threadItems = snapshot.lifeThreads.slice(0, maxThreads).map(t => ({ topic: t.topic, state: t.state, nextStep: t.next_useful_step }));
  const maxAgenda = opts.maxAgenda ?? defaults.maxAgenda;
  const now = new Date();
  const agendaItems = snapshot.pendingAgenda.slice(0, maxAgenda).map(a => ({
    description: a.event_description,
    time: a.expected_time || a.follow_up_after,
    urgency: a.urgency,
    overdue: !!(a.next_retry_at && new Date(a.next_retry_at) < now) || !!(a.expected_time && new Date(a.expected_time) < now),
  }));

  const includeEmotional = opts.includeEmotional ?? defaults.includeEmotional;
  const emotionData = (includeEmotional && snapshot.latestEmotion) ? { mood: snapshot.latestEmotion.mood, intensity: snapshot.latestEmotion.intensity } : null;
  const reflectionData = (includeEmotional && snapshot.latestReflection) ? { summary: snapshot.latestReflection.summary } : null;
  const outreachData = { lastAt: snapshot.lastOutreachAt, hasOverdueAgenda: snapshot.hasOverdueAgenda };

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
    conversation: { data: chatFiltered, truncated: chatConsidered > maxChat, tokenEstimate: chatTokenEstimate },
    memories: { data: memoryItems, truncated: memoriesConsidered > maxMem, tokenEstimate: memTokenEstimate },
    shortTermMemories: { data: stmItems, truncated: snapshot.shortTermMemories.length > maxStm, tokenEstimate: stmTokenEstimate },
    entities: { data: entityItems, truncated: snapshot.entityBubbles.length > 15, tokenEstimate: tokenizeSection(entityItems, e => `${e.name}: ${e.summary || ''}`) },
    lifeThreads: { data: threadItems, truncated: snapshot.lifeThreads.length > maxThreads, tokenEstimate: tokenizeSection(threadItems, t => t.topic) },
    agenda: { data: agendaItems, truncated: snapshot.pendingAgenda.length > maxAgenda, tokenEstimate: tokenizeSection(agendaItems, a => a.description) },
    emotion: { data: emotionData },
    reflection: { data: reflectionData },
    outreach: { data: outreachData },
    metrics: { totalTokenEstimate, memoriesConsidered, memoriesIncluded: filteredRawMems.length, chatMessagesConsidered: chatConsidered, chatMessagesIncluded: chatFiltered.length, snapshotErrors: snapshot.errors.length, usedCogCtxMemories, conflictsResolved },
    _rawSnapshot: snapshot,
  };
}

/**
 * formatContextPacketForPrompt() — Phase 3 canonical translation layer.
 *
 * THE only function that converts a bounded ContextPacket into the shape consumed by
 * promptBuilder.buildSystemPrompt() and NovaBrainService context. Call this instead of
 * reading raw snapshot fields or raw cogCtx in the prompt assembly path.
 */
export function formatContextPacketForPrompt(packet: ContextPacket): ContextPacketPromptShape {
  const snap = packet._rawSnapshot;

  // Reconstruct full Memory objects needed by promptBuilder (domain classification, dynamic age)
  const snapMemMap = new Map<string, any>();
  for (const sm of snap.memories) { snapMemMap.set(sm.key, sm); }

  const memories = packet.memories.data.map((m, idx) => {
    const orig = snapMemMap.get(m.key);
    return {
      id: orig?.id ?? `pkt_${idx}`,
      key: m.key,
      value: m.value,
      memory_type: m.type,
      importance: orig?.importance || orig?.importance_score,
      confidence: orig?.confidence,
      created_at: orig?.created_at,
    };
  });

  const workingMemories = snap.workingMemoryRows.map(w => ({ key: w.key, value: w.value }));
  const profile = snap.profile ?? null;
  const preferredName = profile?.preferred_name;
  const companionPersonality = profile?.companion_personality;
  const grammaticalGender = profile?.grammatical_gender;
  const rawLang = profile?.preferred_language || 'auto';
  const preferredLanguage: 'en' | 'hi' | 'auto' = rawLang === 'en' ? 'en' : rawLang === 'hi' ? 'hi' : 'auto';

  const stmRaw = snap.shortTermMemories.slice(0, packet.shortTermMemories.data.length);
  const shortTermMemories = packet.shortTermMemories.data.map((s, idx) => ({
    memory: s.memory,
    emotion: s.emotion,
    importance: stmRaw[idx]?.importance,
    timestamp: stmRaw[idx]?.created_at ? timeAgo(stmRaw[idx].created_at!) : null,
  }));

  const recentMessages = packet.conversation.data.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  return {
    memories,
    workingMemories,
    preferredName,
    companionPersonality,
    shortTermMemories,
    preferredLanguage,
    grammaticalGender,
    profile,
    recentMessages,
    packetSummary: summarizeContextPacket(packet),
    totalTokenEstimate: packet.metrics.totalTokenEstimate,
  };
}

/**
 * Serialize a ContextPacket to a compact string for logging/metrics only.
 * Do NOT use this output in LLM prompts. Use formatContextPacketForPrompt() instead.
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
    `tokens~${packet.metrics.totalTokenEstimate}`,
    `errors=${packet.metrics.snapshotErrors}`,
    `cogCtx=${packet.metrics.usedCogCtxMemories}`,
    `conflicts=${packet.metrics.conflictsResolved}`,
  ].join(' ');
}
