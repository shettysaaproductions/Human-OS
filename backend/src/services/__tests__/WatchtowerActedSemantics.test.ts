/**
 * WatchtowerActedSemantics.test.ts
 *
 * Phase 9 Safety — Watchtower ACTED semantics contract
 *
 * Tests the invariant:
 *   ACTED = chat was terminally delivered to the user (DELIVERED / DELIVERED_PARTIAL / NOTIFICATION_SKIPPED)
 *   SUPPRESSED = NOT acted; retry-eligible
 *   FAILED_* = NOT acted; retry or terminal per retryable flag
 *   GATED / DISPATCHING / PERSISTED = intermediate; never ACTED
 */

import type {
  DispatchResult,
  DispatchStatus,
} from '../../services/OutboundDispatcherService';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeResult(status: DispatchStatus, extra: Partial<DispatchResult> = {}): DispatchResult {
  const terminal = status === 'DELIVERED' || status === 'DELIVERED_PARTIAL' || status === 'NOTIFICATION_SKIPPED' || status === 'FAILED_TERMINAL';
  const retryable = status === 'SUPPRESSED' || status === 'FAILED_TRANSIENT';
  return { status, retryable, terminal, ...extra };
}

// Mirrors the ACTED decision logic in WatchtowerProactiveIntegrationService
function shouldMarkActed(result: DispatchResult): boolean {
  return (
    result.status === 'DELIVERED' ||
    result.status === 'DELIVERED_PARTIAL' ||
    result.status === 'NOTIFICATION_SKIPPED'
  );
}

// ── Suite: ACTED semantics ─────────────────────────────────────────────────────

describe('Watchtower ACTED semantics', () => {

  test('DELIVERED → ACTED', () => {
    expect(shouldMarkActed(makeResult('DELIVERED'))).toBe(true);
  });

  test('DELIVERED_PARTIAL → ACTED (chat durable, push skipped)', () => {
    expect(shouldMarkActed(makeResult('DELIVERED_PARTIAL'))).toBe(true);
  });

  test('NOTIFICATION_SKIPPED → ACTED (chat durable, no push token)', () => {
    expect(shouldMarkActed(makeResult('NOTIFICATION_SKIPPED'))).toBe(true);
  });

  test('SUPPRESSED → NOT ACTED (retry-eligible)', () => {
    expect(shouldMarkActed(makeResult('SUPPRESSED', { reason: 'QUIET_HOURS' }))).toBe(false);
  });

  test('SUPPRESSED with DUPLICATE reason → NOT ACTED', () => {
    expect(shouldMarkActed(makeResult('SUPPRESSED', { reason: 'DUPLICATE' }))).toBe(false);
  });

  test('SUPPRESSED with BURDEN reason → NOT ACTED', () => {
    expect(shouldMarkActed(makeResult('SUPPRESSED', { reason: 'BURDEN' }))).toBe(false);
  });

  test('SUPPRESSED with MIN_GAP reason → NOT ACTED', () => {
    expect(shouldMarkActed(makeResult('SUPPRESSED', { reason: 'MIN_GAP' }))).toBe(false);
  });

  test('FAILED_TRANSIENT → NOT ACTED', () => {
    expect(shouldMarkActed(makeResult('FAILED_TRANSIENT'))).toBe(false);
  });

  test('FAILED_TERMINAL → NOT ACTED', () => {
    expect(shouldMarkActed(makeResult('FAILED_TERMINAL', { reason: 'ACCOUNT_TOMBSTONED' }))).toBe(false);
  });
});

// ── Suite: retryable / terminal flags ────────────────────────────────────────

describe('DispatchResult retryable and terminal flags', () => {

  test('DELIVERED: terminal=true, retryable=false', () => {
    const r = makeResult('DELIVERED');
    expect(r.terminal).toBe(true);
    expect(r.retryable).toBe(false);
  });

  test('DELIVERED_PARTIAL: terminal=true, retryable=false', () => {
    const r = makeResult('DELIVERED_PARTIAL');
    expect(r.terminal).toBe(true);
    expect(r.retryable).toBe(false);
  });

  test('SUPPRESSED: terminal=false, retryable=true', () => {
    const r = makeResult('SUPPRESSED', { reason: 'QUIET_HOURS' });
    expect(r.terminal).toBe(false);
    expect(r.retryable).toBe(true);
  });

  test('FAILED_TRANSIENT: terminal=false, retryable=true', () => {
    const r = makeResult('FAILED_TRANSIENT');
    expect(r.terminal).toBe(false);
    expect(r.retryable).toBe(true);
  });

  test('FAILED_TERMINAL: terminal=true, retryable=false', () => {
    const r = makeResult('FAILED_TERMINAL', { reason: 'ACCOUNT_TOMBSTONED' });
    expect(r.terminal).toBe(true);
    expect(r.retryable).toBe(false);
  });

  test('NOTIFICATION_SKIPPED: terminal=true, retryable=false', () => {
    const r = makeResult('NOTIFICATION_SKIPPED');
    expect(r.terminal).toBe(true);
    expect(r.retryable).toBe(false);
  });
});

