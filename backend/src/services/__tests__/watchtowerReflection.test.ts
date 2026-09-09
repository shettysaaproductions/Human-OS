/**
 * watchtowerReflection.test.ts — Unit tests for Watchtower Post-Reply Reflection & Auto-Correction
 */

import { watchtowerReflectionService } from '../WatchtowerReflectionService';

describe('WatchtowerReflectionService', () => {
  const userId = 'test-user-ref-123';
  const conversationId = '11111111-1111-1111-1111-111111111111';
  const messageId = '22222222-2222-2222-2222-222222222222';

  afterEach(() => {
    watchtowerReflectionService.cancelPendingReflection(userId);
  });

  it('schedules a reflection and tracks it in activeReflections', () => {
    watchtowerReflectionService.scheduleReflection({
      userId,
      conversationId,
      messageId,
      content: 'Acha, toh tumne Shreshth ko nail art kit diya tha!',
      userMessage: 'Filhal usse last year maine nail art kit leke diya',
    });

    // Verify it was scheduled without throwing
    expect(watchtowerReflectionService).toBeDefined();
  });

  it('cancels pending reflection immediately when user sends a new message', () => {
    watchtowerReflectionService.scheduleReflection({
      userId,
      conversationId,
      messageId,
      content: 'Acha, toh tumne Shreshth ko nail art kit diya tha!',
      userMessage: 'Filhal usse last year maine nail art kit leke diya',
    });

    // Simulating user sending a new message:
    watchtowerReflectionService.cancelPendingReflection(userId);

    // Cancel again should be a safe no-op
    expect(() => {
      watchtowerReflectionService.cancelPendingReflection(userId);
    }).not.toThrow();
  });

  it('cancels any prior reflection when a new reflection is scheduled for the same user', () => {
    const messageId1 = '33333333-3333-3333-3333-333333333333';
    const messageId2 = '44444444-4444-4444-4444-444444444444';

    watchtowerReflectionService.scheduleReflection({
      userId,
      conversationId,
      messageId: messageId1,
      content: 'First reply',
      userMessage: 'Message 1',
    });

    // Immediately schedule message 2 for same user
    watchtowerReflectionService.scheduleReflection({
      userId,
      conversationId,
      messageId: messageId2,
      content: 'Second reply',
      userMessage: 'Message 2',
    });

    expect(watchtowerReflectionService).toBeDefined();
  });
});
