import { NovaTriggerEngine } from '../NovaTriggerEngine';
import { supabaseAdmin } from '../../lib/supabase';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import { logger } from '../../lib/logger';

// Mock dependencies
jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

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

  const getBaseContext = () => ({
    userPresence: 'online' as const,
    lastUserMessageAt: Date.now() - 60000,
    lastNovaReplyAt: Date.now() - 120000,
    conversationIntensity: 'focused' as const,
    userActivity: null,
    pendingReminders: 0,
    emotionalState: {}
  });

  describe('Deduplication Cache', () => {
    it('Should block exact-duplicate message within 10 min window', async () => {
      const messageGenerator = jest.fn().mockResolvedValue('Hello!');
      const userId = 'user-1';

      // First run
      await engine.scheduleMessage(userId, getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve(); // flush microtasks

      // Second run with same content
      await engine.scheduleMessage(userId, getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve();

      // messageGenerator should be called twice, but push/db only once
      expect(messageGenerator).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(`[TriggerEngine] Deduplicated exact message for ${userId}`);
    });

    it('Should allow same message after 10-min window expires', async () => {
      const messageGenerator = jest.fn().mockResolvedValue('Hello!');
      const userId = 'user-1';

      await engine.scheduleMessage(userId, getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve();

      // Advance time by 11 mins
      jest.advanceTimersByTime(11 * 60 * 1000);

      await engine.scheduleMessage(userId, getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve();

      expect(messageGenerator).toHaveBeenCalledTimes(2);
      expect(logger.info).not.toHaveBeenCalledWith(`[TriggerEngine] Deduplicated exact message for ${userId}`);
    });

    it('Should track dedupe cache per-user (isolated by userId)', async () => {
      const messageGenerator = jest.fn().mockResolvedValue('Hello!');
      
      await engine.scheduleMessage('user-1', getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve();

      await engine.scheduleMessage('user-2', getBaseContext(), messageGenerator);
      jest.runAllTimers();
      await Promise.resolve();

      expect(messageGenerator).toHaveBeenCalledTimes(2);
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Deduplicated exact message'));
    });
  });

  describe('Rate Limiting', () => {
    it('Should allow requests under 30/min ceiling', async () => {
      let result;
      for (let i = 0; i < 30; i++) {
        result = await engine.shouldTrigger(getBaseContext());
        expect(result.shouldSend).toBe(true);
      }
    });

    it('Should block requests at 31st request within 1 minute', async () => {
      for (let i = 0; i < 30; i++) {
        await engine.shouldTrigger(getBaseContext());
      }
      const result = await engine.shouldTrigger(getBaseContext());
      expect(result.shouldSend).toBe(false);
      expect(result.reason).toBe('rate_limited');
    });

    it('Should reset rate limit after 1 minute', async () => {
      for (let i = 0; i < 30; i++) {
        await engine.shouldTrigger(getBaseContext());
      }
      
      jest.advanceTimersByTime(61000);
      
      const result = await engine.shouldTrigger(getBaseContext());
      expect(result.shouldSend).toBe(true);
    });
  });

  describe('Presence-Based Timing', () => {
    it('typing: delay 2000-8000ms', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'typing' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(2000);
      expect(delayMs).toBeLessThanOrEqual(8000); // 8000 * 1 = 8000 (casual = 0.7, deep = 1.5, focused = 1)
    });

    it('online: delay 5000-25000ms', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'online' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(5000);
      expect(delayMs).toBeLessThanOrEqual(25000);
    });

    it('away: delay 30000-120000ms', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'away' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(30000);
      expect(delayMs).toBeLessThanOrEqual(120000);
    });

    it('offline: delay 300000-900000ms', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'offline' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(300000);
      expect(delayMs).toBeLessThanOrEqual(900000);
    });
  });

  describe('Urgency Override', () => {
    it('offline + pendingReminders > 0 -> shouldSend=true, delayMs=60000', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'offline' as const, pendingReminders: 1 };
      const { shouldSend, delayMs, reason } = await engine.shouldTrigger(ctx);
      expect(shouldSend).toBe(true);
      expect(delayMs).toBe(60000);
      expect(reason).toBe('urgent_offline');
    });

    it('offline + emotionalState.crisisDetected -> shouldSend=true, delayMs=60000', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'offline' as const, emotionalState: { crisisDetected: true } };
      const { shouldSend, delayMs, reason } = await engine.shouldTrigger(ctx);
      expect(shouldSend).toBe(true);
      expect(delayMs).toBe(60000);
      expect(reason).toBe('urgent_offline');
    });

    it('offline + no urgency -> normal offline delay', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'offline' as const };
      const { shouldSend, delayMs } = await engine.shouldTrigger(ctx);
      expect(shouldSend).toBe(true);
      expect(delayMs).toBeGreaterThanOrEqual(300000);
    });
  });

  describe('Conversation Intensity', () => {
    it('deep -> 1.5x slower delay', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'typing' as const, conversationIntensity: 'deep' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(2000 * 1.5);
      expect(delayMs).toBeLessThanOrEqual(8000 * 1.5);
    });

    it('casual -> 0.7x faster delay', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'typing' as const, conversationIntensity: 'casual' as const };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual(2000 * 0.7);
      expect(delayMs).toBeLessThanOrEqual(8000 * 0.7);
    });

    it('user message <3s ago -> add 5000ms buffer', async () => {
      const ctx = { ...getBaseContext(), userPresence: 'typing' as const, lastUserMessageAt: Date.now() - 1000 };
      const { delayMs } = await engine.shouldTrigger(ctx);
      expect(delayMs).toBeGreaterThanOrEqual((2000 * 1) + 5000);
    });
  });

  describe('analyzeConversationIntensity', () => {
    let mockSelect: jest.Mock;
    
    beforeEach(() => {
      mockSelect = jest.fn();
      const mockOrder = jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: null }) });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: mockSelect.mockReturnValue({ eq: mockEq }) });
    });

    it('no messages -> casual', async () => {
      const intensity = await engine.analyzeConversationIntensity('user-1');
      expect(intensity).toBe('casual');
    });

    it('avgLength <80 -> casual', async () => {
      const mockOrder = jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [{content: 'hi'}, {content: 'hello'}] }) });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: mockOrder }) }) });
      const intensity = await engine.analyzeConversationIntensity('user-1');
      expect(intensity).toBe('casual');
    });

    it('avgLength 80-200 -> focused', async () => {
      const longMsg = 'a'.repeat(100);
      const mockOrder = jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [{content: longMsg}] }) });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: mockOrder }) }) });
      const intensity = await engine.analyzeConversationIntensity('user-1');
      expect(intensity).toBe('focused');
    });

    it('avgLength >200 -> deep', async () => {
      const longMsg = 'a'.repeat(250);
      const mockOrder = jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [{content: longMsg}] }) });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: mockOrder }) }) });
      const intensity = await engine.analyzeConversationIntensity('user-1');
      expect(intensity).toBe('deep');
    });
  });

  describe('scheduleMessage integration', () => {
    it('Cancels existing scheduled message for same user', async () => {
      const messageGenerator = jest.fn().mockResolvedValue('Hello!');
      await engine.scheduleMessage('user-1', getBaseContext(), messageGenerator);
      await engine.scheduleMessage('user-1', getBaseContext(), messageGenerator);
      
      jest.runAllTimers();
      await Promise.resolve();
      
      // Should only generate message once because the first one was cancelled
      expect(messageGenerator).toHaveBeenCalledTimes(1);
    });

    it('Saves to chat_history and outreach_log and Sends push notification if token exists', async () => {
      const mockSelectPushToken = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { push_token: 'token-123' } }) }) });
      const mockSelectChat = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { conversation_id: 'conv-123' } }) }) }) }) });
      const mockInsert = jest.fn().mockResolvedValue({});
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profiles') return { select: mockSelectPushToken };
        if (table === 'chat_history') return { select: mockSelectChat, insert: mockInsert };
        if (table === 'nova_outreach_log') return { insert: mockInsert };
        return {};
      });

      const messageGenerator = jest.fn().mockResolvedValue('Integration Message!');
      await engine.scheduleMessage('user-1', getBaseContext(), messageGenerator);
      
      jest.runAllTimers();
      // Flush microtask queue completely so all async awaits inside the timeout resolve
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      expect(sendNovaReplyNotification).toHaveBeenCalledWith('token-123', 'Integration Message!');
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        content: 'Integration Message!',
        role: 'assistant'
      }));
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        message: 'Integration Message!',
        type: 'proactive'
      }));
    });
  });
});