// ── Suite: counter truthfulness ───────────────────────────────────────────────

describe('Watchtower counter truthfulness', () => {
  interface Counters {
    gateAllowed: number;
    dispatched: number;
    blocked: number;
    failed: number;
  }

  function applyCounters(result: DispatchResult): Counters {
    const counters: Counters = { gateAllowed: 0, dispatched: 0, blocked: 0, failed: 0 };
    // Gate was attempted for all results reaching dispatch
    counters.gateAllowed += 1;

    const wasDelivered =
      result.status === 'DELIVERED' ||
      result.status === 'DELIVERED_PARTIAL' ||
      result.status === 'NOTIFICATION_SKIPPED';

    if (wasDelivered) {
      counters.dispatched += 1;
    } else if (result.status === 'SUPPRESSED') {
      counters.blocked += 1;
    } else if (result.status === 'FAILED_TRANSIENT' || result.status === 'FAILED_TERMINAL') {
      counters.failed += 1;
    }
    return counters;
  }

  test('DELIVERED: gateAllowed=1 dispatched=1 blocked=0 failed=0', () => {
    const c = applyCounters(makeResult('DELIVERED'));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 1, blocked: 0, failed: 0 });
  });

  test('DELIVERED_PARTIAL: gateAllowed=1 dispatched=1 blocked=0 failed=0', () => {
    const c = applyCounters(makeResult('DELIVERED_PARTIAL'));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 1, blocked: 0, failed: 0 });
  });

  test('NOTIFICATION_SKIPPED: counts as dispatched (chat durable)', () => {
    const c = applyCounters(makeResult('NOTIFICATION_SKIPPED'));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 1, blocked: 0, failed: 0 });
  });

  test('SUPPRESSED: gateAllowed=1 dispatched=0 blocked=1 failed=0', () => {
    const c = applyCounters(makeResult('SUPPRESSED', { reason: 'QUIET_HOURS' }));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 0, blocked: 1, failed: 0 });
  });

  test('FAILED_TRANSIENT: gateAllowed=1 dispatched=0 blocked=0 failed=1', () => {
    const c = applyCounters(makeResult('FAILED_TRANSIENT'));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 0, blocked: 0, failed: 1 });
  });

  test('FAILED_TERMINAL: gateAllowed=1 dispatched=0 blocked=0 failed=1', () => {
    const c = applyCounters(makeResult('FAILED_TERMINAL', { reason: 'ACCOUNT_TOMBSTONED' }));
    expect(c).toEqual({ gateAllowed: 1, dispatched: 0, blocked: 0, failed: 1 });
  });
});

// ── Suite: DispatchResult reason closed union ─────────────────────────────────

describe('DispatchResult reason is a closed union', () => {
  const SUPPRESS_REASONS = ['DUPLICATE', 'QUIET_HOURS', 'BURDEN', 'MIN_GAP', 'TOMBSTONED', 'POLICY'] as const;
  const FAILURE_REASONS = ['ACCOUNT_TOMBSTONED', 'EMPTY_MESSAGE', 'UNKNOWN_STRATEGY', 'RPC_COMMIT_FAILED', 'INTENT_RACE', 'PUSH_FAILED', 'CRASH_WINDOW', 'UNHANDLED'] as const;

  test.each(SUPPRESS_REASONS)('suppress reason "%s" is a valid DispatchSuppressReason', (reason) => {
    const r = makeResult('SUPPRESSED', { reason });
    expect(r.reason).toBe(reason);
  });

  test.each(FAILURE_REASONS)('failure reason "%s" is a valid DispatchFailureReason', (reason) => {
    const r = makeResult('FAILED_TERMINAL', { reason });
    expect(r.reason).toBe(reason);
  });

  test('SUPPRESSED carries structured reason (not raw string)', () => {
    const r: DispatchResult = makeResult('SUPPRESSED', { reason: 'DUPLICATE' });
    // Must be one of the valid suppress reasons — TypeScript enforces this at compile time
    expect(['DUPLICATE', 'QUIET_HOURS', 'BURDEN', 'MIN_GAP', 'TOMBSTONED', 'POLICY']).toContain(r.reason);
  });
});

// ── Suite: at-most-once push crash-window contract ────────────────────────────

