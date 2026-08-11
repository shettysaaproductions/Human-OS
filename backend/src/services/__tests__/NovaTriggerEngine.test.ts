import { NovaTriggerEngine } from '../NovaTriggerEngine';
import { supabaseAdmin } from '../../lib/supabase';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import { logger } from '../../lib/logger';

// Mock these EXACTLY as requested
jest.mock('../../lib/supabase', () => {
  const chainable: any = {};
  Object.assign(chainable, {
    select: jest.fn().mockReturnValue(chainable),
    eq: jest.fn().mockReturnValue(chainable),
    order: jest.fn().mockReturnValue(chainable),
    limit: jest.fn().mockReturnValue(chainable),
    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    insert: jest.fn().mockResolvedValue({ data: null })
  });
  return {
    supabaseAdmin: {
      from: jest.fn(() => chainable)
    }
  };
});

jest.mock('../../lib/pushNotifications', () => ({
  sendNovaReplyNotification: jest.fn()
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('NovaTriggerEngine', () => {
  let engine: NovaTriggerEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    engine = new NovaTriggerEngine();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const getContext = (overrides = {}) => ({
    userPresence: 'online' as const,
    lastUserMessageAt: Date.now() - 60000,
    lastNovaReplyAt: Date.now() - 120000,
    conversationIntensity: 'focused' as const,
    userActivity: null,
    pendingReminders: 0,
    emotionalState: {},
    ...overrides
  });

  describe('2.1 Deduplication Cache', () => {
    it('should block exact-duplicate message within 10 min window', async () => {
      // Populate dedupeCache
      (engine as any).dedupeCache.set('user-1', { lastContent: 'Same message', lastSentAt: Date.now() - 5 * 60 * 1000 });
      const messageGenerator = jest.fn().mockResolvedValue('Same message');
      
      await engine.scheduleMessage('user-1', getContext(), messageGenerator);
      jest.runAllTimers();
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Deduplicated exact message'));
      expect(sendNovaReplyNotification).not.toHaveBeenCalled();
    });

    it('should allow same message after 10-min window expires', async () => {
      (engine as any).dedupeCache.set('user-1', { lastContent: 'Same message', lastSentAt: Date.now() - 11 * 60 * 1000 });
      const messageGenerator = jest.fn().mockResolvedValue('Same message');

      await engine.scheduleMessage('user-1', getContext(), messageGenerator);
      jest.runAllTimers();
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Deduplicated exact message'));
    });

    it('should track dedupe cache per-user', async () => {
      (engine as any).dedupeCache.set('user-a', { lastContent: 'Same message', lastSentAt: Date.now() - 5 * 60 * 1000 });
      const messageGenerator = jest.fn().mockResolvedValue('Same message');

      await engine.scheduleMessage('user-b', getContext(), messageGenerator);
      jest.runAllTimers();
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Deduplicated exact message'));
    });
  });

  describe('2.2 Rate Limiting', () => {
    it('should allow requests under 30/min ceiling', async () => {
      const result = await engine.shouldTrigger(getContext());
      expect(result.shouldSend).toBe(true);
    });

    it('should block requests once 30 requests are made within 1 minute', async () => {
      for (let i = 0; i < 30; i++) {
        await engine.shouldTrigger(getContext());
      }
      const result = await engine.shouldTrigger(getContext());
      expect(result.shouldSend).toBe(false);
      expect(result.reason).toBe('rate_limited');
    });

    it('should reset the rate limit after 1 minute', async () => {
      for (let i = 0; i < 30; i++) {
        await engine.shouldTrigger(getContext());
      }
      jest.advanceTimersByTime(61000);
      const result = await engine.shouldTrigger(getContext());
      expect(result.shouldSend).toBe(true);
    });
  });

  describe('2.3 Presence-Based Timing', () => {
    it('typing: fast response 2-8s delay', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'focused' }));
      expect(result.delayMs).toBeGreaterThanOrEqual(2000);
      expect(result.delayMs).toBeLessThanOrEqual(8000);
    });

    it('online: natural pace 5-25s delay', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'online', conversationIntensity: 'focused' }));
      expect(result.delayMs).toBeGreaterThanOrEqual(5000);
      expect(result.delayMs).toBeLessThanOrEqual(25000);
    });

    it('away: thoughtful pause 30-120s delay', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'away', conversationIntensity: 'focused' }));
      expect(result.delayMs).toBeGreaterThanOrEqual(30000);
      expect(result.delayMs).toBeLessThanOrEqual(120000);
    });

    it('offline: long delay 5-15min', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'offline', conversationIntensity: 'focused' }));
      expect(result.delayMs).toBeGreaterThanOrEqual(300000);
      expect(result.delayMs).toBeLessThanOrEqual(900000);
    });
  });

  describe('2.4 Urgency Override', () => {
    it('should send urgent messages even when user is offline', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'offline', pendingReminders: 1 }));
      expect(result.shouldSend).toBe(true);
      expect(result.delayMs).toBe(60000);
      expect(result.reason).toBe('urgent_offline');
    });

    it('should detect emotional crisis as urgent', async () => {
      const result = await engine.shouldTrigger(getContext({ userPresence: 'offline', emotionalState: { crisisDetected: true } }));
      expect(result.shouldSend).toBe(true);
      expect(result.reason).toBe('urgent_offline');
    });
  });

  describe('2.5 Conversation Intensity', () => {
    it('deep intensity: 1.5x slower delay', async () => {
      const deep = await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'deep' }));
      expect(deep.delayMs).toBeGreaterThanOrEqual(2000 * 1.5);
    });

    it('casual intensity: 0.7x faster delay', async () => {
      const casual = await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'casual' }));
      await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'focused' }));
      expect(casual.delayMs).toBeLessThanOrEqual(8000 * 0.7);
    });

    it('should add 5s buffer when user just sent a message <3s ago', async () => {
      const recent = await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'focused', lastUserMessageAt: Date.now() - 1000 }));
      await engine.shouldTrigger(getContext({ userPresence: 'typing', conversationIntensity: 'focused', lastUserMessageAt: Date.now() - 10000 }));
      
      expect(recent.delayMs).toBeGreaterThanOrEqual(2000 + 5000);
    });
  });

  describe('2.6 analyzeConversationIntensity', () => {
    let mockChain: any;
    beforeEach(() => {
      mockChain = (supabaseAdmin.from as jest.Mock)('chat_history');
    });

    it('Short messages (<80 chars avg) -> assert casual', async () => {
      mockChain.limit.mockReturnValueOnce(Promise.resolve({ data: [{ content: 'a'.repeat(40) }] }));
      const intensity = await engine.analyzeConversationIntensity('u1');
      expect(intensity).toBe('casual');
    });

    it('Medium messages (80-200 chars avg) -> assert focused', async () => {
      mockChain.limit.mockReturnValueOnce(Promise.resolve({ data: [{ content: 'a'.repeat(100) }] }));
      const intensity = await engine.analyzeConversationIntensity('u1');
      expect(intensity).toBe('focused');
    });

    it('Long messages (>200 chars avg) -> assert deep', async () => {
      mockChain.limit.mockReturnValueOnce(Promise.resolve({ data: [{ content: 'a'.repeat(250) }] }));
      const intensity = await engine.analyzeConversationIntensity('u1');
      expect(intensity).toBe('deep');
    });

    it('No messages (null data) -> assert casual', async () => {
      mockChain.limit.mockReturnValueOnce(Promise.resolve({ data: null }));
      const intensity = await engine.analyzeConversationIntensity('u1');
      expect(intensity).toBe('casual');
    });
  });

  describe('2.7 scheduleMessage Integration', () => {
    it('should cancel existing scheduled message for same user', async () => {
      engine.shouldTrigger = jest.fn().mockResolvedValue({ shouldSend: true, delayMs: 10 });
      const mockClearTimeout = jest.spyOn(global, 'clearTimeout');
      const messageGenerator = jest.fn().mockResolvedValue('Hello');
      
      await engine.scheduleMessage('u1', getContext(), messageGenerator);
      const firstTimeout = (engine as any).scheduledMessages.get('u1');
      
      await engine.scheduleMessage('u1', getContext(), messageGenerator);
      
      expect(mockClearTimeout).toHaveBeenCalledWith(firstTimeout);
    });

    it('should save message to chat_history and outreach_log', async () => {
      engine.shouldTrigger = jest.fn().mockResolvedValue({ shouldSend: true, delayMs: 10 });
      const messageGenerator = jest.fn().mockResolvedValue('Hello integration');
      const mockChain = (supabaseAdmin.from as jest.Mock)();
      
      mockChain.maybeSingle.mockResolvedValueOnce({ data: { push_token: 'token-123' } }); 
      mockChain.maybeSingle.mockResolvedValueOnce({ data: { conversation_id: 'conv-1' } }); 
      mockChain.insert.mockResolvedValue({});

      await engine.scheduleMessage('u-integration', getContext(), messageGenerator);
      
      await jest.runAllTimersAsync();

      if ((logger.error as jest.Mock).mock.calls.length > 0) {
        console.error('Logger error called:', (logger.error as jest.Mock).mock.calls);
      }

      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        role: 'assistant',
        content: 'Hello integration',
        user_id: 'u-integration'
      }));

      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Hello integration',
        user_id: 'u-integration',
        outreach_type: 'proactive'
      }));
    });
  });
});
