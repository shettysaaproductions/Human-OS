/**
 * CognitiveContextService — Unified Cognitive Context Fabric & Recall Quality (Phase 10)
 *
 * Provides a canonical, bounded, provenance-aware cognitive context layer that serves:
 * - Normal chat
 * - Proactive cognition (NACE)
 * - Life-thread reasoning
 * - Action intelligence
 * - Follow-up generation
 * - Memory & relationship consistency
 *
 * Architecture Principles:
 * 1. Single source of truth for user context across all engines.
 * 2. Deterministic ranking & relevance scoring (0 LLM overhead).
 * 3. Provenance & Conflict Resolution: Distinguishes current vs historical facts cleanly.
 * 4. Pronoun & Entity Continuity: Conversational antecedents take precedence over long-term memories.
 * 5. Bounded Recall Budget: Strict limits to prevent prompt bloat.
 * 6. Degraded Mode: Isolated failure of non-critical tables never crashes chat.
 * 7. Safe Aggregated Observability: Metrics without leaking PII or raw secrets.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { extractKeywords, stopWords } from '../utils/nlp';
import { TurnAnalyzer, TurnAnalysisResult } from './TurnAnalyzer';
import { canonicalizeKey } from '../lib/memoryKeySchema';

export interface ContextItemProvenance {
  source: 'current_turn' | 'chat_history' | 'working_memory' | 'short_term_memory' | 'episodic_memory' | 'long_term_memory' | 'life_thread' | 'nova_action' | 'reminder' | 'user_profile' | 'presence';
  id?: string;
  key?: string;
  confidence?: number;
  updated_at?: string;
  created_at?: string;
  relation?: string;
  is_current?: boolean;
  is_ambiguous?: boolean;
}

export interface DurableMemoryItem {
  id?: string;
  key: string;
  value: string;
  memory_type: string;
  importance: number;
  confidence: number;
  provenance: ContextItemProvenance;
  is_current: boolean;
  is_protected?: boolean;
  is_ambiguous?: boolean;
}

export interface HistoricalMemoryItem {
  id?: string;
  key: string;
  value: string;
  replaced_by?: string;
  updated_at?: string;
  provenance: ContextItemProvenance;
}

export interface AntecedentEntity {
  entity: string;
  relation: string;
  gender?: 'feminine' | 'masculine' | 'neutral';
  pronounCandidates: string[];
  sourceMessage: string;
}

export interface CognitiveContext {
  user: {
    id: string;
    preferredName?: string;
    gender?: string;
    country: string;
    personality?: string;
    currentVisualContext?: string | null;
  };
  temporal: {
    nowLocal: Date;
    tzOffset: number;
    tzLabel: string;
    dayName: string;
    dateStr: string;
    timeStr: string;
    isWeekend: boolean;
    timeOfDayLabel: string;
    scheduleOverrideNote?: string;
  };
  presence: {
    status: 'online' | 'away' | 'offline' | 'typing';
    last_active_at?: string | null;
    last_typing_at?: string | null;
    unreadAssistantMessages: number;
    gapMinutes: number | null;
  };
  conversation: {
    conversationId: string;
    recentMessages: { role: 'user' | 'assistant' | 'system'; content: string; created_at?: string; reply_to_content?: string }[];
    recentCrossSessionSnippet?: string;
    activeAntecedents: AntecedentEntity[];
  };
  turn?: {
    effectiveMessage: string;
    turnAnalysis?: TurnAnalysisResult;
    extractedFacts: { key: string; value: string; isProtected?: boolean; factClass?: string }[];
    corrections: { key: string; oldValue?: string; newValue: string }[];
  };
  memories: {
    durableFacts: DurableMemoryItem[];
    historicalFacts: HistoricalMemoryItem[];
    goals: { key: string; value: string; importance: number }[];
    shortTerm: { memory: string; emotion?: string; importance?: number; timestamp?: string | null }[];
    workingMemory: { key: string; value: string }[];
    totalCount: number;
  };
  lifeThreads: {
    active: { id: string; topic: string; state: string; priority: string; provenance?: string; last_relevant_at?: string }[];
    waitingOrBlocked: { id: string; topic: string; state: string; priority: string }[];
  };
  actions: {
    active: { id: string; logical_key: string; title: string; state: string; priority: string; execution_class: string; source_thread_id?: string; due_at?: string | null }[];
    nextBestAction?: { id: string; logical_key: string; title: string; execution_class: string; priority: string } | null;
  };
  reminders: {
    upcoming: { id: string; title: string; trigger_at?: string | null; event_trigger?: string }[];
  };
  metadata: {
    assemblies_count: number;
    items_considered: number;
    items_selected: number;
    conflicts_detected: number;
    conflicts_resolved: number;
    clarifications_required: number;
    degraded_sources: string[];
    assembly_duration_ms: number;
  };
}

export interface ContextAssemblyOptions {
  message?: string;
  messages?: { message: string; reply_to_content?: string }[];
  conversationId?: string;
  isProactive?: boolean;
  skipMemory?: boolean;
  searchKeywords?: string[];
  maxRecentMessages?: number;
  maxDurableMemories?: number;
  maxWorkingMemories?: number;
  maxLifeThreads?: number;
  maxActions?: number;
}

export class CognitiveContextService {
  // Observability metrics (safe aggregate counters)
  private metrics = {
    context_assemblies: 0,
    context_items_considered: 0,
    context_items_selected: 0,
    context_conflicts_detected: 0,
    context_conflicts_resolved: 0,
    context_clarifications_required: 0,
    context_retrieval_failures: 0,
  };

  /**
   * Returns copy of safe aggregated context metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Assembles a bounded, ranked, conflict-resolved Canonical Cognitive Context.
   */
  async assembleContext(userIdOrOptions: string | (ContextAssemblyOptions & { userId: string; effectiveMessage?: string }), maybeOptions: ContextAssemblyOptions = {}): Promise<CognitiveContext> {
    const startTime = Date.now();
    this.metrics.context_assemblies++;

    let userId: string;
    let options: ContextAssemblyOptions;

    if (typeof userIdOrOptions === 'string') {
      userId = userIdOrOptions;
      options = maybeOptions;
    } else {
      userId = userIdOrOptions.userId;
      options = {
        ...userIdOrOptions,
        message: userIdOrOptions.message || userIdOrOptions.effectiveMessage,
      };
    }

    const degradedSources: string[] = [];
    let itemsConsidered = 0;
    let itemsSelected = 0;
    let conflictsDetected = 0;
    let conflictsResolved = 0;
    let clarificationsRequired = 0;

    const maxRecentMessages = options.maxRecentMessages || 10;
    const maxDurableMemories = options.maxDurableMemories || 8;
    const maxWorkingMemories = options.maxWorkingMemories || 6;
    const maxLifeThreads = options.maxLifeThreads || 4;
    const maxActions = options.maxActions || 6;

    const effectiveMessage = options.message || (options.messages && options.messages.length > 0 ? options.messages[options.messages.length - 1].message : '');

    // ── Parallel Safe Queries ───────────────────────────────────────────────
    const profilePromise = qt.track('get_user_profile', 'profiles', () =>
      supabaseAdmin.from('profiles').select('id, preferred_name, companion_personality, grammatical_gender, country, timezone_offset, current_visual_context').eq('id', userId).maybeSingle()
    ).catch(err => {
      logger.warn('[CognitiveContext] Profile fetch failed', { error: err.message });
      degradedSources.push('profiles');
      return { data: null };
    });

    const historyPromise = qt.track('get_recent_chat_history', 'chat_history', () =>
      supabaseAdmin.from('chat_history').select('id, role, content, reply_to_content, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    ).catch(err => {
      logger.warn('[CognitiveContext] Chat history fetch failed', { error: err.message });
      degradedSources.push('chat_history');
      return { data: [] };
    });

    const wmPromise = qt.track('get_working_memory', 'working_memory', () =>
      supabaseAdmin.from('working_memory').select('key, value, created_at, promotion_status, expires_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
    ).then((res: any) => {
      if (res && Array.isArray(res.data)) {
        const now = new Date().toISOString();
        res.data = res.data.filter((wm: any) =>
          wm.promotion_status !== 'SUPERSEDED' &&
          wm.promotion_status !== 'INVALIDATED' &&
          (!wm.expires_at || wm.expires_at > now)
        );
      }
      return res;
    }).catch(err => {
      logger.warn('[CognitiveContext] Working memory fetch failed', { error: err.message });
      degradedSources.push('working_memory');
      return { data: [] };
    });

    const memoriesPromise = qt.track('get_all_memories', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type, importance, confidence, frequency, emotional_weight, created_at, updated_at, is_archived, protection_source, protected_at, compression_status, lifecycle_state, superseded_by')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('importance', { ascending: false })
        .limit(50)
    ).then((res: any) => {
      // Defensive in-memory trust boundary & supersession filter
      if (res && Array.isArray(res.data)) {
        res.data = res.data.filter((m: any) =>
          !m.is_archived &&
          m.lifecycle_state !== 'SUPERSEDED' &&
          m.lifecycle_state !== 'INVALIDATED' &&
          !m.superseded_by &&
          (m.compression_status === null || m.compression_status === undefined || m.compression_status === 'trusted')
        );
      }
      return res;
    }).catch(err => {
      logger.warn('[CognitiveContext] Memories fetch failed', { error: err.message });
      degradedSources.push('memories');
      return { data: [] };
    });

    const stmPromise = qt.track('get_stm', 'short_term_memories', () =>
      supabaseAdmin.from('short_term_memories').select('id, memory, emotion, importance, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10)
    ).catch(err => {
      logger.warn('[CognitiveContext] Short term memory fetch failed', { error: err.message });
      degradedSources.push('short_term_memories');
      return { data: [] };
    });

    const presencePromise = qt.track('get_presence', 'user_presence', () =>
      supabaseAdmin.from('user_presence').select('status, last_active_at, last_typing_at').eq('user_id', userId).maybeSingle()
    ).catch(err => {
      logger.warn('[CognitiveContext] Presence fetch failed', { error: err.message });
      degradedSources.push('user_presence');
      return { data: null };
    });

    const unreadPromise = qt.track('get_unread', 'chat_history', () =>
      supabaseAdmin.from('chat_history').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'assistant').eq('is_read', false)
    ).catch(_err => {
      degradedSources.push('unread_count');
      return { count: 0 };
    });

    const lifeThreadsPromise = qt.track('get_life_threads', 'life_threads', () =>
      supabaseAdmin.from('life_threads').select('id, topic, state, priority, provenance, last_relevant_at').eq('user_id', userId).in('state', ['active', 'waiting', 'blocked']).order('last_relevant_at', { ascending: false }).limit(10)
    ).catch(err => {
      logger.warn('[CognitiveContext] Life threads fetch failed', { error: err.message });
      degradedSources.push('life_threads');
      return { data: [] };
    });

    const actionsPromise = qt.track('get_nova_actions', 'nova_actions', () =>
      supabaseAdmin.from('nova_actions').select('id, logical_key, title, state, priority, execution_class, source_thread_id, due_at, dependency_ids').eq('user_id', userId).in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked']).order('created_at', { ascending: false }).limit(15)
    ).catch(err => {
      logger.warn('[CognitiveContext] Nova actions fetch failed', { error: err.message });
      degradedSources.push('nova_actions');
      return { data: [] };
    });

    const remindersPromise = qt.track('get_upcoming_reminders', 'reminders', () =>
      supabaseAdmin.from('reminders').select('id, title, trigger_at, event_trigger').eq('user_id', userId).eq('status', 'active').or(`trigger_at.is.null,trigger_at.gte.${new Date().toISOString()}`).order('trigger_at', { ascending: true }).limit(5)
    ).catch(err => {
      logger.warn('[CognitiveContext] Reminders fetch failed', { error: err.message });
      degradedSources.push('reminders');
      return { data: [] };
    });

    const [
      profileRes, historyRes, wmRes, memoriesRes, stmRes, presenceRes, unreadRes, lifeThreadsRes, actionsRes, remindersRes
    ] = await Promise.all([
      profilePromise, historyPromise, wmPromise, memoriesPromise, stmPromise, presencePromise, unreadPromise, lifeThreadsPromise, actionsPromise, remindersPromise
    ]);

    if (degradedSources.length > 0) {
      this.metrics.context_retrieval_failures += degradedSources.length;
    }

    // ── 1. User & Temporal Context ──────────────────────────────────────────
    const profile = (profileRes.data as any) || {};
    const userCountry = profile.country || 'IN';
    const TIMEZONE_OFFSETS: Record<string, number> = {
      IN: 5.5, US: -5, UK: 0, AU: 10, AE: 4, SA: 3, PK: 5, BD: 6, SG: 8, JP: 9, DE: 1, FR: 1, CA: -5, NZ: 12, ZA: 2, NG: 1, KE: 3, BR: -3
    };
    const tzOffset = profile.timezone_offset ? profile.timezone_offset / 60 : (TIMEZONE_OFFSETS[userCountry] ?? 5.5);
    const tzMs = tzOffset * 3600 * 1000;
    const nowLocal = new Date(Date.now() + tzMs);
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayIdx = nowLocal.getUTCDay();
    const dateStr = `${DAY_NAMES[dayIdx]}, ${MONTH_NAMES[nowLocal.getUTCMonth()]} ${nowLocal.getUTCDate()}, ${nowLocal.getUTCFullYear()}`;
    const hh = nowLocal.getUTCHours(), mm = nowLocal.getUTCMinutes();
    const timeStr = `${hh % 12 || 12}:${mm.toString().padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
    const tzLabel = tzOffset === 5.5 ? 'IST' : `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;

    const FRIDAY_SAT_WEEKEND = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'AF', 'IR'];
    let isWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;

    // Working memory schedule override evaluation
    const rawWm = (wmRes.data as any[]) || [];
    let scheduleOverrideNote: string | undefined;
    if (rawWm.length > 0) {
      const todayName = DAY_NAMES[dayIdx].toLowerCase();
      for (const wm of rawWm) {
        const val = (wm.value || '').toLowerCase();
        if (val.includes(todayName) && (val.includes('working') || val.includes('work day') || val.includes('office'))) {
          isWeekend = false;
          break;
        }
        if ((val.includes('weekoff') || val.includes('week off') || val.includes('day off')) && val.includes(todayName)) {
          isWeekend = true;
          break;
        }
      }
      const calendarIsWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;
      if (calendarIsWeekend !== isWeekend) {
        scheduleOverrideNote = !isWeekend
          ? `⚠️ SCHEDULE OVERRIDE: The calendar says today (${DAY_NAMES[dayIdx]}) is a weekend, BUT the user's actual work schedule says they are WORKING today. Treat today as a NORMAL WORKING DAY.`
          : `⚠️ SCHEDULE OVERRIDE: The user's memory says today (${DAY_NAMES[dayIdx]}) is their WEEKOFF / day off. Treat today as a rest day.`;
      }
    }

    const timeOfDayLabel = hh >= 5 && hh < 12 ? 'morning' : hh >= 12 && hh < 17 ? 'afternoon' : hh >= 17 && hh < 22 ? 'evening' : 'late_night';

    // ── 2. Presence & Conversation Gap ──────────────────────────────────────
    const rawHistory = (historyRes.data as any[]) || [];
    let lastUserMessageDate: Date | null = null;
    for (const msg of rawHistory) {
      if (msg.role === 'user' && msg.created_at) {
        lastUserMessageDate = new Date(msg.created_at);
        break;
      }
    }

    const gapMinutes = lastUserMessageDate ? (Date.now() - lastUserMessageDate.getTime()) / 60000 : null;

    const presenceRaw = (presenceRes.data as any) || {};
    let presenceStatus: 'online' | 'away' | 'offline' | 'typing' = presenceRaw.status || 'offline';
    // Ghost presence guard: if status is online/typing but last active > 5 mins ago, degrade to away
    if (presenceStatus === 'online' || presenceStatus === 'typing') {
      const lastActiveMs = presenceRaw.last_active_at ? new Date(presenceRaw.last_active_at).getTime() : 0;
      if (lastActiveMs > 0 && Date.now() - lastActiveMs > 5 * 60 * 1000) {
        presenceStatus = 'away';
      }
    }

    // ── 3. Recent Conversation & Antecedents Extraction ─────────────────────
    const FALLBACK_PREFIXES = ['Yaar, kuch technical issue', 'Yaar, thoda technical glitch', 'kuch technical issue aa gaya', '[SYSTEM]', 'Thodi der mein phir try karo'];
    const isFallback = (content: string) => FALLBACK_PREFIXES.some(p => content.includes(p));

    let recentMessages = rawHistory
      .filter(msg => msg.role !== 'assistant' || !isFallback(msg.content))
      .reverse()
      .map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.reply_to_content ? `[Replying to: "${msg.reply_to_content}"]\n${msg.content}` : msg.content,
        created_at: msg.created_at
      }));

    // Bounded message budget based on gap
    if (gapMinutes !== null) {
      if (gapMinutes > 1440) {
        recentMessages = recentMessages.length > 0 && recentMessages[recentMessages.length - 1].role === 'user' ? [recentMessages[recentMessages.length - 1]] : [];
      } else if (gapMinutes > 360) {
        recentMessages = recentMessages.slice(-3);
      } else {
        recentMessages = recentMessages.slice(-maxRecentMessages);
      }
    } else {
      recentMessages = recentMessages.slice(-maxRecentMessages);
    }

    // Extract pronoun / entity antecedents from recent turns and long-term memory
    const activeAntecedents = this.extractConversationalAntecedents(recentMessages, effectiveMessage, (memoriesRes.data as any[]) || []);

    // ── 4. Turn Analysis (TurnAnalyzer integration) ─────────────────────────
    let turnAnalysis: TurnAnalysisResult | undefined;
    let extractedFacts: { key: string; value: string; isProtected?: boolean; factClass?: string }[] = [];
    let corrections: { key: string; oldValue?: string; newValue: string }[] = [];

    if (effectiveMessage) {
      const normalizedInputs = options.messages && options.messages.length > 0
        ? options.messages
        : [{ message: effectiveMessage, role: 'user' as const }];

      turnAnalysis = TurnAnalyzer.analyze(normalizedInputs, {
        recentMessages,
        memories: memoriesRes.data || []
      });

      for (const unit of turnAnalysis.units) {
        if (unit.factKey && unit.factKey !== 'UNKNOWN_RELATION' && unit.factValue) {
          if (unit.type === 'correction') {
            corrections.push({ key: unit.factKey, newValue: unit.factValue });
            extractedFacts.push({ key: unit.factKey, value: unit.factValue, isProtected: unit.isProtected, factClass: unit.factClass });
          } else if (unit.type === 'fact') {
            extractedFacts.push({ key: unit.factKey, value: unit.factValue, isProtected: unit.isProtected, factClass: unit.factClass });
          }
        }
      }
    }

    // ── 5. Memory Conflict Resolution & Deterministic Ranking ──────────────
    const rawMemories = (memoriesRes.data as any[]) || [];
    itemsConsidered += rawMemories.length;

    const { durableFacts, historicalFacts, goals, detectedConflicts, resolvedConflicts } = this.resolveAndRankMemories(
      rawMemories,
      effectiveMessage,
      corrections,
      maxDurableMemories
    );

    conflictsDetected += detectedConflicts;
    conflictsResolved += resolvedConflicts;
    this.metrics.context_conflicts_detected += detectedConflicts;
    this.metrics.context_conflicts_resolved += resolvedConflicts;

    // ── 6. Short-term and Working Memories ──────────────────────────────────
    const shortTerm: { memory: string; emotion?: string; importance?: number; timestamp?: string | null }[] = [];
    for (const stm of (stmRes.data as any[]) || []) {
      shortTerm.push({
        memory: stm.memory,
        emotion: stm.emotion,
        importance: stm.importance,
        timestamp: stm.created_at
      });
      if (shortTerm.length >= 6) break;
    }

    const workingMemory: { key: string; value: string }[] = [];
    for (const wm of rawWm) {
      // Check if current turn has an active correction for this canonical key
      const { canonical: wmCanonical } = canonicalizeKey(wm.key || '');
      const activeCorrection = corrections.find(c => {
        const { canonical: corrCanonical } = canonicalizeKey(c.key);
        return corrCanonical === wmCanonical;
      });

      // If there is an active correction on this turn and the WM value does not match the new corrected value, skip it
      if (activeCorrection && (wm.value || '').toLowerCase().trim() !== activeCorrection.newValue.toLowerCase().trim()) {
        continue;
      }

      workingMemory.push({ key: wm.key, value: wm.value });
      if (workingMemory.length >= maxWorkingMemories) break;
    }

    // ── 7. Life Threads & Action Intelligence ───────────────────────────────
    const rawThreads = (lifeThreadsRes.data as any[]) || [];
    itemsConsidered += rawThreads.length;

    // BUG-06 / Amendment 3: Strip [CONCEPT SUPERSEDED] annotations from the
    // provenance shown in the situation brief. The thread stays active in DB
    // (provenance is preserved for audit), but the brief must NEVER surface
    // the invalidated concept as if it were the current state.
    const sanitizeThreadProvenance = (provenance: string | null | undefined): string => {
      if (!provenance) return '';
      // Remove lines that contain [CONCEPT SUPERSEDED] — these are historical correction markers
      return provenance
        .split('\n')
        .filter(line => !line.includes('[CONCEPT SUPERSEDED'))
        .join('\n')
        .trim();
    };

    const activeThreads = rawThreads
      .filter(t => t.state === 'active')
      .slice(0, maxLifeThreads)
      .map(t => ({ ...t, provenance: sanitizeThreadProvenance(t.provenance) }));
    const waitingOrBlocked = rawThreads
      .filter(t => t.state === 'waiting' || t.state === 'blocked')
      .slice(0, 2)
      .map(t => ({ ...t, provenance: sanitizeThreadProvenance(t.provenance) }));


    const rawActions = (actionsRes.data as any[]) || [];
    itemsConsidered += rawActions.length;
    const activeActions = rawActions.slice(0, maxActions);

    let nextBestAction: { id: string; logical_key: string; title: string; execution_class: string; priority: string } | null = null;
    if (activeActions.length > 0) {
      // Find ready actions (no unfinished dependencies)
      const readyActions = activeActions.filter(a => {
        if (!a.dependency_ids || a.dependency_ids.length === 0) return true;
        return !a.dependency_ids.some((depId: string) => activeActions.some(act => act.id === depId));
      });

      if (readyActions.length > 0) {
        readyActions.sort((a, b) => {
          const pMap: Record<string, number> = { high: 3, medium: 2, low: 1 };
          const pA = pMap[a.priority] || 2;
          const pB = pMap[b.priority] || 2;
          if (pA !== pB) return pB - pA;
          if (a.due_at && !b.due_at) return -1;
          if (!a.due_at && b.due_at) return 1;
          return 0;
        });
        nextBestAction = {
          id: readyActions[0].id,
          logical_key: readyActions[0].logical_key,
          title: readyActions[0].title,
          execution_class: readyActions[0].execution_class,
          priority: readyActions[0].priority
        };
      }
    }

    // ── 8. Reminders ────────────────────────────────────────────────────────
    const upcomingReminders = ((remindersRes.data as any[]) || []).map(r => ({
      id: r.id,
      title: r.title,
      trigger_at: r.trigger_at,
      event_trigger: r.event_trigger
    }));

    itemsSelected = durableFacts.length + workingMemory.length + shortTerm.length + activeThreads.length + activeActions.length + upcomingReminders.length;
    this.metrics.context_items_considered += itemsConsidered;
    this.metrics.context_items_selected += itemsSelected;

    const assemblyDuration = Date.now() - startTime;

    return {
      user: {
        id: userId,
        preferredName: profile.preferred_name,
        gender: profile.grammatical_gender,
        country: userCountry,
        personality: profile.companion_personality,
        currentVisualContext: profile.current_visual_context,
      },
      temporal: {
        nowLocal,
        tzOffset,
        tzLabel,
        dayName: DAY_NAMES[dayIdx],
        dateStr,
        timeStr,
        isWeekend,
        timeOfDayLabel,
        scheduleOverrideNote,
      },
      presence: {
        status: presenceStatus,
        last_active_at: presenceRaw.last_active_at,
        last_typing_at: presenceRaw.last_typing_at,
        unreadAssistantMessages: unreadRes.count || 0,
        gapMinutes,
      },
      conversation: {
        conversationId: options.conversationId || 'default',
        recentMessages,
        activeAntecedents,
      },
      turn: {
        effectiveMessage,
        turnAnalysis,
        extractedFacts,
        corrections,
      },
      memories: {
        durableFacts,
        historicalFacts,
        goals,
        shortTerm,
        workingMemory,
        totalCount: rawMemories.length,
      },
      lifeThreads: {
        active: activeThreads,
        waitingOrBlocked,
      },
      actions: {
        active: activeActions,
        nextBestAction,
      },
      reminders: {
        upcoming: upcomingReminders,
      },
      metadata: {
        assemblies_count: this.metrics.context_assemblies,
        items_considered: itemsConsidered,
        items_selected: itemsSelected,
        conflicts_detected: conflictsDetected,
        conflicts_resolved: conflictsResolved,
        clarifications_required: clarificationsRequired,
        degraded_sources: degradedSources,
        assembly_duration_ms: assemblyDuration,
      }
    };
  }

  /**
   * Deterministic Memory Ranking and Conflict Resolution.
   * Ensures that when multiple records exist for the same canonical fact key (e.g. wife_name),
   * only the current true record is presented as active truth, and historical versions are separated.
   */
  private resolveAndRankMemories(
    memories: any[],
    message: string,
    corrections: { key: string; oldValue?: string; newValue: string }[],
    maxDurable: number
  ): {
    durableFacts: DurableMemoryItem[];
    historicalFacts: HistoricalMemoryItem[];
    goals: { key: string; value: string; importance: number }[];
    detectedConflicts: number;
    resolvedConflicts: number;
  } {
    const goals: { key: string; value: string; importance: number }[] = [];
    const groupedByKey = new Map<string, any[]>();

    let detectedConflicts = 0;
    let resolvedConflicts = 0;

    for (const mem of memories) {
      if (mem.memory_type === 'goals') {
        goals.push({ key: mem.key, value: mem.value, importance: mem.importance || 50 });
      }

      // Group by CANONICAL key — not raw key — so alias rows (e.g. mothers_name,
      // mom_name) are treated as the same concept as mother_name.
      const { canonical: groupKey } = canonicalizeKey((mem.key || '').trim());
      if (!groupedByKey.has(groupKey)) {
        groupedByKey.set(groupKey, []);
      }
      groupedByKey.get(groupKey)!.push(mem);
    }

    const durableFacts: DurableMemoryItem[] = [];
    const historicalFacts: HistoricalMemoryItem[] = [];

    const keywords = extractKeywords(message).filter(k => !stopWords.has(k.toLowerCase()));

    for (const [key, memList] of groupedByKey.entries()) {
      if (memList.length > 1) {
        detectedConflicts++;
      }

      // Check if current turn explicitly corrects this canonical key
      // Also check if corrections used an alias key (e.g. correction for 'mom_name' → apply to 'mother_name')
      const activeCorrection = corrections.find(c => {
        const { canonical: corrCanonical } = canonicalizeKey(c.key);
        return corrCanonical === key;
      });

      // Sort candidate memories:
      // 1. If active correction matches value -> top
      // 2. updated_at / created_at desc (newest first)
      // 3. confidence desc
      // 4. importance desc
      memList.sort((a, b) => {
        if (activeCorrection) {
          if (a.value.toLowerCase() === activeCorrection.newValue.toLowerCase()) return -1;
          if (b.value.toLowerCase() === activeCorrection.newValue.toLowerCase()) return 1;
        }

        const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
        const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
        if (dateA !== dateB) return dateB - dateA;

        const confA = a.confidence ?? 0.5;
        const confB = b.confidence ?? 0.5;
        if (confA !== confB) return confB - confA;

        return (b.importance ?? 50) - (a.importance ?? 50);
      });

      const currentMem = memList[0];
      if (memList.length > 1) {
        resolvedConflicts++;
        for (let i = 1; i < memList.length; i++) {
          const oldMem = memList[i];
          historicalFacts.push({
            id: oldMem.id,
            key: oldMem.key,
            value: oldMem.value,
            replaced_by: currentMem.value,
            updated_at: oldMem.updated_at || oldMem.created_at,
            provenance: {
              source: 'long_term_memory',
              id: oldMem.id,
              key: oldMem.key,
              confidence: oldMem.confidence,
              updated_at: oldMem.updated_at,
              is_current: false
            }
          });
        }
      }

      // Calculate relevance score for currentMem
      let score = currentMem.importance || 50;
      const keyLower = currentMem.key.toLowerCase();
      const valLower = currentMem.value.toLowerCase();

      for (const kw of keywords) {
        const kwL = kw.toLowerCase();
        if (keyLower.includes(kwL) || valLower.includes(kwL)) {
          score += 40;
        }
      }

      const isProtected = !!currentMem.protection_source || currentMem.is_protected || false;
      if (isProtected) score += 30;
      if (activeCorrection) score += 50;

      durableFacts.push({
        id: currentMem.id,
        key: currentMem.key,
        value: currentMem.value,
        memory_type: currentMem.memory_type || 'fact',
        importance: score,
        confidence: currentMem.confidence ?? 0.9,
        is_current: true,
        is_protected: isProtected,
        provenance: {
          source: activeCorrection ? 'current_turn' : 'long_term_memory',
          id: currentMem.id,
          key: currentMem.key,
          confidence: currentMem.confidence,
          updated_at: currentMem.updated_at,
          is_current: true
        }
      });
    }

    // Sort durable facts by computed importance score descending
    durableFacts.sort((a, b) => b.importance - a.importance);

    return {
      durableFacts: durableFacts.slice(0, maxDurable),
      historicalFacts,
      goals,
      detectedConflicts,
      resolvedConflicts
    };
  }

  /**
   * Extracts conversational antecedents from recent turns to support natural pronoun resolution.
   * Priority: current turn -> recent conversation -> active thread -> long-term memory.
   */
  private extractConversationalAntecedents(
    recentMessages: { role: string; content: string }[],
    effectiveMessage: string,
    rawMemories: any[] = []
  ): AntecedentEntity[] {
    const antecedents: AntecedentEntity[] = [];
    const allRecentText = recentMessages.map(m => m.content).concat([effectiveMessage]).join('\n');

    // 1. Patterns for direct conversational entity introduction
    const patterns = [
      { regex: /(?:my\s+)?(sister|didi|behen)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'sister', gender: 'feminine' as const, pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
      { regex: /(?:my\s+)?(brother|bhai|bhaiya)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'brother', gender: 'masculine' as const, pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
      { regex: /(?:my\s+)?(wife|patni|biwi)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'wife', gender: 'feminine' as const, pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
      { regex: /(?:my\s+)?(husband|pati)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'husband', gender: 'masculine' as const, pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
      { regex: /(?:my\s+)?(son|beta)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'son', gender: 'masculine' as const, pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
      { regex: /(?:my\s+)?(daughter|beti)\s+(?:is|name is|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'daughter', gender: 'feminine' as const, pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
      { regex: /(?:my\s+)?(friend|dost|colleague|partner)\s+(?:is|name is|named|ka naam)\s+([A-Z][a-zA-Z\s]+?)(?:\.|\n|$|,|hai)/i, relation: 'associate', gender: 'neutral' as const, pronouns: ['they', 'them', 'he', 'she', 'wo'] },
    ];

    for (const p of patterns) {
      const match = allRecentText.match(p.regex);
      if (match && match[2]) {
        const entityName = match[2].trim().replace(/\s+(hai|is|named)$/i, '');
        if (entityName.length > 1) {
          antecedents.push({
            entity: entityName,
            relation: p.relation,
            gender: p.gender,
            pronounCandidates: p.pronouns,
            sourceMessage: match[0]
          });
        }
      }
    }

    // 2. Match known family member formal names and nicknames from memories
    if (rawMemories && rawMemories.length > 0 && effectiveMessage) {
      const lowerEffective = effectiveMessage.toLowerCase();
      const familyMeta: Record<string, { relation: string; gender: 'masculine' | 'feminine' | 'neutral'; pronouns: string[] }> = {
        son: { relation: 'son', gender: 'masculine', pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
        daughter: { relation: 'daughter', gender: 'feminine', pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
        wife: { relation: 'wife', gender: 'feminine', pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
        husband: { relation: 'husband', gender: 'masculine', pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
        mother: { relation: 'mother', gender: 'feminine', pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
        father: { relation: 'father', gender: 'masculine', pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
        sister: { relation: 'sister', gender: 'feminine', pronouns: ['she', 'her', 'wo', 'usne', 'uski'] },
        brother: { relation: 'brother', gender: 'masculine', pronouns: ['he', 'him', 'wo', 'usne', 'uska'] },
      };

      for (const [rel, meta] of Object.entries(familyMeta)) {
        const nameMem = rawMemories.find(m => !m.is_archived && (m.key === `${rel}_name` || m.key === `${rel}_real_name`));
        const nickMem = rawMemories.find(m => !m.is_archived && (m.key === `${rel}_nickname` || m.key === `${rel}_nick_name`));

        const nameVal = nameMem?.value?.trim();
        const nickVal = nickMem?.value?.trim();

        const matchesName = nameVal && nameVal.length > 1 && new RegExp(`\\b${nameVal}\\b`, 'i').test(lowerEffective);
        const matchesNick = nickVal && nickVal.length > 1 && new RegExp(`\\b${nickVal}\\b`, 'i').test(lowerEffective);

        if (matchesName || matchesNick) {
          const displayEntity = nameVal && nickVal ? `${nameVal} (${nickVal})` : (nameVal || nickVal || rel);
          if (!antecedents.some(a => a.relation === meta.relation)) {
            antecedents.push({
              entity: displayEntity,
              relation: meta.relation,
              gender: meta.gender,
              pronounCandidates: meta.pronouns,
              sourceMessage: effectiveMessage
            });
          }
        }
      }
    }

    return antecedents;
  }
}

export const cognitiveContextService = new CognitiveContextService();
