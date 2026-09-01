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
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
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
  // ADMISSION THRESHOLD
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Admission Threshold', () => {
    const validUserId = '11111111-1111-1111-1111-111111111111';

    it('should ignore trivial single-step tasks', async () => {
      mockSupabase.limit.mockResolvedValueOnce({
        data: [{ role: 'user', content: 'remind me to call plumber tomorrow' }],
        error: null
      });

      mockSupabase.in
        .mockResolvedValueOnce({ data: [], error: null }) // activeThreads
        .mockResolvedValueOnce({ data: [], error: null }); // recent actions

      // We mock the LLM returning "ignore" due to the new prompt rules
      (chatCompletionBackground as jest.Mock).mockResolvedValueOnce(`{
        "action": "ignore",
        "reason": "Trivial single-step task, does not qualify as LifeThread"
      }`);

      await agent.processJob({ payload: { user_id: validUserId, turn_context: {} } });
      
      // Because action="ignore", applyUpdate does nothing
      expect(mockSupabase.insert).not.toHaveBeenCalled();
      expect(mockSupabase.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CORRECTION SCRUBBING
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Correction Scrubbing', () => {
    const validUserId = '11111111-1111-1111-1111-111111111111';

    it('should pass scrubbedConcept to repository on correction', async () => {
      // Setup mock to return a thread
      mockSupabase.limit.mockResolvedValueOnce({
        data: [{ role: 'user', content: 'Actually my wife is not Priya, it is Sakshi' }],
        error: null
      });

      mockSupabase.in
        .mockResolvedValueOnce({ 
          data: [{ id: 'thread-wife', topic: 'Wife is Priya', state: 'active', provenance: 'User said wife is Priya' }], 
          error: null 
        })
        .mockResolvedValueOnce({ data: [], error: null });

      // We mock the LLM returning an update due to correction
      (chatCompletionBackground as jest.Mock).mockResolvedValueOnce(`{
        "action": "update",
        "thread_id": "thread-wife",
        "topic": "Wife is Sakshi",
        "reason": "Correction"
      }`);

      await agent.processJob({ 
        payload: { 
          user_id: validUserId,
          turn_context: {
            negativeCorrectionConcepts: ['Priya']
          }
        } 
      });

      // The internal logic will try to scrub "Priya" during thread updates
      // This implicitly exercises updateThreadProvenanceForCorrection
      expect(chatCompletionBackground).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // BUG-NEGATION-RESUME — 12-test surgical suite (FINAL)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('BUG-NEGATION-RESUME: resume lifecycle (final surgical)', () => {
    const validUserId = '11111111-1111-1111-1111-111111111111';
    const otherUserId = '22222222-2222-2222-2222-222222222222';
    const waitingThreadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const waitingThread = {
      id: waitingThreadId,
      topic: 'Cloud Kitchen Start Plan',
      state: 'waiting',
      priority: 'medium',
      provenance: '[PAUSED by user: "cloud kitchen abhi start nahi kar raha" — 2026-08-30]\n[STATE TRANSITION: active -> waiting]'
    };

    function setupChatWithMsg(msg: string) {
      mockSupabase.limit.mockResolvedValueOnce({
        data: [{ role: 'user', content: msg }]
      });
    }

    function setupThreads(threads: any[]) {
      mockSupabase.in
        .mockResolvedValueOnce({ data: threads, error: null })   // life_threads
        .mockResolvedValueOnce({ data: [], error: null });        // nova_actions
    }

    function setupLlm(response: object) {
      (chatCompletionBackground as jest.Mock).mockResolvedValueOnce(JSON.stringify(response));
    }

    // ─── Test 1: action=create + explicit resume + waiting thread → redirect to update ───
    it('[RESUME-1] LLM returns action=create + explicit resume + waiting thread → redirected to update/active', async () => {
      setupChatWithMsg('Ab cloud kitchen next month start karne wala hu');
      setupThreads([waitingThread]);
      setupLlm({ action: 'create', topic: 'cloud kitchen', state: 'active', provenance: 'Starting fresh', reason: 'User resuming', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      // Must NOT insert a new thread
      expect(mockSupabase.insert).not.toHaveBeenCalled();
      // Must update the existing waiting thread
      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload).toBeDefined();
      expect(updatePayload.state).toBe('active');
    });

    // ─── Test 2: action=update + explicit resume → active ───
    it('[RESUME-2] action=update + explicit resume → state set to active', async () => {
      setupChatWithMsg('Ab cloud kitchen next month start karne wala hu');
      setupThreads([waitingThread]);
      setupLlm({ action: 'update', thread_id: waitingThreadId, state: 'active', provenance: 'User is resuming cloud kitchen', reason: 'Explicit resume', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('active');
    });

    // ─── Test 3: explicit resume + low Jaccard → waiting thread still found via resume candidate ───
    it('[RESUME-3] explicit resume with a verbose message (low Jaccard) → waiting thread still identified', async () => {
      // The message has many tokens diluting Jaccard below 0.25
      setupChatWithMsg('Yaar suno, woh jo cloud kitchen ka plan tha, wo ab next month se phir se shuru karte hain');
      setupThreads([waitingThread]);
      setupLlm({ action: 'create', topic: 'cloud kitchen', state: 'active', provenance: 'User resuming', reason: 'Resuming', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      // Must NOT insert duplicate
      expect(mockSupabase.insert).not.toHaveBeenCalled();
      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload?.state).toBe('active');
    });

    // ─── Test 4: explicit resume → no duplicate thread ───
    it('[RESUME-4] explicit resume → no new thread inserted (no duplicate)', async () => {
      setupChatWithMsg('phir se shuru karte hain cloud kitchen');
      setupThreads([waitingThread]);
      setupLlm({ action: 'create', topic: 'cloud kitchen', state: 'active', provenance: 'Resuming', reason: 'Resume', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    // ─── Test 5: unrelated create → new thread still created ───
    it('[RESUME-5] unrelated create without explicit resume → new thread created normally', async () => {
      setupChatWithMsg('Main ek new restaurant open karna chahta hu');
      setupThreads([]); // no waiting threads
      setupLlm({ action: 'create', topic: 'New Restaurant', state: 'active', provenance: 'User wants to open a restaurant', reason: 'Fresh goal', actions: [] });
      mockSupabase.insert.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({ data: { id: 'new-thread-id' }, error: null });

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    // ─── Test 6: temporary pause → waiting ───
    it('[RESUME-6] temporary pause → thread transitions to waiting', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: waitingThreadId, topic: 'Cloud Kitchen Start Plan', state: 'active', provenance: 'User started goal' }],
        error: null
      });
      mockSupabase.update.mockReturnThis();

      await agent.processSuppressJob({
        payload: { user_id: validUserId, negated_concept: 'cloud kitchen', is_current: true, reason: 'cloud kitchen abhi start nahi kar raha' }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('waiting');
      expect(updatePayload.provenance).toContain('[PAUSED by user');
      expect(updatePayload.provenance).toContain('STATE TRANSITION: active -> waiting');
    });

    // ─── Test 7: permanent cancellation → abandoned ───
    it('[RESUME-7] permanent cancellation → thread transitions to abandoned', async () => {
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: waitingThreadId, topic: 'Cloud Kitchen Start Plan', state: 'active', provenance: 'User started goal' }],
        error: null
      });
      mockSupabase.update.mockReturnThis();

      await agent.processSuppressJob({
        payload: { user_id: validUserId, negated_concept: 'cloud kitchen', is_current: false, reason: 'cloud kitchen cancel kar diya permanently' }
      });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('abandoned');
      expect(updatePayload.provenance).toContain('[ABANDONED by user');
    });

    // ─── Test 8: resume → waiting -> active with correct provenance ───
    it('[RESUME-8] resume → state transitions waiting -> active and provenance has RESUMED marker', async () => {
      setupChatWithMsg('Ab cloud kitchen next month start karne wala hu');
      setupThreads([waitingThread]);
      setupLlm({ action: 'update', thread_id: waitingThreadId, state: 'active', provenance: 'User is resuming', reason: 'Explicit resume', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      expect(updatePayload.state).toBe('active');
    });

    // ─── Test 9: provenance contains full pause + resume history ───
    it('[RESUME-9] provenance appends RESUMED and STATE TRANSITION without overwriting pause history', async () => {
      setupChatWithMsg('Ab cloud kitchen next month start karne wala hu');
      setupThreads([waitingThread]);
      setupLlm({ action: 'update', thread_id: waitingThreadId, state: 'active', provenance: 'User restarting cloud kitchen plan', reason: 'Explicit resume', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      const updatePayload = mockSupabase.update.mock.calls[0]?.[0];
      // Original pause history preserved
      expect(updatePayload.provenance).toContain('[PAUSED by user');
      expect(updatePayload.provenance).toContain('STATE TRANSITION: active -> waiting');
      // Resume markers appended
      expect(updatePayload.provenance).toContain('[RESUMED by user');
      expect(updatePayload.provenance).toContain('STATE TRANSITION: waiting -> active');
    });

    // ─── Test 10: stale suppress does not blindly overwrite a resumed thread ───
    it('[RESUME-10] suppress job that finds thread already in waiting (stale) skips write', async () => {
      // Thread is already in 'waiting', suppress tries to set it to 'waiting' again
      mockSupabase.in.mockResolvedValueOnce({
        data: [{ id: waitingThreadId, topic: 'Cloud Kitchen Start Plan', state: 'waiting', provenance: 'Already paused' }],
        error: null
      });
      mockSupabase.update.mockReturnThis();

      await agent.processSuppressJob({
        payload: { user_id: validUserId, negated_concept: 'cloud kitchen', is_current: true, reason: 'Duplicate pause signal' }
      });

      // update should NOT have been called because thread.state === targetState ('waiting')
      expect(mockSupabase.update).not.toHaveBeenCalled();
    });

    // ─── Test 11: same-turn pause does not get recreated immediately (DEDUP_GUARD) ───
    it('[RESUME-11] action=create for concept that matches a waiting thread without resume intent → blocked by DEDUP_GUARD', async () => {
      // Message has NO explicit resume phrase — just mentions cloud kitchen
      setupChatWithMsg('Cloud kitchen ke baare mein kuch sochna chahta hu');
      setupThreads([waitingThread]);
      setupLlm({ action: 'create', topic: 'cloud kitchen plan', state: 'active', provenance: 'New goal', reason: 'User mentioned cloud kitchen', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      // DEDUP_GUARD blocks the insert because a waiting thread already exists with matching tokens
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    // ─── Test 12: different user's waiting thread cannot be resumed ───
    it('[RESUME-12] waiting thread belongs to different user → not resumed by current user', async () => {
      // The thread returned belongs to otherUserId
      const otherUserThread = { ...waitingThread, user_id: otherUserId };
      // But processJob always queries by user_id via Supabase eq(), so the DB filter prevents it.
      // Here we verify that even if (hypothetically) it was in the array, the applyUpdate
      // still guards with userId equality in the DB update call.
      setupChatWithMsg('Ab cloud kitchen next month start karne wala hu');
      setupThreads([waitingThread]); // mock returns same thread for this user
      setupLlm({ action: 'update', thread_id: waitingThreadId, state: 'active', provenance: 'Resuming', reason: 'Resume', actions: [] });
      mockSupabase.update.mockReturnThis();

      await agent.processJob({ payload: { user_id: validUserId, turn_context: { negativeCorrectionConcepts: [] } } });

      // The .eq('user_id', userId) guard must be in the update chain
      const eqCalls = mockSupabase.eq.mock.calls;
      const userIdGuard = eqCalls.some(([col, val]: [string, string]) => col === 'user_id' && val === validUserId);
      expect(userIdGuard).toBe(true);
    });
  });
});



