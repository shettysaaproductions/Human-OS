/**
 * NovaPipelineOrchestrator.ts — The Master Cognitive Pipeline Orchestrator (Phase 1)
 *
 * ARCHITECTURAL ROLE:
 * Executes the unified, predictable 10-stage cognitive cycle:
 * INPUT → UNDERSTANDING → ENTITY/INTENT → STATE/CONTEXT → DECISION → ACTION → OUTPUT → OBSERVATION → RECONCILIATION
 *
 * Connects Chat, Voice, Memory, Goals, Reminders, Galaxy, and Autonomous Brain
 * to operate as ONE unified brain.
 */

import { NovaInputEvent } from './NovaEvent';
import {
  NovaPipelineContext,
  EntityFocusState,
  PlatformConstraints,
  TemporalContext,
} from './NovaContext';
import {
  NovaModuleResult,
  novaModuleRegistry,
  MemoryEffect,
} from './NovaPipelineModule';
import { contextualEntityResolver } from './ContextualEntityResolver';
import { memoryReconciliationModule } from './modules/MemoryReconciliationModule';
import { chatPipelineModule } from './modules/ChatPipelineModule';
import { voicePipelineModule } from './modules/VoicePipelineModule';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cognitiveEventBus } from '../lib/cognitiveEventBus';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { deterministicGuardian } from '../services/DeterministicGuardianService';

export interface NovaPipelineResult {
  turnId: string;
  correlationId: string;
  output?: {
    replyText?: string;
    options?: string[];
    audioBase64?: string;
    audioDurationSec?: number;
    toolResults?: Array<{ toolName: string; args?: unknown; result: unknown }>;
  };
  reconciledEffects: number;
  activeEntityId?: string;
  activeEntityName?: string;
  executionTimeMs: number;
}

export class NovaPipelineOrchestrator {
  private static instance: NovaPipelineOrchestrator;
  private initialized = false;

  static getInstance(): NovaPipelineOrchestrator {
    if (!NovaPipelineOrchestrator.instance) {
      NovaPipelineOrchestrator.instance = new NovaPipelineOrchestrator();
    }
    return NovaPipelineOrchestrator.instance;
  }

  /**
   * Initializes standard capability modules in registry.
   */
  initialize(): void {
    if (this.initialized) return;

    novaModuleRegistry.register(memoryReconciliationModule);
    novaModuleRegistry.register(chatPipelineModule);
    novaModuleRegistry.register(voicePipelineModule);

    this.initialized = true;
    logger.info('[NovaPipelineOrchestrator] Initialized with core modules');
  }

