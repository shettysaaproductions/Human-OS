import { situationalAwareness } from '../SituationalAwareness';
import { userLifeStageEngine } from '../UserLifeStageEngine';

describe('Backend Zero-Vagueness, Contextual Continuity & Lifestyle Evolution', () => {
  describe('1. SituationalAwareness: Re-Entry Continuity & Anti-Vagueness Invariant', () => {
    it('encourages seamless continuation of prior topic rather than forbidding thread pick-up on re-entry', () => {
      const phase = situationalAwareness.detectConversationPhase([
        { role: 'user', content: 'haan' }
      ], 45);

      expect(phase).toContain('RE-ENTRY');
      expect(phase).toContain('seamlessly continue that thread');
      expect(phase).not.toContain('Do NOT pick up the old thread');
      expect(phase).toContain('NEVER say generic filler');
    });

    it('brief contains zero-vagueness persona directive strictly forbidding "kya hua" and "sochne de"', () => {
      const brief = situationalAwareness.buildBrief({
        nowLocal: new Date(),
        nowUtc: new Date(),
        tzLabel: 'IST',
        gapMinutes: 40,
        dayName: 'Sunday',
        dateStr: 'September 13, 2026',
        timeStr: '11:00 PM',
        lastUserMessage: 'haan wahi kar raha tha',
        isWeekend: true
      });

      expect(brief).toContain('ZERO-VAGUENESS & NO EMPTY RE-ENGAGEMENT FILLERS');
      expect(brief).toContain('NEVER say "Kya hua?"');
      expect(brief).toContain('Kuch toh bola tha');
    });
  });

  describe('2. UserLifeStageEngine: Extended Modern Lifestyle Classification', () => {
    it('classifies YouTube creators, artists, and music producers as CREATIVE_CREATOR', async () => {
      const memories = [
        { key: 'profession', value: 'YouTube creator and digital artist' },
        { key: 'primary_tool', value: 'video editing and music production' },
        { key: 'channel_name', value: 'TechVibes' }
      ];

      const stageCtx = await userLifeStageEngine.getUserLifeStageContext('test-user-creator', memories, []);
      expect(stageCtx.stage).toBe('CREATIVE_CREATOR');
      expect(stageCtx.stageLabel).toBe('Creative Creator & Artist');
      expect(stageCtx.corePurposeSummary).toContain('creative work');
    });

    it('classifies fitness enthusiasts and athletes as HEALTH_ATHLETE', async () => {
      const memories = [
        { key: 'daily_routine', value: 'Gym bodybuilding and macro diet' },
        { key: 'fitness_goal', value: 'Powerlifting competition prep' }
      ];

      const stageCtx = await userLifeStageEngine.getUserLifeStageContext('test-user-athlete', memories, []);
      expect(stageCtx.stage).toBe('HEALTH_ATHLETE');
      expect(stageCtx.stageLabel).toBe('Fitness & Health Builder');
      expect(stageCtx.corePurposeSummary).toContain('physical fitness');
    });
  });
});
