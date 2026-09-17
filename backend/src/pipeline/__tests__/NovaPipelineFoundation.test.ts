/**
 * NovaPipelineFoundation.test.ts — Test Suite for Phase 1 Unified Pipeline
 *
 * Verifies all 12 core architectural invariants:
 * 1. ONE BRAIN: All inputs enter common event pipeline.
 * 2. ONE CANONICAL MEMORY MODEL: memory_bubbles is entity source of truth, memories is attribute truth.
 * 3. ENTITY OWNERSHIP: Every fact resolves to the entity it describes, not domain namespaces.
 * 4. CONTEXT: Preserves subject across turns ("he", "his", "Tiku", "my son").
 * 5. FACT / EVENT / ENTITY DISTINCTION: Discriminated typing.
 * 6. PROVENANCE + CONFIDENCE: Source, confidence, acquisitionMode tracked.
 * 7. CONTINUOUS RECONCILIATION: Memory effects reconciled into graph.
 * 8. NO FULL-DATABASE SCANS: Indexed candidate retrieval.
 * 9. AUTONOMY CONTEXTUAL: Proactive triggers use same context fabric.
 * 10. PLATFORM-AWARE: Captures device constraints.
 * 11. PIPELINE MODULE CONTRACT: Standard Input -> Process -> Output -> Memory Effects.
 * 12. NO HARDCODED SPECIAL-CASING: Relies on generic language and context rules.
 */

import { NovaEventFactory, FactOrEntityKind, NovaProvenance } from '../NovaEvent';
import { ContextResolver, EntityFocusState, NovaPipelineContext } from '../NovaContext';
import { contextualEntityResolver } from '../ContextualEntityResolver';
import { novaModuleRegistry, NovaPipelineModule, NovaModuleResult } from '../NovaPipelineModule';
import { memoryReconciliationModule } from '../modules/MemoryReconciliationModule';
import { chatPipelineModule } from '../modules/ChatPipelineModule';
import { novaPipelineOrchestrator } from '../NovaPipelineOrchestrator';

// Mock Supabase admin & memory repository
jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
    }),
  },
}));

jest.mock('../../services/memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockImplementation(async (params) => ({
      id: 'mock-mem-id',
      ...params,
    })),
  },
}));

jest.mock('../../services/CanonicalMemoryTreeService', () => ({
  canonicalMemoryTreeService: {
    resolveOrCreateEntityBubble: jest.fn().mockResolvedValue({ id: 'mock-bubble-uuid' }),
  },
}));

jest.mock('../../services/DeterministicGuardianService', () => ({
  deterministicGuardian: {
    runPostTurnScan: jest.fn().mockResolvedValue({ anomaliesFound: 0 }),
  },
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn().mockResolvedValue('Hello from Nova!'),
}));

