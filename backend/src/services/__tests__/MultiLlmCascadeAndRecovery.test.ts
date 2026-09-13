import { instantFallbackRecoveryService } from '../InstantFallbackRecoveryService';
import { supabaseAdmin } from '../../lib/supabase';
import { saveAssistantMessage } from '../ChatHistoryHelpers';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import { complete as nvidiaComplete } from '../../lib/nvidia';
import { geminiComplete } from '../../lib/gemini';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../ChatHistoryHelpers', () => ({
  saveAssistantMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/pushNotifications', () => ({
  sendNovaReplyNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn(),
  stream: jest.fn(),
  determineUserProfile: jest.fn(() => 'USER_FAST'),
}));

jest.mock('../../lib/gemini', () => ({
  geminiComplete: jest.fn(),
  geminiStream: jest.fn(),
  getGeminiStatus: jest.fn(() => ({ configured: true })),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Multi-LLM Cascade & Autonomous Upfront Recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. triggers upfront self-healing recovery and persists a real response when fallback reply is detected', async () => {
    // Mock Supabase queries:
    // First query: latest chat_history has the fallback message
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [{ id: 'msg_fallback', role: 'assistant', content: 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.' }],
      error: null,
    });
    const mockMaybeSingle = jest.fn().mockResolvedValue({
      data: { push_token: 'mock-expo-push-token' },
      error: null,
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
          limit: mockLimit,
        };
      }
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: mockMaybeSingle,
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    // Mock alternative LLM from pool (NVIDIA Cerebellum) returning warm conversational answer
    (nvidiaComplete as jest.Mock).mockResolvedValueOnce(
      'Achha, toh Sushant aur Ijaz ke saath kabhi kabhi smoke karte ho! Bas dhyan rakhna habit na ban jaye, baaki sab badhiya?'
    );

    await instantFallbackRecoveryService.executeRecovery({
      userId: 'user-123',
      conversationId: 'conv-456',
      userMessageText: 'Bas bata raha tha tumhe, mai sushant ya ijaz ke sath kabhi kabhi smoke karta hu',
      replyToId: 'user_msg_1',
      failedProvider: 'gemini',
    });

    // Verify alternative LLM was called
    expect(nvidiaComplete).toHaveBeenCalledWith(
      'PROACTIVE',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('smoke karta hu') }),
      ]),
      expect.objectContaining({ timeoutMs: 4500 })
    );

    // Verify real reply was saved
    expect(saveAssistantMessage).toHaveBeenCalledWith(
      'user-123',
      'conv-456',
      expect.stringContaining('Achha, toh Sushant aur Ijaz ke saath'),
      'InstantSelfHeal',
      'user_msg_1',
      { sourceType: 'conversational' }
    );

    // Verify push notification was sent
    expect(sendNovaReplyNotification).toHaveBeenCalledWith(
      'mock-expo-push-token',
      expect.stringContaining('Achha, toh Sushant aur Ijaz')
    );
  });

  it('2. falls back to Gemini reserve if NVIDIA recovery fails', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [{ id: 'msg_fallback', role: 'assistant', content: 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.' }],
      error: null,
    });
    const mockMaybeSingle = jest.fn().mockResolvedValue({
      data: { push_token: 'mock-expo-push-token' },
      error: null,
    });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: mockSelect,
          eq: mockEq,
          order: mockOrder,
          limit: mockLimit,
        };
      }
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: mockMaybeSingle,
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    // NVIDIA fails
    (nvidiaComplete as jest.Mock).mockRejectedValueOnce(new Error('NVIDIA 503 Overload'));
    // Gemini reserve succeeds
    (geminiComplete as jest.Mock).mockResolvedValueOnce(
      'Maine sun liya! Dhyan rakhna apna yaar, jyada mat kiya karo.'
    );

    await instantFallbackRecoveryService.executeRecovery({
      userId: 'user-789',
      conversationId: 'conv-999',
      userMessageText: 'Maine smoke kiya',
      failedProvider: 'gemini',
    });

    expect(geminiComplete).toHaveBeenCalled();
    expect(saveAssistantMessage).toHaveBeenCalledWith(
      'user-789',
      'conv-999',
      expect.stringContaining('Maine sun liya!'),
      'InstantSelfHeal',
      undefined,
      { sourceType: 'conversational' }
    );
  });

  it('3. skips recovery if a real assistant message is already present in chat_history', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            // Already replied with real message
            data: [{ id: 'msg_real', role: 'assistant', content: 'Haan main sun rahi hoon!' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    await instantFallbackRecoveryService.executeRecovery({
      userId: 'user-already-replied',
      conversationId: 'conv-already-replied',
      userMessageText: 'Hello',
    });

    // Should NOT call any LLM or save any assistant message
    expect(nvidiaComplete).not.toHaveBeenCalled();
    expect(geminiComplete).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
  });
});
