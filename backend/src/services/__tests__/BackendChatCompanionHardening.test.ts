import { promptBuilder } from '../promptBuilder';
import { validateAndRepairGrounding } from '../NovaBrainService';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { lifeBlueprintCuriosityEngine } from '../LifeBlueprintCuriosityEngine';
import { canonicalizeKey, CANONICAL_KEYS } from '../../lib/memoryKeySchema';
import { SituationalAwareness } from '../SituationalAwareness';

describe('Backend Chat Companion Hardening & Universal Lifestyle Support', () => {

  describe('1. PromptBuilder Dynamic Language & Persona Adaptation', () => {
    it('generates natural English companion persona when preferredLanguage is en', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base test prompt',
        [],
        [],
        'Alex',
        'Empathetic Companion',
        [],
        'en',
        undefined,
        'HUMAN_CHAT'
      );

      expect(prompt).toContain('VOICE: Natural, warm, conversational English');
      expect(prompt).toContain('You MUST respond in natural, conversational English');
      expect(prompt).not.toContain('VOICE: Casual Hinglish');
      expect(prompt).not.toContain('Always "tu/tum/tera"');
    });

    it('generates signature Hinglish persona when preferredLanguage is hi', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base test prompt',
        [],
        [],
        'Rahul',
        'Empathetic Companion',
        [],
        'hi',
        undefined,
        'HUMAN_CHAT'
      );

      expect(prompt).toContain('VOICE: Casual Hinglish');
      expect(prompt).toContain('Always "tu/tum/tera"');
      expect(prompt).toContain('HINGLISH VOCABULARY CHEAT SHEET');
    });

    it('generates dynamic voice adaptation when preferredLanguage is auto', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base test prompt',
        [],
        [],
        'Sam',
        'Empathetic Companion',
        [],
        'auto',
        undefined,
        'HUMAN_CHAT'
      );

      expect(prompt).toContain('VOICE & LANGUAGE:');
      expect(prompt).toContain('If the user speaks English, respond in natural, warm, conversational English');
      expect(prompt).toContain('If the user speaks Hindi or Hinglish, respond in casual Hinglish');
    });
  });

  describe('2. NovaBrainService Grounding Repairs Language Invariance', () => {
    it('repairs invented age in English when user speaks English', () => {
      const reply = "For a 5 year old child, bedtime stories are wonderful!";
      const userMessage = "What books should I read to my kid?";
      const context = { isEnglishUser: true, memories: [] };

      const repaired = validateAndRepairGrounding(reply, userMessage, context);
      expect(repaired).toBe("I don't know their age or details yet, how old are they?");
    });

    it('repairs invented age in Hinglish when user speaks Hinglish', () => {
      const reply = "5 saal ke bache ke liye stories bohot acchi hain!";
      const userMessage = "mere bache ke liye konsi books achi hai?";
      const context = { isEnglishUser: false, memories: [] };

      const repaired = validateAndRepairGrounding(reply, userMessage, context);
      expect(repaired).toBe("Mujhe uski age ya details abhi nahi pata yaar, kitne saal ka hai woh?");
    });

    it('handles unknown personal fact query in English without Hindi fallback', () => {
      const reply = "Your favourite sport is cricket and you love playing on weekends!";
      const userMessage = "What is my favourite sport?";
      const context = { isEnglishUser: true, memories: [] };

      const repaired = validateAndRepairGrounding(reply, userMessage, context);
      expect(repaired).toBe("I don't remember that right now, tell me!");
    });
  });

  describe('3. TurnAnalyzer Universal Lifestyle Favorites Extraction', () => {
    it('extracts beverage favorite in English', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('My favourite drink is matcha latte');
      expect(result).toEqual({ key: 'favourite_beverage', value: 'matcha latte' });
    });

    it('extracts sport favorite in English', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('My favorite sport is tennis');
      expect(result).toEqual({ key: 'favourite_sport', value: 'tennis' });
    });

    it('extracts movie favorite in English', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('My favourite movie is Interstellar');
      expect(result).toEqual({ key: 'favourite_movie', value: 'Interstellar' });
    });

    it('extracts music favorite in English', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('My favorite music is jazz');
      expect(result).toEqual({ key: 'favourite_music', value: 'jazz' });
    });

    it('extracts food favorite in Hinglish', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('Mera favourite khana biryani hai');
      expect(result).toEqual({ key: 'favourite_street_food', value: 'biryani' });
    });

    it('extracts game/sport favorite in Hinglish', () => {
      const result = TurnAnalyzer.extractCanonicalFavourite('Mera favourite game cricket hai');
      expect(result).toEqual({ key: 'favourite_sport', value: 'cricket' });
    });
  });

  describe('4. LifeBlueprintCuriosityEngine English Inquiry Adaptation', () => {
    it('renders English inquiry when isEnglishUser is true', () => {
      const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
        [],
        [],
        { localHour: 10, isWeekend: false }
      );

      const guidelineEn = lifeBlueprintCuriosityEngine.formatDiscoveryPromptGuideline(summary, { isEnglishUser: true });
      expect(guidelineEn).toBeTruthy();
      expect(guidelineEn).toMatch(/Suggested Natural Inquiry:\s*"[A-Z][a-zA-Z0-9\s,?'!.—-]+"/);

      const guidelineHi = lifeBlueprintCuriosityEngine.formatDiscoveryPromptGuideline(summary, { isEnglishUser: false });
      expect(guidelineHi).toBeTruthy();
    });
  });

  describe('5. MemoryKeySchema Canonical Aliases', () => {
    it('canonicalizes new lifestyle favorite keys correctly', () => {
      expect(CANONICAL_KEYS.has('favourite_sport')).toBe(true);
      expect(CANONICAL_KEYS.has('favourite_movie')).toBe(true);
      expect(CANONICAL_KEYS.has('favourite_music')).toBe(true);
      expect(CANONICAL_KEYS.has('favourite_book')).toBe(true);

      expect(canonicalizeKey('favorite_sport').canonical).toBe('favourite_sport');
      expect(canonicalizeKey('favorite_film').canonical).toBe('favourite_movie');
      expect(canonicalizeKey('favorite_song').canonical).toBe('favourite_music');
      expect(canonicalizeKey('favorite_novel').canonical).toBe('favourite_book');
    });
  });

  describe('6. SituationalAwareness Lifestyle Availability Detection (No False Busy Muting)', () => {
    const sa = new SituationalAwareness();

    it('classifies fitness metric durations as fitness, NOT busy', () => {
      expect(sa.detectAvailability('I worked out for 45 minutes')).toBe('fitness');
      expect(sa.detectAvailability('I ran 5k in 25 mins')).toBe('fitness');
      expect(sa.detectAvailability('Did 30 mins cardio today')).toBe('fitness');
    });

    it('classifies study session durations as study, NOT busy', () => {
      expect(sa.detectAvailability('Studied for 2 hours today')).toBe('study');
      expect(sa.detectAvailability('Exam revision for 3 hours')).toBe('study');
    });

    it('classifies habit and sleep durations as habit, NOT busy', () => {
      expect(sa.detectAvailability('Meditation for 20 mins done')).toBe('habit');
      expect(sa.detectAvailability('Slept 8 hours last night')).toBe('habit');
    });

    it('does not classify reminder commands with durations as busy', () => {
      expect(sa.detectAvailability('Remind me in 10 minutes to call mom')).toBe('neutral');
      expect(sa.detectAvailability('Set a reminder in 15 minutes')).toBe('neutral');
    });

    it('correctly classifies explicit delay/unavailability phrasing as busy', () => {
      expect(sa.detectAvailability('Give me 15 mins, in a meeting')).toBe('busy');
      expect(sa.detectAvailability('10 min baad baat karte hain')).toBe('busy');
      expect(sa.detectAvailability('Call you in 20 mins')).toBe('busy');
      expect(sa.detectAvailability('gtg')).toBe('busy');
    });
  });

  describe('7. TurnAnalyzer Reminder Intent Extraction with English & Wake-Up Support', () => {
    it('extracts English reminder with relative time', () => {
      const result = TurnAnalyzer.extractReminderIntent('Set a reminder to drink water in 20 minutes');
      expect(result).not.toBeNull();
      expect(result?.isAmbiguous).toBe(false);
      expect(result?.rawTime).toBe('20min');
    });

    it('extracts English alarm for morning', () => {
      const result = TurnAnalyzer.extractReminderIntent('Set an alarm for 6am');
      expect(result).not.toBeNull();
      expect(result?.isAmbiguous).toBe(false);
      expect(result?.rawTime).toBe('6');
    });

    it('extracts wake up command', () => {
      const result = TurnAnalyzer.extractReminderIntent('Wake me up at 7');
      expect(result).not.toBeNull();
      expect(result?.isAmbiguous).toBe(false);
    });

    it('rejects figurative expressions from reminder intent', () => {
      expect(TurnAnalyzer.extractReminderIntent('You remind me of my brother')).toBeNull();
      expect(TurnAnalyzer.extractReminderIntent('This reminds me of college')).toBeNull();
    });
  });
});

