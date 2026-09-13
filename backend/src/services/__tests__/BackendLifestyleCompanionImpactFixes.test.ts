import { situationalAwareness } from '../SituationalAwareness';
import { PromptBuilder } from '../promptBuilder';
import { actionIntelligenceService } from '../ActionIntelligenceService';
import { contextualTimingEngine } from '../ContextualTimingEngine';

describe('Backend Lifestyle Companion & High-Impact Reliability Fixes', () => {
  describe('1. SituationalAwareness: UTC Presence & Jarvis Reminder Timestamp Alignment', () => {
    it('does NOT falsely mark an active user as AWAY or stale in IST timezone', () => {
      const nowUtc = new Date();
      // Shifted local time for IST (+5.5h)
      const nowLocal = new Date(nowUtc.getTime() + 5.5 * 3600 * 1000);
      // User was active 30 seconds ago in UTC
      const lastActiveAt = new Date(nowUtc.getTime() - 30 * 1000).toISOString();

      const brief = situationalAwareness.buildBrief({
        nowLocal,
        nowUtc,
        tzLabel: 'IST',
        country: 'IN',
        gapMinutes: 1,
        latestEmotion: null,
        recentEpisodes: [],
        latestReflection: null,
        isWeekend: false,
        dayName: 'Friday',
        dateStr: '2026-09-13',
        timeStr: '10:00 AM',
        userPresence: {
          status: 'online',
          last_active_at: lastActiveAt,
        },
      });

      // Must report ONLINE right now, not away or stale corrected
      expect(brief).toContain('USER PRESENCE: ONLINE right now');
      expect(brief).not.toContain('stale status corrected');
      expect(brief).not.toContain('5h ago');
    });

    it('correctly detects genuine ghost presence when inactive for > 5 minutes', () => {
      const nowUtc = new Date();
      const nowLocal = new Date(nowUtc.getTime() + 5.5 * 3600 * 1000);
      // User was last active 15 minutes ago
      const lastActiveAt = new Date(nowUtc.getTime() - 15 * 60 * 1000).toISOString();

      const brief = situationalAwareness.buildBrief({
        nowLocal,
        nowUtc,
        tzLabel: 'IST',
        country: 'IN',
        gapMinutes: 15,
        latestEmotion: null,
        recentEpisodes: [],
        latestReflection: null,
        isWeekend: false,
        dayName: 'Friday',
        dateStr: '2026-09-13',
        timeStr: '10:00 AM',
        userPresence: {
          status: 'online', // Stale stored status
          last_active_at: lastActiveAt,
        },
      });

      expect(brief).toContain('stale status corrected');
      expect(brief).toContain('AWAY (stepped away, checked recently)');
    });

    it('triggers Jarvis Reminder Mode for upcoming reminders in next 2 hours with shifted local clock', () => {
      const nowUtc = new Date();
      const nowLocal = new Date(nowUtc.getTime() + 5.5 * 3600 * 1000);
      // Reminder is 45 minutes in the future (UTC)
      const reminderTriggerAt = new Date(nowUtc.getTime() + 45 * 60 * 1000).toISOString();

      const brief = situationalAwareness.buildBrief({
        nowLocal,
        nowUtc,
        tzLabel: 'IST',
        country: 'IN',
        gapMinutes: 2,
        latestEmotion: null,
        recentEpisodes: [],
        latestReflection: null,
        isWeekend: false,
        dayName: 'Friday',
        dateStr: '2026-09-13',
        timeStr: '10:00 AM',
        upcomingReminders: [
          { title: 'Drink water & stretch', trigger_at: reminderTriggerAt },
        ],
      });

      expect(brief).toContain('JARVIS MODE: These reminders are coming up in the next 2 hours: Drink water & stretch');
    });
  });

  describe('2. PromptBuilder: English Voice Guide vs Hinglish Separation', () => {
    const promptBuilder = new PromptBuilder();

    it('injects English Voice Guide for preferredLanguage === "en"', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'BASE PROMPT',
        [],
        [],
        'Alex',
        'friendly',
        [],
        'en'
      );

      expect(prompt).toContain('## 💬 ENGLISH VOICE GUIDE');
      expect(prompt).not.toContain('## 💬 HINGLISH VOICE GUIDE');
      expect(prompt).not.toContain('STRICTLY FORBIDDEN:\n- Formal Hindi');
      expect(prompt).not.toContain('Pure Hindi sentences OR pure English sentences — ALWAYS blend them');
      expect(prompt).toContain('Nova speaks like a sharp, warm, witty companion texting a close friend');
    });

    it('injects Hinglish Voice Guide for preferredLanguage === "auto" or "hi"', () => {
      const promptAuto = promptBuilder.buildSystemPrompt(
        'BASE PROMPT',
        [],
        [],
        'Rahul',
        'friendly',
        [],
        'auto'
      );

      expect(promptAuto).toContain('## 💬 HINGLISH VOICE GUIDE');
      expect(promptAuto).not.toContain('## 💬 ENGLISH VOICE GUIDE');
      expect(promptAuto).toContain('STRICTLY FORBIDDEN:\n- Formal Hindi');
    });
  });

  describe('3. ActionIntelligenceService: Blocked Action Suppression', () => {
    it('does not select a blocked action as NEXT_BEST_ACTION even if it has no dependencies', async () => {
      const actions = [
        {
          id: 'action_1',
          source_thread_id: 'thread_1',
          title: 'Blocked Action',
          logical_key: 'blocked_key',
          state: 'blocked' as const,
          priority: 'high' as const,
          execution_class: 'manual' as const,
          dependency_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const result = await actionIntelligenceService.getNextBestAction('user_123', 'thread_1', actions);
      expect(result.type).toBe('NO_ACTION');
    });

    it('selects ready suggested action as NEXT_BEST_ACTION', async () => {
      const actions = [
        {
          id: 'action_1',
          source_thread_id: 'thread_1',
          title: 'Blocked Action',
          logical_key: 'blocked_key',
          state: 'blocked' as const,
          priority: 'high' as const,
          execution_class: 'manual' as const,
          dependency_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'action_2',
          source_thread_id: 'thread_1',
          title: 'Ready Action',
          logical_key: 'ready_key',
          state: 'suggested' as const,
          priority: 'medium' as const,
          execution_class: 'manual' as const,
          dependency_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const result = await actionIntelligenceService.getNextBestAction('user_123', 'thread_1', actions);
      expect(result.type).toBe('NEXT_BEST_ACTION');
      if (result.type === 'NEXT_BEST_ACTION') {
        expect(result.action.id).toBe('action_2');
      }
    });
  });

  describe('4. ContextualTimingEngine: Timezone Validation Helper', () => {
    it('validates IANA timezones and rejects invalid ones', () => {
      expect(contextualTimingEngine.isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(contextualTimingEngine.isValidTimezone('America/New_York')).toBe(true);
      expect(contextualTimingEngine.isValidTimezone('UTC')).toBe(true);
      expect(contextualTimingEngine.isValidTimezone('invalid/timezone')).toBe(false);
      expect(contextualTimingEngine.isValidTimezone('')).toBe(false);
      expect(contextualTimingEngine.isValidTimezone(null as any)).toBe(false);
    });
  });
});
