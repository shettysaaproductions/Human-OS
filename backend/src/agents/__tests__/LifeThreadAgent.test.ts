import { LifeThreadAgent } from '../LifeThreadAgent';
import { supabaseAdmin } from '../../lib/supabase';
import { chatCompletionBackground } from '../../lib/nvidia';

jest.mock('../../lib/supabase', () => {
  const mockQuery: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { id: '123' }, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: '123' }, error: null }),
    then: jest.fn((resolve) => resolve({ data: [], error: null })),
  };
  return { supabaseAdmin: mockQuery };
});

jest.mock('../../lib/nvidia', () => ({
  chatCompletionBackground: jest.fn()
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('LifeThreadAgent', () => {
  let agent: LifeThreadAgent;
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new LifeThreadAgent();
    mockSupabase = supabaseAdmin;
  });

  it('should transition a thread from active to completed', async () => {
    // Mock getting chat history
    mockSupabase.limit.mockResolvedValueOnce({
      data: [
        { role: 'user', content: 'I finished the interview! It went well.' },
        { role: 'assistant', content: 'That is awesome!' }
      ]
    });

    mockSupabase.in
      .mockResolvedValueOnce({
        data: [
          { id: '123', topic: 'job interview', state: 'active', priority: 'high', provenance: 'User has an interview tomorrow.' }
        ]
      })
      .mockResolvedValueOnce({
        data: []
      });

    // Mock LLM response
    (chatCompletionBackground as jest.Mock).mockResolvedValue(
      JSON.stringify({
        action: 'complete',
        thread_id: '123',
        topic: 'job interview',
        state: 'completed',
        priority: 'high',
        provenance: 'User finished the interview and it went well.'
      })
    );

    const testUserId = '00000000-0000-0000-0000-000000000001';

    await agent.processJob({
      payload: {
        user_id: testUserId,
        turn_context: {
          userMessage: 'I finished the interview! It went well.',
          novaReply: 'That is awesome!'
        }
      }
    });

    // Verify LLM was called
    expect(chatCompletionBackground).toHaveBeenCalled();
    const prompt = (chatCompletionBackground as jest.Mock).mock.calls[0][0][0].content;
    expect(prompt).toContain('I finished the interview!');
    expect(prompt).toContain('job interview');

    // Verify update was called with completed state
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'completed'
      })
    );
  });

  it('should create a new active thread when detecting a new goal', async () => {
    const testUserId = '00000000-0000-0000-0000-000000000001';

    mockSupabase.limit.mockResolvedValueOnce({
      data: [{ role: 'user', content: 'I am going to start a new cloud kitchen business.' }]
    });

    mockSupabase.in
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    (chatCompletionBackground as jest.Mock).mockResolvedValue(
      JSON.stringify({
        action: 'create',
        topic: 'cloud kitchen business',
        state: 'active',
        priority: 'high',
        provenance: 'User is starting a new cloud kitchen.'
      })
    );

    await agent.processJob({
      payload: {
        user_id: testUserId,
        turn_context: {
          userMessage: 'I am going to start a new cloud kitchen business.',
          novaReply: 'That sounds exciting!'
        }
      }
    });

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'active',
        topic: 'cloud kitchen business',
        user_id: testUserId
      })
    );
  });

  it('should throw classified error when user_id is missing or malformed', async () => {
    await expect(agent.processJob({ payload: {} })).rejects.toThrow('LifeThreadAgent[MALFORMED_PAYLOAD]');
    await expect(agent.processJob({ payload: { user_id: 'invalid-id', turn_context: {} } })).rejects.toThrow('LifeThreadAgent[INVALID_USER_ID]');
  });

  // ─── BUG-NEGATION: processSuppressJob regression tests ────────────────────

  describe('processSuppressJob', () => {
    const validUserId = '00000000-0000-0000-0000-000000000001';

    it('[BUG-NEGATION-1] isCurrent=true → transitions active thread to WAITING state', async () => {
      // Simulate thread fetch returning an active cloud kitchen thread
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: 'thread-ck-1', topic: 'Start Cloud Kitchen', state: 'active', provenance: 'User wants to start cloud kitchen.' }],
        error: null
      });

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: true,
          reason: 'User said: "cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai"',
        }
      });

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'waiting' })
      );
    });

    it('[BUG-NEGATION-2] isCurrent=false → transitions active thread to ABANDONED state', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: 'thread-ck-2', topic: 'Start Cloud Kitchen', state: 'active', provenance: '' }],
        error: null
      });

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: false,
          reason: 'User said: "cloud kitchen cancel kar diya"',
        }
      });

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'abandoned' })
      );
    });

    it('[BUG-NEGATION-3] missing is_current defaults to WAITING (safe/non-destructive)', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: 'thread-ck-3', topic: 'Cloud Kitchen Launch', state: 'active', provenance: '' }],
        error: null
      });

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          // is_current intentionally omitted
          reason: 'some reason',
        }
      });

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'waiting' })
      );
    });

    it('[BUG-NEGATION-4] idempotency: thread already in target state is NOT updated again', async () => {
      // Thread is already waiting — should NOT emit another update
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: 'thread-ck-4', topic: 'Cloud Kitchen', state: 'waiting', provenance: '' }],
        error: null
      });

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: true,
        }
      });

      expect(mockSupabase.update).not.toHaveBeenCalled();
    });

    it('[BUG-NEGATION-5] no matching thread → no update emitted', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: 'thread-gym', topic: 'Gym Routine', state: 'active', provenance: '' }],
        error: null
      });

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: true,
        }
      });

      expect(mockSupabase.update).not.toHaveBeenCalled();
    });

    it('[BUG-NEGATION-6] missing negated_concept throws MALFORMED_PAYLOAD', async () => {
      await expect(
        agent.processSuppressJob({ payload: { user_id: validUserId } })
      ).rejects.toThrow('LifeThreadAgent[SUPPRESS][MALFORMED_PAYLOAD]');
    });


    it('[BUG-NEGATION-7] invalid user_id throws INVALID_USER_ID', async () => {
      await expect(
        agent.processSuppressJob({ payload: { user_id: 'bad-id', negated_concept: 'cloud kitchen' } })
      ).rejects.toThrow('LifeThreadAgent[SUPPRESS][INVALID_USER_ID]');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // BUG-NEGATION-RESUME — Resume path tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe('BUG-NEGATION-RESUME: resume lifecycle', () => {
    const validUserId = '11111111-1111-1111-1111-111111111111';
    const waitingThreadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const waitingThread = {
      id: waitingThreadId,
      topic: 'Cloud Kitchen Start Plan',
      state: 'waiting',
      priority: 'medium',
      provenance: '[PAUSED by user — 2026-08-30]\n[STATE TRANSITION: active -> waiting]'
    };

    function setupMocksForResume(llmResponse: string) {
      // chat_history fetch: limit() resolves last
      mockSupabase.limit.mockResolvedValueOnce({
        data: [{ role: 'user', content: 'Ab cloud kitchen next month start karne wala hu' }]
      });
      // life_threads fetch (from().select().eq().in()) and nova_actions fetch (second .in())
      mockSupabase.in
        .mockResolvedValueOnce({ data: [waitingThread], error: null })  // life_threads
        .mockResolvedValueOnce({ data: [], error: null });               // nova_actions
      // LLM response
      (chatCompletionBackground as jest.Mock).mockResolvedValueOnce(llmResponse);
      // applyUpdate: update().eq().eq() — let the default `then` handler resolve it
      mockSupabase.update.mockReturnThis();
      // Do NOT call mockSupabase.eq.mockResolvedValue() — that breaks the .eq().in() chain
    }

    it('[RESUME-1] waiting thread + explicit resume → state set to active', async () => {
      setupMocksForResume(JSON.stringify({
        action: 'update',
        thread_id: waitingThreadId,
        state: 'active',
        provenance: 'User is resuming cloud kitchen plan for next month',
        reason: 'User explicitly said they will start next month',
        actions: []
      }));

      await agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      });

      const updateCall = mockSupabase.update.mock.calls[0]?.[0];
      expect(updateCall).toBeDefined();
      expect(updateCall.state).toBe('active');
    });

    it('[RESUME-2] waiting thread + unrelated message → update NOT called for that thread', async () => {
      // chat_history fetch
      mockSupabase.limit.mockResolvedValueOnce({
        data: [{ role: 'user', content: 'Aaj mausam bahut acha hai' }]
      });
      mockSupabase.in
        .mockResolvedValueOnce({ data: [waitingThread], error: null })
        .mockResolvedValueOnce({ data: [], error: null });
      (chatCompletionBackground as jest.Mock).mockResolvedValueOnce(JSON.stringify({
        action: 'ignore',
        reason: 'User is talking about weather, unrelated to life thread',
        actions: []
      }));

      await agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      });

      expect(mockSupabase.update).not.toHaveBeenCalled();
    });

    it('[RESUME-3] explicit resume uses exact same thread_id (no new thread created)', async () => {
      setupMocksForResume(JSON.stringify({
        action: 'update',
        thread_id: waitingThreadId,
        state: 'active',
        provenance: 'User resuming cloud kitchen',
        reason: 'User said ab start karne wala hu',
        actions: []
      }));

      await agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      });

      // insert should NOT have been called (no new thread created)
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it('[RESUME-4] applyUpdate sets state=active on the correct thread', async () => {
      setupMocksForResume(JSON.stringify({
        action: 'update',
        thread_id: waitingThreadId,
        state: 'active',
        provenance: 'Resuming cloud kitchen next month',
        reason: 'Explicit resume intent',
        actions: []
      }));

      await agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('active');
    });

    it('[RESUME-5] provenance on resume appends RESUMED and STATE TRANSITION note', async () => {
      setupMocksForResume(JSON.stringify({
        action: 'update',
        thread_id: waitingThreadId,
        state: 'active',
        provenance: 'User restarting cloud kitchen plan',
        reason: 'Explicit intent stated',
        actions: []
      }));

      await agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.provenance).toContain('[RESUMED by user');
      expect(updatePayload.provenance).toContain('STATE TRANSITION: waiting -> active');
      // Original provenance must be preserved
      expect(updatePayload.provenance).toContain('[PAUSED by user');
    });

    it('[RESUME-6] pause still produces waiting (regression: pause not broken)', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: waitingThreadId, topic: 'Cloud Kitchen Start Plan', state: 'active', provenance: 'User started goal' }],
        error: null
      });
      mockSupabase.update.mockReturnThis();

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: true,
          reason: 'cloud kitchen abhi start nahi kar raha'
        }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('waiting');
      expect(updatePayload.provenance).toContain('[PAUSED by user');
    });

    it('[RESUME-7] cancel produces abandoned (regression: permanent drop not broken)', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: waitingThreadId, topic: 'Cloud Kitchen Start Plan', state: 'active', provenance: 'User started goal' }],
        error: null
      });
      mockSupabase.update.mockReturnThis();

      await agent.processSuppressJob({
        payload: {
          user_id: validUserId,
          negated_concept: 'cloud kitchen',
          is_current: false,
          reason: 'cloud kitchen cancel kar diya'
        }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('abandoned');
      expect(updatePayload.provenance).toContain('[ABANDONED by user');
    });

    it('[RESUME-8] LLM returns action=update without state → falls back to targetThread.state (no crash)', async () => {
      setupMocksForResume(JSON.stringify({
        action: 'update',
        thread_id: waitingThreadId,
        // state deliberately omitted
        provenance: 'Some update',
        reason: 'test',
        actions: []
      }));

      await expect(agent.processJob({
        payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } }
      })).resolves.not.toThrow();
    });

    it('[RESUME-9] "ab start karunga" → LLM prompt contains RESUME instruction', () => {
      // Access buildPrompt via reflection to verify the prompt text contains the resume rule
      const threads = [{ id: waitingThreadId, topic: 'Cloud Kitchen', state: 'waiting', provenance: '' }];
      const recentChat = [{ role: 'user', content: 'ab start karunga' }];
      const prompt = (agent as any).buildPrompt(threads, [], recentChat);
      expect(prompt).toContain('state = "active"');
      expect(prompt).toContain('THIS IS MANDATORY');
      expect(prompt).toContain(waitingThreadId);
    });

    it('[RESUME-10] all resume phrases appear in resume instruction', () => {
      const threads = [{ id: waitingThreadId, topic: 'Cloud Kitchen', state: 'waiting', provenance: '' }];
      const recentChat = [{ role: 'user', content: 'Ab cloud kitchen next month start karne wala hu' }];
      const prompt = (agent as any).buildPrompt(threads, [], recentChat);
      expect(prompt).toContain('ab start karunga');
      expect(prompt).toContain('next month shuru karunga');
      expect(prompt).toContain('resume karte hain');
      expect(prompt).toContain('ab dobara shuru');
    });
  });
});

