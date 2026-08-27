import { subconsciousAgent, SubconsciousJobPayloadSchema } from '../../agents/SubconsciousAgent';
import { NovaBrainService } from '../NovaBrainService';
import { subconsciousQueue, Job } from '../QueueService';
import { complete, stream } from '../../lib/nvidia';
import { supabaseAdmin } from '../../lib/supabase';
import { backgroundActions } from '../BackgroundActionService';
import { SchemaValidationError } from '../../types/errors';

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn(),
  determineUserProfile: jest.fn(() => 'USER_FAST'),
  stream: jest.fn()
}));

// Phase 10.1: cognitiveRouter mock — delegates to nvidia complete mock
jest.mock('../../lib/cognitiveRouter', () => ({
  cognitiveRouter: {
    complete: jest.fn(async (workload: string, messages: any[], options: any) => {
      const { complete } = jest.requireMock('../../lib/nvidia');
      return complete(workload, messages, options);
    }),
    stream: jest.fn(async function*(workload: string, messages: any[], options: any) {
      const { stream } = jest.requireMock('../../lib/nvidia');
      yield* stream(workload, messages, options);
    }),
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../BackgroundActionService', () => ({
  backgroundActions: {
    processActions: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../lib/supabase', () => {
  const mockFrom = jest.fn();
  return {
    supabaseAdmin: {
      from: mockFrom,
      rpc: jest.fn()
    }
  };
});

describe('Subconscious Queue Contract & Fast-Fail Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Requirement A: Valid subconscious payload â†’ successful processing', () => {
    it('should validate and successfully process a valid subconscious payload and record idempotency', async () => {
      const validPayload = {
        userId: 'user-456',
        messageId: 'msg-abc-123',
        conversationId: 'conv-789',
        message: 'I am so happy I finished my coding project today!',
        novaReply: 'That is awesome! Great job.',
        userCountry: 'IN'
      };

      // Schema check
      const parsed = SubconsciousJobPayloadSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);

      // Mock LLM response
      (complete as jest.Mock).mockResolvedValueOnce(JSON.stringify([
        { tool: 'MomentEngine', action: 'extract', data: { memory: 'Finished coding project' } }
      ]));

      // Mock Supabase processed_jobs check & insert
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      });
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'processed_jobs') {
          return { select: mockSelect, insert: mockInsert };
        }
        return { insert: jest.fn().mockResolvedValue({ data: null, error: null }) };
      });

      const job: Job = {
        id: 'job-1',
        job_type: 'extract_subconscious_actions',
        payload: validPayload,
        attempts: 0,
        status: 'running',
        created_at: new Date()
      };

      await subconsciousAgent.processJob(job);

      expect(complete).toHaveBeenCalledWith('SUBCONSCIOUS', expect.any(Array), expect.any(Object));
      expect(backgroundActions.processActions).toHaveBeenCalledWith(
        'user-456',
        'conv-789',
        expect.arrayContaining([expect.objectContaining({ tool: 'MomentEngine' })]),
        'IN'
      );
    });
  });

  describe('Requirement B: Missing messageId or malformed payload â†’ rejected with SchemaValidationError', () => {
    it('should reject payload missing messageId without invoking LLM', async () => {
      const malformedPayload = {
        userId: 'user-456',
        // messageId missing
        conversationId: 'conv-789',
        message: 'Hello',
        novaReply: 'Hi'
      };

      const job: Job = {
        id: 'job-malformed-1',
        job_type: 'extract_subconscious_actions',
        payload: malformedPayload,
        attempts: 0,
        status: 'running',
        created_at: new Date()
      };

      await expect(subconsciousAgent.processJob(job)).rejects.toThrow(SchemaValidationError);
      await expect(subconsciousAgent.processJob(job)).rejects.toThrow('missing messageId');

      // Crucial: LLM must NOT be called on malformed payloads
      expect(complete).not.toHaveBeenCalled();
    });

    it('should fail fast on missing novaReply or missing message text', async () => {
      const missingReplyPayload = {
        userId: 'user-456',
        messageId: 'msg-999',
        conversationId: 'conv-789',
        message: 'Hello'
        // novaReply missing
      };

      const job: Job = {
        id: 'job-malformed-2',
        job_type: 'extract_subconscious_actions',
        payload: missingReplyPayload,
        attempts: 0,
        status: 'running',
        created_at: new Date()
      };

      // Mock idempotency check to pass
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      });
      (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
        select: mockSelect,
        insert: jest.fn().mockResolvedValue({ data: null, error: null })
      }));

      await expect(subconsciousAgent.processJob(job)).rejects.toThrow(SchemaValidationError);
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('Requirement C: Producer always includes messageId', () => {
    it('processInteraction should enqueue subconscious extraction with valid messageId', async () => {
      const addSpy = jest.spyOn(subconsciousQueue, 'add').mockResolvedValue(null);
      (complete as jest.Mock).mockResolvedValue('Nova response');

      const brain = new NovaBrainService();
      const brainContext = {
        conversationId: 'conv-123',
        userMessageId: 'persisted-uuid-001',
        userCountry: 'IN'
      };

      await brain.processInteraction('user-1', [{ client_message_id: 'persisted-uuid-001', message: 'Hey Nova' }], brainContext);

      // Wait a tick for dynamic import and queue.add
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(addSpy).toHaveBeenCalledWith(
        'extract_subconscious_actions',
        expect.objectContaining({
          userId: 'user-1',
          messageId: 'persisted-uuid-001',
          conversationId: 'conv-123',
          message: 'Hey Nova',
          userMessage: 'Hey Nova',
          novaReply: 'Nova response',
          userCountry: 'IN'
        })
      );

      addSpy.mockRestore();
    });

    it('streamInteraction should enqueue subconscious extraction with valid messageId', async () => {
      const addSpy = jest.spyOn(subconsciousQueue, 'add').mockResolvedValue(null);
      
      async function* mockStreamGen() {
        yield '<reply>Streamed chunk 1 ';
        yield 'Streamed chunk 2</reply>';
      }
      (stream as jest.Mock).mockReturnValueOnce(mockStreamGen());

      const brain = new NovaBrainService();
      const brainContext = {
        conversationId: 'conv-stream-1',
        messageId: 'stream-msg-uuid-999',
        userCountry: 'US'
      };

      const generator = brain.streamInteraction('user-stream', [{ client_message_id: 'stream-msg-uuid-999', message: 'Streaming test message' }], brainContext);
      for await (const _chunk of generator) {
        // consume stream
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(addSpy).toHaveBeenCalledWith(
        'extract_subconscious_actions',
        expect.objectContaining({
          userId: 'user-stream',
          messageId: 'stream-msg-uuid-999',
          conversationId: 'conv-stream-1',
          message: 'Streaming test message',
          novaReply: expect.stringContaining('Streamed chunk'),
          userCountry: 'US'
        })
      );

      addSpy.mockRestore();
    });
  });

  describe('Requirement D: Retry of valid job preserves same messageId and honors idempotency', () => {
    it('should skip duplicate extraction if messageId was already processed', async () => {
      const payload = {
        userId: 'user-dup',
        messageId: 'msg-already-done-123',
        conversationId: 'conv-dup',
        message: 'I have a plan',
        novaReply: 'What is your plan?'
      };

      const job: Job = {
        id: 'job-dup-1',
        job_type: 'extract_subconscious_actions',
        payload,
        attempts: 1, // retry attempt
        status: 'running',
        created_at: new Date()
      };

      // Mock that this messageId is already in processed_jobs
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'proc-1', message_id: 'msg-already-done-123' }, error: null })
          })
        })
      });
      (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
        select: mockSelect
      }));

      await subconsciousAgent.processJob(job);

      // Should skip execution immediately without calling LLM
      expect(complete).not.toHaveBeenCalled();
      expect(backgroundActions.processActions).not.toHaveBeenCalled();
    });
  });

  describe('Failure Classification (Permanent vs Transient)', () => {
    it('should immediately dead-letter permanent schema validation errors without retrying', async () => {
      const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'background_jobs') return { update: mockUpdate };
        if (table === 'failed_jobs') return { insert: mockInsert };
        return { insert: jest.fn(), update: jest.fn() };
      });

      const permanentError = new SchemaValidationError('Job payload missing messageId for agent SubconsciousAgent');
      
      const job: Job = {
        id: 'job-perm-1',
        job_type: 'extract_subconscious_actions',
        payload: { userId: 'u1' }, // malformed
        attempts: 0,
        status: 'running',
        created_at: new Date()
      };

      // Call handleJobFailure via QueueService (casting private method for verification)
      await (subconsciousQueue as any).handleJobFailure(job, permanentError.message, true);

      // Verify it was marked failed directly on attempt 0 (set to maxAttempts)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('missing messageId'),
        attempts: 3
      }));

      // Verify written to failed_jobs DLQ
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        job_id: 'job-perm-1',
        job_type: 'extract_subconscious_actions',
        error: expect.stringContaining('missing messageId')
      }));
    });

    it('should keep transient errors (NVIDIA timeout, 429, 5xx) in pending retry state if attempts < maxAttempts', async () => {
      const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) });
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'background_jobs') return { update: mockUpdate };
        if (table === 'failed_jobs') return { insert: mockInsert };
        return { insert: jest.fn(), update: jest.fn() };
      });

      const transientError = new Error('NVIDIA API timeout after 30000ms');

      const job: Job = {
        id: 'job-transient-1',
        job_type: 'extract_subconscious_actions',
        payload: { userId: 'u1', messageId: 'msg-1', message: 'hello', novaReply: 'hi' },
        attempts: 0,
        status: 'running',
        created_at: new Date()
      };

      // Call handleJobFailure for transient error (isPermanent = false)
      await (subconsciousQueue as any).handleJobFailure(job, transientError.message, false);

      // Verify it returned to 'pending' with attempts incremented to 1
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        status: 'pending',
        error: 'NVIDIA API timeout after 30000ms',
        attempts: 1
      }));

      // Verify NOT written to failed_jobs DLQ on attempt 1
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});

