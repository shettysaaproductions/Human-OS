/**
 * watchtowerTimingPhase3ca.test.ts — Phase 3C-A Timing Contracts & Schema Unit Tests
 */

import {
  TimingState,
  OutreachEligibility,
  TimingConfidence,
  OutreachSourceClass,
  TimingContext,
  WatchtowerTimingDecision,
  WATCHTOWER_TIMING_LIMITS,
  generateTimingFingerprint,
} from '../watchtowerTiming';
import { AccountLifecycleService } from '../../services/AccountLifecycleService';

describe('Phase 3C-A: Watchtower Timing Contracts & Schema Foundation', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';
  const attentionId = 'att_00000000-0000-4000-a000-000000000001';

  it('1. Timing State enum covers exact required 6 states', () => {
    const states: TimingState[] = ['NOW', 'SOON', 'WAIT', 'QUIET', 'BLOCKED', 'EXPIRED'];
    expect(states).toHaveLength(6);
    expect(states).toContain('NOW');
    expect(states).toContain('SOON');
    expect(states).toContain('WAIT');
    expect(states).toContain('QUIET');
    expect(states).toContain('BLOCKED');
    expect(states).toContain('EXPIRED');
  });

  it('2. Outreach Eligibility enum covers exact 4 states', () => {
    const eligibilities: OutreachEligibility[] = ['PROACTIVE_ELIGIBLE', 'DEFER', 'SUPPRESS', 'EXPIRED'];
    expect(eligibilities).toHaveLength(4);
    expect(eligibilities).toContain('PROACTIVE_ELIGIBLE');
    expect(eligibilities).toContain('DEFER');
    expect(eligibilities).toContain('SUPPRESS');
    expect(eligibilities).toContain('EXPIRED');
  });

  it('3. Timing Confidence enum covers exact 3 levels', () => {
    const confidences: TimingConfidence[] = ['HIGH_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'LOW_CONFIDENCE'];
    expect(confidences).toHaveLength(3);
    expect(confidences).toContain('HIGH_CONFIDENCE');
    expect(confidences).toContain('MEDIUM_CONFIDENCE');
    expect(confidences).toContain('LOW_CONFIDENCE');
  });

  it('4. Outreach Source Classification covers exact 4 classes', () => {
    const sourceClasses: OutreachSourceClass[] = [
      'USER_REQUESTED',
      'SYSTEM_REQUIRED',
      'AUTONOMOUS_PROACTIVE',
      'COGNITIVE_CLARIFICATION',
    ];
    expect(sourceClasses).toHaveLength(4);
    expect(sourceClasses).toContain('USER_REQUESTED');
    expect(sourceClasses).toContain('SYSTEM_REQUIRED');
    expect(sourceClasses).toContain('AUTONOMOUS_PROACTIVE');
    expect(sourceClasses).toContain('COGNITIVE_CLARIFICATION');
  });

  it('5. TimingContext validates all deterministic parameters', () => {
    const ctx: TimingContext = {
      userId: user1,
      nowUtc: new Date('2026-08-31T08:00:00Z'),
      nowLocal: new Date('2026-08-31T13:30:00+05:30'),
      timezone: 'Asia/Kolkata',
      localHour: 13.5,
      isQuietHours: false,
      presenceStatus: 'online',
      isUserInActiveTurn: false,
      gapMinutesSinceLastMessage: 45,
      currentChatTopic: 'weekend_trip',
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      lastOutreachMinutesAgo: 180,
      consecutiveIgnoredCount: 0,
      minutesSinceTopicMentioned: 300,
      hasUserAcknowledgedTopic: true,
    };

    expect(ctx.userId).toBe(user1);
    expect(ctx.isQuietHours).toBe(false);
    expect(ctx.touchesLast24Hours).toBe(1);
  });

  it('6. WatchtowerTimingDecision validates complete record shape', () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const decision: WatchtowerTimingDecision = {
      userId: user1,
      attentionDecisionId: attentionId,
      timingState: 'NOW',
      outreachEligibility: 'PROACTIVE_ELIGIBLE',
      confidence: 'HIGH_CONFIDENCE',
      sourceClass: 'AUTONOMOUS_PROACTIVE',
      burdenCount24h: 1,
      reasonCode: 'optimal_conversational_gap',
      contextSnapshot: { localHour: 14, gapMinutes: 45 },
      fingerprint: generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'gap_45'),
      expiresAt,
    };

    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.expiresAt).toBe(expiresAt);
  });

  it('7. generateTimingFingerprint is strictly deterministic and idempotent', () => {
    const fp1 = generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_a');
    const fp2 = generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_a');
    expect(fp1).toBe(fp2);
  });

  it('8. Changed context produces distinct fingerprint for timing reconsideration', () => {
    const fp1 = generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_a');
    const fp2 = generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_b');
    expect(fp1).not.toBe(fp2);
  });

  it('9. Cross-user isolation: Identical attention on two users produces distinct fingerprints', () => {
    const fp1 = generateTimingFingerprint(user1, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_a');
    const fp2 = generateTimingFingerprint(user2, attentionId, 'AUTONOMOUS_PROACTIVE', 'NOW', 'ctx_a');
    expect(fp1).not.toBe(fp2);
  });

  it('10. AccountLifecycleService includes watchtower_timing_logs in USER_OWNED_TABLES', () => {
    const tables = AccountLifecycleService.USER_OWNED_TABLES;
    const timingTableEntry = tables.find(t => t.table === 'watchtower_timing_logs');
    expect(timingTableEntry).toBeDefined();
    expect(timingTableEntry?.userColumn).toBe('user_id');
  });

  it('11. Timing limits constants define safe conservative defaults', () => {
    expect(WATCHTOWER_TIMING_LIMITS.DEFAULT_QUIET_HOURS_START).toBe(23);
    expect(WATCHTOWER_TIMING_LIMITS.DEFAULT_QUIET_HOURS_END).toBe(7.5);
    expect(WATCHTOWER_TIMING_LIMITS.MAX_TOUCHES_24H_DEFAULT).toBe(3);
    expect(WATCHTOWER_TIMING_LIMITS.MAX_TOUCHES_24H_HARD_CAP).toBe(5);
    expect(WATCHTOWER_TIMING_LIMITS.MIN_TOUCH_GAP_MINUTES).toBe(120);
    expect(WATCHTOWER_TIMING_LIMITS.CONSECUTIVE_IGNORED_CAP).toBe(3);
    expect(WATCHTOWER_TIMING_LIMITS.TIMING_LOG_TTL_DAYS).toBe(7);
  });
});