  /**
   * Main unified entry point. All incoming events flow through this method.
   */
  async execute(event: NovaInputEvent): Promise<NovaPipelineResult> {
    this.initialize();
    const startTime = Date.now();
    const turnId = event.correlationId || event.eventId;
    const userId = event.userId;
    const conversationId = event.conversationId || 'default_conv';

    logger.info('[Pipeline] Ingress turn started', {
      turnId,
      userId,
      eventType: event.type,
      provenance: event.provenance.source,
    });

    // ── STAGE 1 & 2: Context Hydration (Bounded & Indexed) ────────────────────
    const context = await this.hydrateContext(event, turnId);

    // ── STAGE 3: Understanding & Reference Resolution ─────────────────────────
    // Extract search tokens from payload text if applicable
    const inputText = (event as any).payload?.rawText || (event as any).payload?.transcript || '';
    if (inputText) {
      const tokens = inputText.split(/\s+/).filter((w: string) => w.length >= 3);
      if (tokens.length > 0) {
        const candidateEntities = await contextualEntityResolver.fetchIndexedCandidates(userId, tokens);
        context.candidates.entities = candidateEntities;
      }
    }

    // ── STAGE 4: Module Selection ─────────────────────────────────────────────
    const module = novaModuleRegistry.findHandler(event, context);
    if (!module) {
      logger.warn('[Pipeline] No registered module could handle event', { eventType: event.type });
      return {
        turnId,
        correlationId: event.correlationId,
        reconciledEffects: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // ── STAGE 5: Module Execution & Output Formulation ────────────────────────
    let moduleResult: NovaModuleResult;
    try {
      moduleResult = await module.process(event, context);
    } catch (procErr: any) {
      logger.error('[Pipeline] Module execution failure', {
        module: module.name,
        error: procErr.message,
        userId,
      });
      moduleResult = {
        success: false,
        error: { code: 'EXECUTION_ERROR', message: procErr.message, recoverable: true },
        emittedEvents: [],
        memoryEffects: [],
      };
    }

    // Apply context updates returned by module
    if (moduleResult.contextUpdates) {
      Object.assign(context, moduleResult.contextUpdates);
    }

    // ── STAGE 6: Event Emission & Queueing ────────────────────────────────────
    if (moduleResult.emittedEvents && moduleResult.emittedEvents.length > 0) {
      for (const childEvent of moduleResult.emittedEvents) {
        setImmediate(() => {
          this.execute(childEvent).catch((emitErr) => {
            logger.error('[Pipeline] Error executing emitted child event', {
              childEventId: childEvent.eventId,
              error: emitErr.message,
            });
          });
        });
      }
    }

    // ── STAGE 7: Continuous Memory Reconciliation ─────────────────────────────
    let reconciledCount = 0;
    const allEffects: MemoryEffect[] = [...(moduleResult.memoryEffects || [])];

    if (allEffects.length > 0) {
      for (const effect of allEffects) {
        try {
          const recRes = await memoryReconciliationModule.reconcileEffect(userId, effect);
          if (recRes.status !== 'error') {
            reconciledCount++;
          }
        } catch (recErr: any) {
          logger.warn('[Pipeline] Non-fatal reconciliation error', { error: recErr.message, effect });
        }
      }
    }

    // ── STAGE 8: Context Persistence ──────────────────────────────────────────
    await this.persistEntityFocus(userId, conversationId, context.entityFocus);

    // ── STAGE 9: Deterministic Guardian Observation (Zero-LLM Non-blocking) ──
    setImmediate(() => {
      deterministicGuardian.runPostTurnScan(userId, turnId).catch((gErr: any) => {
        logger.debug('[Pipeline] Post-turn guardian non-fatal error', { error: gErr?.message });
      });
    });

    // ── STAGE 10: Telemetry & Result Envelope ─────────────────────────────────
    const executionTimeMs = Date.now() - startTime;
    cognitiveEventBus.emit({
      eventType: 'turn_analyzed',
      userId,
      correlationId: event.correlationId,
      timestamp: new Date().toISOString(),
      data: {
        turnId,
        eventType: event.type,
        handlerModule: module.name,
        reconciledEffects: reconciledCount,
        executionTimeMs,
      },
    });

    return {
      turnId,
      correlationId: event.correlationId,
      output: moduleResult.output,
      reconciledEffects: reconciledCount,
      activeEntityId: context.entityFocus.activeEntity?.id,
      activeEntityName: context.entityFocus.activeEntity?.name,
      executionTimeMs,
    };
  }

  /**
   * Hydrates pipeline context with cached entity focus and platform state.
   */
  private async hydrateContext(event: NovaInputEvent, turnId: string): Promise<NovaPipelineContext> {
    const userId = event.userId;
    const conversationId = event.conversationId || 'default_conv';

    // 1. Load User Profile
    let preferredName = 'User';
    let language: 'en' | 'hi' | 'auto' = 'auto';
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, preferred_name, personality_profile, language')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        preferredName = profile.preferred_name || profile.full_name || 'User';
        language = profile.language || 'auto';
      }
    } catch {
      // Non-fatal profile lookup fallback
    }

    // 2. Load Persisted Entity Focus from Cache or working memory
    const entityFocus = await this.loadEntityFocus(userId, conversationId);

    // 3. Construct Temporal Context
    const now = new Date();
    const hours = now.getHours();
    const isQuietHours = hours >= 23 || hours < 7;
    const temporal: TemporalContext = {
      nowLocal: now,
      timezoneOffsetHours: 5.5, // Default IST or resolved from user profile
      timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
      dateStr: now.toLocaleDateString(),
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
      isQuietHours,
      timeOfDayLabel: hours < 12 ? 'morning' : hours < 17 ? 'afternoon' : hours < 21 ? 'evening' : 'night',
    };

    // 4. Platform Constraints
    const platform: PlatformConstraints = {
      isAppForeground: true,
      canSpeak: event.type === 'INPUT_LIVE_VOICE_TURN',
      canPush: true,
      isScreenLocked: false,
    };

    return {
      userId,
      conversationId,
      turnId,
      turnSequence: 1,
      userProfile: {
        preferredName,
        language,
      },
      entityFocus,
      platform,
      temporal,
      candidates: {
        entities: [],
        facts: [],
        activeReminders: [],
        activeGoals: [],
      },
      customState: {},
    };
  }

  private async loadEntityFocus(userId: string, conversationId: string): Promise<EntityFocusState> {
    const cacheKey = `focus:${userId}:${conversationId}`;
    const cached = cache.get<EntityFocusState>(cacheKey);
    if (cached) {
      return cached;
    }

    return {
      activeEntity: null,
      activeDomain: null,
      recentEntities: [],
    };
  }

  private async persistEntityFocus(
    userId: string,
    conversationId: string,
    focus: EntityFocusState
  ): Promise<void> {
    const cacheKey = `focus:${userId}:${conversationId}`;
    cache.set(cacheKey, focus, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);
  }
}

export const novaPipelineOrchestrator = NovaPipelineOrchestrator.getInstance();
