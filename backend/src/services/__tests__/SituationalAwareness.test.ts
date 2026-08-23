import { SituationalAwareness } from '../SituationalAwareness';

/**
 * Regression tests for the timezone handling in SituationalAwareness.
 *
 * chat.ts constructs `nowLocal` by shifting an instant by the user's tzOffset
 * (e.g. `new Date(Date.now() + tzOffset * 3600 * 1000)`), then reads the
 * shifted clock with `getUTCHours()` / `getUTC*`. The situational-awareness
 * methods receive that SAME shifted `nowLocal`, so they must ALSO read it via
 * the UTC getters â€” otherwise they fall back to server-local time and
 * completely negate the timezone offset.
 *
 * The assertion strategy: these methods must agree with `nowLocal.getUTCHours()`,
 * the canonical user-local hour. A naive `getHours()` implementation would diverge
 * wherever the server TZ differs from the instant's UTC hour.
 */

// Cast to expose buildBrief (the public entry point) so we can exercise the
// sleep-window AND the time-bucket logic through the same path the pipeline uses.
const sa = new SituationalAwareness() as unknown as {
  buildBrief(ctx: Record<string, unknown>): string;
};

function makeNow(hourUTCs: number): { base: Date; userLocal: Date } {
  // base instant at the requested UTC hour, minute 0.
  const base = new Date(Date.UTC(2026, 7, 14, hourUTCs, 0, 0, 0));
  // Simulate an Indian user (+5.5h): the shifted clock is base + 5.5h.
  const userLocal = new Date(base.getTime() + 5.5 * 3600 * 1000);
  return { base, userLocal };
}

describe('SituationalAwareness timezone handling', () => {
  test('getTimeOfDay reflects the user-local (UTC read) hour, not server hour', () => {
    // base is 10:00 UTC... but the SHIFTED nowLocal for this sample is
    // whatever its getUTCHours() yields â€” compute canonical expectation.
    const { userLocal } = makeNow(10);
    const h = userLocal.getUTCHours();
    const expected =
      h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Late Night';

    const brief = sa.buildBrief({
      nowLocal: userLocal, dayName: 'Friday', dateStr: '2026-08-14',
      timeStr: '', tzLabel: 'IST', country: 'IN', gapMinutes: null,
      latestEmotion: null, recentEpisodes: [], latestReflection: null,
      isWeekend: false,
    });
    expect(brief).toContain(`Time of day: ${expected}`);
  });

  test('SLEEP WINDOW scolding uses the user-local hour', () => {
    // base 20:00 UTC, shifted +5.5h â†’ user local 01:30 â†’ inside 1â€“4 AM window.
    const { userLocal } = makeNow(20);
    expect(userLocal.getUTCHours()).toBeGreaterThanOrEqual(1);
    expect(userLocal.getUTCHours()).toBeLessThanOrEqual(4);

    const brief = sa.buildBrief({
      nowLocal: userLocal, dayName: 'Friday', dateStr: '2026-08-14',
      timeStr: '', tzLabel: 'IST', country: 'IN', gapMinutes: null,
      latestEmotion: null, recentEpisodes: [], latestReflection: null,
      isWeekend: false,
    });
    expect(brief).toContain('SLEEP WINDOW SCOLDING');
  });

  test('greeting strategy is chosen from the user-local hour', () => {
    // base 06:00 UTC, shifted +5.5h â†’ user local 11:30 â†’ "Morning" bucket (5â€“12).
    const { userLocal } = makeNow(6);
    const h = userLocal.getUTCHours();
    expect(h).toBeGreaterThanOrEqual(5);
    expect(h).toBeLessThan(12);

    const brief = sa.buildBrief({
      nowLocal: userLocal, dayName: 'Friday', dateStr: '2026-08-14',
      timeStr: '', tzLabel: 'IST', country: 'IN', gapMinutes: 180,
      latestEmotion: null, recentEpisodes: [], latestReflection: null,
      isWeekend: false,
    });
    // 180 min gap + morning â†’ the morning greeting branch (after the <120 branch).
    expect(brief).toContain('good morning');
  });
});
