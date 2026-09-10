import { situationalAwareness } from '../services/SituationalAwareness';

describe('Lifestyle Situational Awareness & Companion Intelligence', () => {
  describe('detectAvailability with Lifestyle Signals', () => {
    it('detects fitness signals', () => {
      expect(situationalAwareness.detectAvailability('Just finished my gym workout, hit 80kg bench press')).toBe('fitness');
      expect(situationalAwareness.detectAvailability('Tracking my calorie deficit and protein shake')).toBe('fitness');
      expect(situationalAwareness.detectAvailability('Leg day today, did heavy squats')).toBe('fitness');
    });

    it('detects study signals', () => {
      expect(situationalAwareness.detectAvailability('Studying for my semester exam tomorrow')).toBe('study');
      expect(situationalAwareness.detectAvailability('Working on my college assignment and syllabus')).toBe('study');
      expect(situationalAwareness.detectAvailability('Giving a mock test this afternoon')).toBe('study');
    });

    it('detects work & career signals', () => {
      expect(situationalAwareness.detectAvailability('In a client meeting right now')).toBe('work');
      expect(situationalAwareness.detectAvailability('Prepping for the sprint standup and code review')).toBe('work');
      expect(situationalAwareness.detectAvailability('Big deadline today for project presentation')).toBe('work');
    });

    it('detects pet companion signals', () => {
      expect(situationalAwareness.detectAvailability('Taking my dog to the vet for vaccination')).toBe('pet');
      expect(situationalAwareness.detectAvailability('My cat is feeling a bit under the weather')).toBe('pet');
      expect(situationalAwareness.detectAvailability('Playing with puppy at the park')).toBe('pet');
    });

    it('detects creative signals', () => {
      expect(situationalAwareness.detectAvailability('Editing a new youtube video for my channel')).toBe('creative');
      expect(situationalAwareness.detectAvailability('Writing lyrics for my next track')).toBe('creative');
      expect(situationalAwareness.detectAvailability('Finishing up my digital art painting')).toBe('creative');
    });

    it('detects habit consistency signals', () => {
      expect(situationalAwareness.detectAvailability('10k steps done today!')).toBe('habit');
      expect(situationalAwareness.detectAvailability('Drank 3 liters of water and logged meditation')).toBe('habit');
      expect(situationalAwareness.detectAvailability('Habit streak day 15 on journaling')).toBe('habit');
    });

    it('preserves existing signals (busy, excited, relationship)', () => {
      expect(situationalAwareness.detectAvailability('Call me in 30 mins, busy in meeting')).toBe('busy');
      expect(situationalAwareness.detectAvailability('I got the job! So excited and happy!!')).toBe('excited');
      expect(situationalAwareness.detectAvailability('I think she likes me, we went on a date')).toBe('relationship');
    });
  });

  describe('buildBrief Lifestyle Guidance and Discovery Phase', () => {
    const baseCtx = {
      nowLocal: new Date('2026-09-11T10:00:00Z'),
      tzLabel: 'IST',
      country: 'IN',
      gapMinutes: 10,
      latestEmotion: null,
      recentEpisodes: [],
      latestReflection: null,
      isWeekend: false,
      scheduleOverrideNote: null,
      dayName: 'Friday',
      dateStr: '11/09/2026',
      timeStr: '10:00 AM',
      lastUserMessage: 'Leg day today at the gym, did 100kg squats',
      upcomingReminders: [],
      currentVisualContext: null,
      userPresence: { status: 'online', last_active_at: new Date().toISOString() },
      unreadNovaMessages: 0,
      behaviorPattern: null,
      totalMemoriesCount: 2, // New user with only 2 memories!
    };

    it('injects fitness lifestyle guidance when fitness message is received', () => {
      const brief = situationalAwareness.buildBrief(baseCtx as any);
      expect(brief).toContain('LIFESTYLE FOCUS (Fitness & Nutrition)');
      expect(brief).toContain('Be an energized, encouraging fitness companion');
    });

    it('activates Discovery Phase for new users (totalMemoriesCount < 15)', () => {
      const brief = situationalAwareness.buildBrief(baseCtx as any);
      expect(brief).toContain('🚀 DISCOVERY PHASE');
      expect(brief).toContain('You barely know this user (only 2 facts saved)');
      expect(brief).toContain('ask 1-2 warm, curious get-to-know-you questions');
    });

    it('does not activate Discovery Phase for established users (totalMemoriesCount >= 15)', () => {
      const establishedCtx = { ...baseCtx, totalMemoriesCount: 25 };
      const brief = situationalAwareness.buildBrief(establishedCtx as any);
      expect(brief).not.toContain('🚀 DISCOVERY PHASE');
    });
  });
});