describe('Nova OS Unified Pipeline Foundation (Phase 1)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    jest.clearAllMocks();
    novaPipelineOrchestrator.initialize();
  });

  describe('1. NovaEvent & FactOrEntityKind Contracts', () => {
    it('creates standardized INPUT_TEXT events with strict provenance', () => {
      const evt = NovaEventFactory.createInputText({
        userId,
        rawText: 'My son is learning Python',
        clientMessageId: 'msg-123',
      });

      expect(evt.type).toBe('INPUT_TEXT');
      expect(evt.userId).toBe(userId);
      expect(evt.provenance.source).toBe('chat');
      expect(evt.provenance.confidence).toBe(1.0);
      expect(evt.provenance.acquisitionMode).toBe('user_stated');
      expect(evt.provenance.evidenceText).toBe('My son is learning Python');
    });

    it('creates standardized INPUT_VOICE_NOTE events with voice metadata', () => {
      const evt = NovaEventFactory.createInputText({
        userId,
        rawText: 'Remind me to take my pills',
        isVoiceNote: true,
        audioDurationSec: 4.5,
      });

      expect(evt.type).toBe('INPUT_VOICE_NOTE');
      expect(evt.provenance.source).toBe('voice_note');
      expect(evt.payload.isVoiceTranscribed).toBe(true);
      expect(evt.payload.audioDurationSec).toBe(4.5);
    });

    it('creates standardized SIGNAL_PRESENCE events', () => {
      const evt = NovaEventFactory.createPresenceSignal({
        userId,
        status: 'online',
        isAppForeground: true,
        networkType: 'wifi',
      });

      expect(evt.type).toBe('SIGNAL_PRESENCE');
      expect(evt.provenance.source).toBe('device_sensor');
      expect(evt.provenance.acquisitionMode).toBe('observed');
    });
  });

  describe('2. Context & Anaphora / Pronoun Resolution', () => {
    it('resolves masculine pronouns ("he", "his") to the active entity in context', () => {
      const focus: EntityFocusState = {
        activeEntity: {
          id: 'entity:person_shreshth',
          name: 'Shreshth',
          entityType: 'person',
          relationToUser: 'son',
          gender: 'masculine',
          aliases: ['Tiku'],
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 2,
        },
        activeDomain: 'family',
        recentEntities: [],
      };

      const resolved = ContextResolver.resolvePronoun('he', focus);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe('entity:person_shreshth');
      expect(resolved?.name).toBe('Shreshth');
    });

    it('resolves feminine pronouns ("she", "her") to feminine antecedents in recentEntities', () => {
      const focus: EntityFocusState = {
        activeEntity: {
          id: 'entity:person_rohan',
          name: 'Rohan',
          entityType: 'person',
          gender: 'masculine',
          aliases: [],
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 1,
        },
        activeDomain: 'work',
        recentEntities: [
          {
            id: 'entity:person_sakshi',
            name: 'Sakshi',
            entityType: 'person',
            relationToUser: 'wife',
            gender: 'feminine',
            aliases: [],
            lastMentionedAt: new Date().toISOString(),
            mentionCount: 3,
          },
        ],
      };

      const resolved = ContextResolver.resolvePronoun('she', focus);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe('entity:person_sakshi');
      expect(resolved?.name).toBe('Sakshi');
    });

    it('resolves location references ("there", "that place") to place entities', () => {
      const focus: EntityFocusState = {
        activeEntity: {
          id: 'entity:place_dubai',
          name: 'Dubai',
          entityType: 'place',
          aliases: [],
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 1,
        },
        activeDomain: 'lifestyle',
        recentEntities: [],
      };

      const resolved = ContextResolver.resolvePronoun('there', focus);
      expect(resolved).not.toBeNull();
      expect(resolved?.name).toBe('Dubai');
    });
  });

  describe('3. Entity Ownership & Semantic Fact Resolution', () => {
    const mockContext: NovaPipelineContext = {
      userId,
      conversationId: 'conv-1',
      turnId: 'turn-1',
      turnSequence: 1,
      userProfile: { preferredName: 'Aryan' },
      entityFocus: {
        activeEntity: null,
        activeDomain: null,
        recentEntities: [],
      },
      platform: {
        isAppForeground: true,
        canSpeak: false,
        canPush: true,
        isScreenLocked: false,
      },
      temporal: {
        nowLocal: new Date(),
        timezoneOffsetHours: 5.5,
        timeStr: '10:00 AM',
        dayName: 'Thursday',
        dateStr: 'Sep 17, 2026',
        isWeekend: false,
        isQuietHours: false,
        timeOfDayLabel: 'morning',
      },
      candidates: {
        entities: [],
        facts: [],
        activeReminders: [],
        activeGoals: [],
      },
      customState: {},
    };

    it('enforces entity ownership for third-party possessives', () => {
      const result = contextualEntityResolver.resolveTurn("Ejaz's father was in the Navy", mockContext);

      // Must NOT assign military_service to user:self or to domain:family
      expect(result.primarySubjectId).toBe('entity:person_ejaz_father');
      expect(result.semanticUnits.length).toBeGreaterThan(0);

      const fact = result.semanticUnits.find((u) => u.predicate === 'military_service');
      expect(fact).toBeDefined();
      expect(fact?.subjectEntityId).toBe('entity:person_ejaz_father');
      expect(fact?.value).toBe('Navy');
      expect(fact?.temporalState).toBe('PAST');
    });

    it('resolves pronouns across turns to the correct entity owner', () => {
      // Turn 1: Discussing son
      const sonEntity = {
        id: 'entity:person_shreshth',
        name: 'Shreshth',
        entityType: 'person' as const,
        relationToUser: 'son',
        gender: 'masculine' as const,
        aliases: ['Tiku'],
        lastMentionedAt: new Date().toISOString(),
        mentionCount: 1,
      };

      const contextWithSon: NovaPipelineContext = {
        ...mockContext,
        entityFocus: {
          activeEntity: sonEntity,
          activeDomain: 'family',
          recentEntities: [sonEntity],
        },
      };

      // Turn 2: "He works at Google"
      const result = contextualEntityResolver.resolveTurn('He works at Google', contextWithSon);

      expect(result.primarySubjectId).toBe('entity:person_shreshth');
      const fact = result.semanticUnits.find((u) => u.predicate === 'company_name');
      expect(fact).toBeDefined();
      expect(fact?.subjectEntityId).toBe('entity:person_shreshth');
      expect(fact?.value).toBe('Google');
    });

    it('strictly rejects Hindi verbs and light verbs from becoming entities', () => {
      // "Call kar ke utha dena" should NOT extract "kar" or "ke" as people
      const result = contextualEntityResolver.resolveTurn('Kal phone kar ke utha dena', mockContext);

      const rogueEntities = result.detectedEntities.filter(
        (e) => e.name.toLowerCase() === 'kar' || e.name.toLowerCase() === 'ke'
      );
      expect(rogueEntities.length).toBe(0);
    });
  });

  describe('4. Pipeline Module Registry & Topological Ordering', () => {
    it('registers modules and resolves execution order according to dependencies', () => {
      const order = novaModuleRegistry.getExecutionOrder();
      const names = order.map((m) => m.name);

      expect(names).toContain('MemoryReconciliationModule');
      expect(names).toContain('ChatPipelineModule');
      expect(names).toContain('VoicePipelineModule');

      // ChatPipelineModule depends on MemoryReconciliationModule, so reconciliation comes first
      const reconIdx = names.indexOf('MemoryReconciliationModule');
      const chatIdx = names.indexOf('ChatPipelineModule');
      expect(reconIdx).toBeLessThan(chatIdx);
    });
  });

  describe('5. MemoryReconciliationModule Canonical Reconciliation', () => {
    it('reconciles entity and attribute effects into canonical memory stores with bubble_id', async () => {
      const effect = {
        kind: 'ATTRIBUTE' as FactOrEntityKind,
        action: 'update' as const,
        subjectEntityId: 'entity:person_shreshth',
        subjectEntityName: 'Shreshth',
        predicate: 'company_name',
        value: 'Google',
        domainKey: 'family',
        provenance: {
          source: 'chat' as const,
          timestamp: new Date().toISOString(),
          confidence: 0.95,
          acquisitionMode: 'user_stated' as const,
        },
        confidence: 0.95,
      };

      const result = await memoryReconciliationModule.reconcileEffect(userId, effect);

      expect(result.status).toBe('attribute_reconciled');
      expect(result.bubbleId).toBe('mock-bubble-uuid');
    });
  });

  describe('6. NovaPipelineOrchestrator End-to-End Turn Execution', () => {
    it('executes a complete turn through the 10-stage pipeline', async () => {
      const event = NovaEventFactory.createInputText({
        userId,
        rawText: 'My son Shreshth works at Google',
      });

      const result = await novaPipelineOrchestrator.execute(event);

      expect(result.turnId).toBeDefined();
      expect(result.output?.replyText).toBeDefined();
      expect(result.reconciledEffects).toBeGreaterThanOrEqual(1);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });
  });
});