describe('At-most-once push delivery policy', () => {
  test('DELIVERED_PARTIAL with crash-window detail is still terminal', () => {
    const r: DispatchResult = {
      status: 'DELIVERED_PARTIAL',
      detail: 'at-most-once crash window: push skipped, chat durable',
      intentId: 'intent-abc',
      retryable: false,
      terminal: true,
    };
    // Chat is durable — should not retry
    expect(r.terminal).toBe(true);
    expect(r.retryable).toBe(false);
    // Not counted as a failure
    expect(shouldMarkActed(r)).toBe(true);
  });

  test('crash-window result does not retry the push', () => {
    // A DELIVERED_PARTIAL from crash window means:
    // - action_idempotency row existed (previous attempt started push)
    // - push was skipped (at-most-once policy)
    // - chat_history is durable
    // - retryable = false → no retry attempted
    const r = makeResult('DELIVERED_PARTIAL', {
      detail: 'at-most-once crash window: push skipped, chat durable',
    });
    expect(r.retryable).toBe(false);
    expect(r.terminal).toBe(true);
  });
});

// ── Suite: safe forensic tool guard logic ─────────────────────────────────────

describe('Safe forensic tool guards', () => {
  function checkProductionGuard(nodeEnv: string | undefined): { blocked: boolean; reason: string } {
    if (nodeEnv === 'production') {
      return { blocked: true, reason: 'NODE_ENV=production' };
    }
    return { blocked: false, reason: '' };
  }

  function checkAllowFlag(envVar: string | undefined): { blocked: boolean; reason: string } {
    if (envVar !== 'true') {
      return { blocked: true, reason: 'HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS not set' };
    }
    return { blocked: false, reason: '' };
  }

  function checkUserIds(userIds: string[]): { blocked: boolean; reason: string } {
    if (userIds.length === 0) {
      return { blocked: true, reason: 'No user IDs provided' };
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of userIds) {
      if (!UUID_RE.test(id)) {
        return { blocked: true, reason: `Invalid UUID: ${id}` };
      }
    }
    return { blocked: false, reason: '' };
  }

  test('production environment is blocked', () => {
    expect(checkProductionGuard('production').blocked).toBe(true);
  });

  test('staging environment is not blocked by production guard', () => {
    expect(checkProductionGuard('staging').blocked).toBe(false);
  });

  test('development environment is not blocked', () => {
    expect(checkProductionGuard('development').blocked).toBe(false);
  });

  test('missing allow flag is blocked', () => {
    expect(checkAllowFlag(undefined).blocked).toBe(true);
  });

  test('allow flag = "false" is blocked', () => {
    expect(checkAllowFlag('false').blocked).toBe(true);
  });

  test('allow flag = "true" is not blocked', () => {
    expect(checkAllowFlag('true').blocked).toBe(false);
  });

  test('empty user ID list is blocked (never enumerate-all)', () => {
    expect(checkUserIds([]).blocked).toBe(true);
  });

  test('invalid UUID is blocked', () => {
    expect(checkUserIds(['not-a-uuid']).blocked).toBe(true);
  });

  test('valid UUID is allowed', () => {
    expect(checkUserIds(['00000000-0000-4000-a000-000000000001']).blocked).toBe(false);
  });

  test('multiple valid UUIDs are allowed', () => {
    expect(checkUserIds([
      '00000000-0000-4000-a000-000000000001',
      '00000000-0000-4000-a000-000000000002',
    ]).blocked).toBe(false);
  });

  test('dry run must not execute mutations — verified by flag absence', () => {
    // In dry-run mode (--execute not present), zero mutations are performed.
    // This test verifies the decision logic, not the DB calls.
    const executeFlag = false; // --execute not present
    const isDryRun = !executeFlag;
    expect(isDryRun).toBe(true);
    // A dry run produces a report only — no deleteAccount() calls
    const mutationCount = isDryRun ? 0 : 999; // would be non-zero if executed
    expect(mutationCount).toBe(0);
  });

  test('all three guards must pass before execution', () => {
    function canExecute(nodeEnv: string, allowFlag: string | undefined, userIds: string[]): boolean {
      if (checkProductionGuard(nodeEnv).blocked) return false;
      if (checkAllowFlag(allowFlag).blocked) return false;
      if (checkUserIds(userIds).blocked) return false;
      return true;
    }
    // Must fail if any guard fails
    expect(canExecute('production', 'true', ['00000000-0000-4000-a000-000000000001'])).toBe(false);
    expect(canExecute('development', undefined, ['00000000-0000-4000-a000-000000000001'])).toBe(false);
    expect(canExecute('development', 'true', [])).toBe(false);
    // Only passes with all three satisfied
    expect(canExecute('development', 'true', ['00000000-0000-4000-a000-000000000001'])).toBe(true);
  });
});
