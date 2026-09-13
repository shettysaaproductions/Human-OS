import { classifyUnavailability } from '../NovaFollowupService';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { synthesizeContextualOptions } from '../ResponseIntelligence';
import { resolveUserTzOffsetHours } from '../ReminderEngine';

describe('BackendChatHardeningNewBugs', () => {
  describe('1. Timezone Resolution with Device & Profile Offsets', () => {
    it('uses exact device timezone_offset in minutes when provided', () => {
      // IST: 330 minutes -> 5.5 hours
      expect(resolveUserTzOffsetHours({ timezone_offset: 330 })).toBe(5.5);
      // US PST: -480 minutes -> -8 hours
      expect(resolveUserTzOffsetHours({ timezone_offset: -480 })).toBe(-8);
      // US EST: -300 minutes -> -5 hours
      expect(resolveUserTzOffsetHours({ timezone_offset: -300 })).toBe(-5);
      // CET: 60 minutes -> 1 hour
      expect(resolveUserTzOffsetHours({ timezone_offset: 60 })).toBe(1);
      // Tokyo: 540 minutes -> 9 hours
      expect(resolveUserTzOffsetHours({ timezone_offset: 540 })).toBe(9);
    });

    it('uses IANA timezone string when timezone_offset is null', () => {
      const offsetPST = resolveUserTzOffsetHours({ timezone_offset: null, timezone: 'America/Los_Angeles' });
      expect(offsetPST === -7 || offsetPST === -8).toBe(true);

      const offsetTokyo = resolveUserTzOffsetHours({ timezone_offset: null, timezone: 'Asia/Tokyo' });
      expect(offsetTokyo).toBe(9);
    });

    it('falls back to country code mapping when offset and timezone are absent', () => {
      expect(resolveUserTzOffsetHours({ country: 'AU' })).toBe(10);
      expect(resolveUserTzOffsetHours({ country: 'GB' })).toBe(0);
      expect(resolveUserTzOffsetHours({ country: 'IN' })).toBe(5.5);
    });
  });

  describe('2. Departure and Sleep Signal Classification', () => {
    it('does NOT trigger unavailability for technical or English words containing "bye"', () => {
      expect(classifyUnavailability('how many bytes in an integer?')).toBeNull();
      expect(classifyUnavailability('explain 8 bytes vs 4 bytes in c++')).toBeNull();
      expect(classifyUnavailability('a bystander saw the event')).toBeNull();
      expect(classifyUnavailability('stream 1024 bytes')).toBeNull();
    });

    it('correctly triggers busy lock for genuine departures', () => {
      expect(classifyUnavailability('ok bye')).toEqual({ type: 'busy', hours: 2 });
      expect(classifyUnavailability('bye yaar')).toEqual({ type: 'busy', hours: 2 });
      expect(classifyUnavailability('byee')).toEqual({ type: 'busy', hours: 2 });
      expect(classifyUnavailability('gtg for now')).toEqual({ type: 'busy', hours: 2 });
      expect(classifyUnavailability('ttyl')).toEqual({ type: 'busy', hours: 2 });
    });

    it('correctly triggers sleep lock for genuine sleep signals including terminal "gn"', () => {
      expect(classifyUnavailability('ok gn')).toEqual({ type: 'sleep', hours: 8 });
      expect(classifyUnavailability('goodnight!')).toEqual({ type: 'sleep', hours: 8 });
      expect(classifyUnavailability('good night Nova')).toEqual({ type: 'sleep', hours: 8 });
      expect(classifyUnavailability('soone ja raha hoon')).toEqual({ type: 'sleep', hours: 8 });
    });
  });

  describe('3. Exclamation Immunity in TurnAnalyzer', () => {
    it('does NOT classify "Kya baat hai!" as a question', () => {
      const result = TurnAnalyzer.analyze('Kya baat hai yaar!');
      expect(result.hasQuestions).toBe(false);
      expect(result.questionClauses).not.toContain('Kya baat hai yaar!');
      expect(result.hasEmotions).toBe(true);
    });

    it('does NOT classify "Kya mast workout tha" as a question', () => {
      const result = TurnAnalyzer.analyze('Kya mast workout tha');
      expect(result.hasQuestions).toBe(false);
      expect(result.hasEmotions).toBe(true);
    });

    it('preserves genuine questions with kya', () => {
      const result = TurnAnalyzer.analyze('Kya tum kal free ho?');
      expect(result.hasQuestions).toBe(true);
      expect(result.units.some(u => u.type === 'question')).toBe(true);
    });
  });

  describe('4. Contextual Options Synthesis', () => {
    it('offers task viewing and follow-up when reminder is already confirmed', () => {
      const options = synthesizeContextualOptions({
        message: 'Remind me to call mom in 20 minutes',
        replyText: 'Haan! 20 minute baad call karne ka reminder set kar diya hai.',
        language: 'hi'
      });
      expect(options).toContain('Show my tasks');
      expect(options).toContain('Set another reminder');
      expect(options).not.toContain('Kab remind karu?');
    });

    it('offers clarification when reminder time is not yet confirmed', () => {
      const options = synthesizeContextualOptions({
        message: 'Remind me to call mom',
        replyText: 'Main reminder set kar sakti hu, kab yaad dilau?',
        language: 'hi'
      });
      expect(options).toContain('Kab remind karu?');
    });

    it('synthesizes creative and cooking options for diverse lifestyles', () => {
      const creativeOptions = synthesizeContextualOptions({
        message: 'I am writing a sci-fi story script',
        replyText: 'Sounds thrilling! What is the premise?',
        language: 'en'
      });
      expect(creativeOptions).toContain('Brainstorm ideas');

      const cookingOptions = synthesizeContextualOptions({
        message: 'Aaj dinner me paneer bana raha hoon',
        replyText: 'Badhiya! Kya recipe soch rahe ho?',
        language: 'hi'
      });
      expect(cookingOptions).toContain('Quick healthy recipe batao');
    });
  });
});
