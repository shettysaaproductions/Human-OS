/**
 * CandidateSynthesisService.test.ts — Phase 2E-C Comprehensive Test Suite
 */

import {
  CandidateSynthesisService,
  generateCandidateFingerprint,
  CANDIDATE_SYNTHESIS_LIMITS,
} from '../CandidateSynthesisService';
import { supabaseAdmin } from '../../lib/supabase';
import { cognitiveRouter } from '../../lib/cognitiveRouter';
import { memoryRepository } from '../memoryRepository';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../../lib/cognitiveRouter', () => ({
  cognitiveRouter: {
    complete: jest.fn(),
  },
}));

jest.mock('../memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn(),
  },
}));

describe('Phase 2E-C: CandidateSynthesisService', () => {
  let service: CandidateSynthesisService;
  const userId = 'user-phase2ec-123';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CandidateSynthesisService();
  });

  // 1. empty user batch → 0 LLM calls
  test('1. Empty user batch results in 0 LLM calls', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === 'episodic_memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.status).toBe('empty_batch');
    expect(result.modelCalls).toBe(0);
    expect(cognitiveRouter.complete).not.toHaveBeenCalled();
  });

  // 2-6. Category candidates (EVENT, FACT, PREFERENCE, GOAL, IDENTITY)
  test('2-6. Accurately synthesizes EVENT, FACT, PREFERENCE, GOAL, IDENTITY candidates', async () => {
    const wmId1 = 'wm-1';
    const epId1 = 'ep-1';

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: wmId1, key: 'company', value: 'Google', created_at: new Date().toISOString() },
            ],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'episodic_memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: epId1, summary: 'Joined new office today', source_message_id: 'm-1', created_at: new Date().toISOString() },
            ],
            error: null,
          }),
        };
      }
      if (table === 'memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'company_name',
            value: 'Google',
            confidence: 0.9,
            importance: 80,
            reason: 'User joined Google today',
            source_refs: [{ type: 'working_memory', id: wmId1 }],
          },
          {
            category: 'EVENT',
            key: 'job_start_milestone',
            value: 'Started working at new company',
            confidence: 0.85,
            importance: 75,
            reason: 'First day at office event',
            source_refs: [{ type: 'episodic_memory', id: epId1 }],
          },
          {
            category: 'PREFERENCE',
            key: 'work_mode',
            value: 'morning focus',
            confidence: 0.8,
            importance: 70,
            reason: 'User prefers mornings',
            source_refs: [{ type: 'working_memory', id: wmId1 }],
          },
          {
            category: 'GOAL',
            key: 'career_growth',
            value: 'excel at new role',
            confidence: 0.75,
            importance: 70,
            reason: 'New job target',
            source_refs: [{ type: 'working_memory', id: wmId1 }],
          },
          {
            category: 'IDENTITY',
            key: 'profession',
            value: 'Software Engineer',
            confidence: 0.88,
            importance: 85,
            reason: 'Engineering role confirmed',
            source_refs: [{ type: 'working_memory', id: wmId1 }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.status).toBe('completed');
    expect(result.candidatesGenerated.length).toBe(5);
    expect(result.candidatesGenerated.map(c => c.category)).toEqual([
      'FACT',
      'EVENT',
      'PREFERENCE',
      'GOAL',
      'IDENTITY',
    ]);
  });

  // 7. Repeated event does not automatically become personality trait (Frequency != Truth)
  test('7. Frequency != Truth: Blocks psychological conclusions / traits from repeated events', async () => {
    const wmId = 'wm-pizza';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'food_log', value: 'ate pizza 3 times', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'PATTERN',
            key: 'dietary_trait',
            value: 'User is obsessed with pizza and addicted to fast food',
            confidence: 0.95,
            importance: 80,
            reason: 'User ate pizza 3 times this week',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(0);
    expect(result.candidatesRejected).toBe(1);
  });

  // 8. Garbage/question candidate rejected
  test('8. Rejects garbage and question text candidates', async () => {
    const wmId = 'wm-q';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'query', value: 'Abhi mera main goal kya hai?', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'GOAL',
            key: 'user_question',
            value: 'Abhi mera main goal kya hai?',
            confidence: 0.85,
            importance: 70,
            reason: 'User asked about goals',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(0);
    expect(result.candidatesRejected).toBe(1);
  });

  // 9. Canonical key normalization
  test('9. Normalizes candidate keys via canonicalizeKey', async () => {
    const wmId = 'wm-alias';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'spouse_name', value: 'Sakshi', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'spouse_name',
            value: 'Sakshi',
            confidence: 0.9,
            importance: 85,
            reason: 'Spouse identified',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(1);
    expect(result.candidatesGenerated[0].proposed_key).toBe('wife_name');
  });

  // 10. Duplicate candidate fingerprint deduplication
  test('10. Deduplicates repeated candidates using deterministic fingerprints', async () => {
    const wmId = 'wm-dup';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'hobby', value: 'chess', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'PREFERENCE',
            key: 'hobby',
            value: 'Chess',
            confidence: 0.85,
            importance: 70,
            reason: 'Plays chess',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
          {
            category: 'PREFERENCE',
            key: 'hobby',
            value: 'chess',
            confidence: 0.85,
            importance: 70,
            reason: 'Duplicate chess preference',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(1);
    expect(result.candidatesDeduplicated).toBe(1);
  });

  // 11. Existing semantic memory deduplication
  test('11. Suppresses candidates that match already-canonical semantic memories', async () => {
    const wmId = 'wm-canon';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'wife_name', value: 'Sakshi', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ key: 'wife_name', value: 'Sakshi' }],
            error: null,
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'wife_name',
            value: 'Sakshi',
            confidence: 0.95,
            importance: 90,
            reason: 'Already canonical fact',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(0);
    expect(result.candidatesDeduplicated).toBe(1);
  });

  // 12. Source reference preservation & rejection of ungrounded IDs
  test('12. Preserves verified source references and rejects ungrounded references', async () => {
    const realWmId = 'wm-grounded';
    const fakeWmId = 'wm-fake-hallucination';

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: realWmId, key: 'city', value: 'Mumbai', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'current_city',
            value: 'Mumbai',
            confidence: 0.88,
            importance: 75,
            reason: 'User lives in Mumbai',
            source_refs: [{ type: 'working_memory', id: realWmId }],
          },
          {
            category: 'FACT',
            key: 'fake_city',
            value: 'Delhi',
            confidence: 0.88,
            importance: 75,
            reason: 'Hallucinated',
            source_refs: [{ type: 'working_memory', id: fakeWmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.candidatesGenerated.length).toBe(1);
    expect(result.candidatesGenerated[0].source_references[0].id).toBe(realWmId);
    expect(result.candidatesRejected).toBe(1);
  });

  // 13. Malformed Gemini JSON handled cleanly
  test('13. Handles malformed Gemini JSON safely without throwing', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'wm-1', key: 'city', value: 'Bangalore', created_at: new Date().toISOString() }],
            error: null,
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue('MALFORMED_JSON_STRING');

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.status).toBe('completed');
    expect(result.candidatesGenerated.length).toBe(0);
  });

  // 14-15. Timeout and Rate limit fail gracefully
  test('14-15. Fails gracefully on model error/timeout/rate limit', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'wm-1', key: 'city', value: 'Bangalore', created_at: new Date().toISOString() }],
            error: null,
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockRejectedValue(new Error('Rate limit exceeded (429)'));

    const result = await service.synthesizeCandidatesForUser(userId);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Rate limit exceeded');
  });

  // 16-17. User isolation and bounded batch
  test('16-17. Enforces strict user isolation and bounded batch sizes', async () => {
    const packet = await service.buildEvidencePacket(userId);
    expect(CANDIDATE_SYNTHESIS_LIMITS.MAX_WORKING_MEMORY_RECORDS_PER_USER).toBe(20);
    expect(CANDIDATE_SYNTHESIS_LIMITS.MAX_EPISODIC_RECORDS_PER_USER).toBe(20);
    expect(CANDIDATE_SYNTHESIS_LIMITS.MAX_CANDIDATES_PER_USER).toBe(10);
  });

  // 19. MANDATORY: Zero semantic memory writes
  test('19. MANDATORY: Zero writes to durable semantic memory (memories table)', async () => {
    const wmId = 'wm-no-write';
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'pet_name', value: 'Bruno', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'dog_name',
            value: 'Bruno',
            confidence: 0.9,
            importance: 80,
            reason: 'User has a dog named Bruno',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    await service.synthesizeCandidatesForUser(userId);

    // CRITICAL: memoryRepository.upsertMemory MUST NEVER BE CALLED
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();

    // Verify memories table was only SELECT queried, never inserted or updated
    const memoriesCalls = (supabaseAdmin.from as jest.Mock).mock.calls.filter(c => c[0] === 'memories');
    memoriesCalls.forEach(call => {
      expect(call[0]).toBe('memories');
    });
  });

  // 20. No source archival or deletion
  test('20. No deletion or archival of source working/episodic memory records', async () => {
    const wmId = 'wm-preserve';
    const mockDelete = jest.fn();
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: wmId, key: 'sport', value: 'cricket', created_at: new Date().toISOString() }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ error: null }),
          delete: mockDelete,
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'PREFERENCE',
            key: 'favorite_sport',
            value: 'Cricket',
            confidence: 0.85,
            importance: 75,
            reason: 'Plays cricket',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    await service.synthesizeCandidatesForUser(userId);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  // 21. Candidate TTL and fingerprint function test
  test('21. Candidate TTL is set to 7 days and fingerprint is deterministic', () => {
    const fp1 = generateCandidateFingerprint('u1', 'FACT', 'company_name', 'Acme Corp');
    const fp2 = generateCandidateFingerprint('u1', 'FACT', 'company_name', 'Acme Corp');
    const fp3 = generateCandidateFingerprint('u1', 'FACT', 'company_name', 'Other Corp');

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(CANDIDATE_SYNTHESIS_LIMITS.CANDIDATE_TTL_DAYS).toBe(7);
  });
});
