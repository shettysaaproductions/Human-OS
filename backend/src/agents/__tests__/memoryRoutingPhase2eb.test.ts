import { consolidatedMemoryAgent } from '../ConsolidatedMemoryAgent';
import { deterministicFactAgent } from '../DeterministicFactAgent';
import { supabaseAdmin } from '../../lib/supabase';
import { memoryRepository } from '../../services/memoryRepository';
import { complete } from '../../lib/nvidia';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

jest.mock('../../services/memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn()
}));

describe('Phase 2E-B Memory Routing & Retention Policy', () => {
  const userId = 'user-test-123';
  const messageId = 'msg-test-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1. Subconscious candidates route to WorkingMemory with CANDIDATE status and no hardcoded 72h TTL', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_jobs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ error: null })
        };
      }
      if (table === 'working_memory') {
        return {
          insert: mockInsert
        };
      }
      return {
        insert: jest.fn().mockResolvedValue({ error: null })
      };
    });

    (complete as jest.Mock).mockResolvedValue(JSON.stringify({
      semantic_memories: [
        { key: 'favorite_snack', value: 'samosa', shouldPersist: true }
      ],
      working_memories: [],
      episodic_memories: []
    }));

    await consolidatedMemoryAgent.processJob({
      job_id: 'job-1',
      job_type: 'extract_all_memories',
      user_id: userId,
      payload: {
        userId,
        messageId,
        message: 'I love eating samosas on rainy days'
      },
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString()
    });

    // Verify it called working_memory insert
    expect(supabaseAdmin.from).toHaveBeenCalledWith('working_memory');
    expect(mockInsert).toHaveBeenCalledTimes(1);

    const insertedData = mockInsert.mock.calls[0][0];
    expect(insertedData).toEqual([
      {
        user_id: userId,
        key: 'favorite_snack',
        value: 'samosa',
        promotion_status: 'CANDIDATE'
      }
    ]);

    // Verify NO hardcoded 72h expires_at was attached
    expect(insertedData[0].expires_at).toBeUndefined();

    // Verify memoryRepository was NOT called for this subconscious memory
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  test('2. Standard working memories preserve their default/custom expiry behavior', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'processed_jobs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ error: null })
        };
      }
      if (table === 'working_memory') {
        return {
          insert: mockInsert
        };
      }
      return {
        insert: jest.fn().mockResolvedValue({ error: null })
      };
    });

    (complete as jest.Mock).mockResolvedValue(JSON.stringify({
      semantic_memories: [],
      working_memories: [
        { key: 'current_mood', value: 'happy', expires_in_hours: 12 }
      ],
      episodic_memories: []
    }));

    await consolidatedMemoryAgent.processJob({
      job_id: 'job-2',
      job_type: 'extract_all_memories',
      user_id: userId,
      payload: {
        userId,
        messageId: 'msg-test-789',
        message: 'Feeling great right now!'
      },
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString()
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedWM = mockInsert.mock.calls[0][0];
    expect(insertedWM[0].key).toBe('current_mood');
    expect(insertedWM[0].value).toBe('happy');
    expect(insertedWM[0].expires_at).toBeDefined(); // Standard working memory preserves expires_at
  });

  test('3. Explicit and Deterministic facts route immediately to durable semantic memory via memoryRepository', async () => {
    // Deterministic fact (unprotected)
    await deterministicFactAgent.processJob({
      job_id: 'job-3',
      job_type: 'extract_deterministic_fact',
      user_id: userId,
      payload: {
        userId,
        facts: [
          { key: 'wife_name', value: 'Sakshi', is_protected: false }
        ],
        sourceMessage: 'Meri wife ka naam Sakshi hai.'
      },
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString()
    });

    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        key: 'wife_name',
        value: 'Sakshi',
        source_authority: 'deterministic',
        is_protected: false
      }),
      'Meri wife ka naam Sakshi hai.'
    );

    // Explicit user fact (protected)
    await deterministicFactAgent.processJob({
      job_id: 'job-4',
      job_type: 'extract_deterministic_fact',
      user_id: userId,
      payload: {
        userId,
        facts: [
          { key: 'morning_routine', value: 'morning walk', is_protected: true, factClass: 'PROTECTED_FACT' }
        ],
        sourceMessage: 'Isko yaad rakhna: mujhe morning walk pasand hai'
      },
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString()
    });

    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        key: 'morning_routine',
        value: 'morning walk',
        source_authority: 'explicit_user',
        is_protected: true,
        protection_source: 'user_explicit'
      }),
      'Isko yaad rakhna: mujhe morning walk pasand hai'
    );
  });
});
