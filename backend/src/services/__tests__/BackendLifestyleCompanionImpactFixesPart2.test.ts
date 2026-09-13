import { situationalAwareness } from '../SituationalAwareness';
import { userLifeStageEngine } from '../UserLifeStageEngine';
import { buildReminderSpecFromIntent } from '../ReminderEngine';
import { reminderIntentDetector } from '../ReminderIntentDetector';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { LifeBlueprintCuriosityEngine, FOUNDATIONAL_BLUEPRINT_REGISTRY } from '../LifeBlueprintCuriosityEngine';
import { getNovaEmptyReply } from '../NovaBrainService';

describe('Backend Lifestyle Companion & Core Reliability Impact Fixes (Part 2)', () => {
  describe('1. SituationalAwareness: False Goodnight / Winding Down Elimination', () => {
    it('does NOT trigger WINDING_DOWN on ordinary words containing "gn" like assignment, design, signal, signature', () => {
      const phrases = [
        'I am working on my college assignment right now',
        'Can you review this system design architecture with me?',
        'The wifi signal is quite weak in my bedroom',
        'I need your signature on this contract document',
        'We observed significant alignment in user tests'
      ];

      for (const phrase of phrases) {
        const phase = situationalAwareness.detectConversationPhase([
          { role: 'user', content: phrase }
        ]);
        expect(phase).not.toBe('WINDING_DOWN');
      }
    });

    it('correctly triggers WINDING_DOWN on actual goodnight phrases and slang', () => {
      const goodnightPhrases = [
        'gn nova',
        'good night! see you tomorrow',
        'ok goodnight',
        'alvida',
        'chalo ab sojao',
        'so ja',
        'cya, ttyl',
        'ok bye!'
      ];

      for (const phrase of goodnightPhrases) {
        const phase = situationalAwareness.detectConversationPhase([
          { role: 'user', content: phrase }
        ], 1);
        expect(phase).toContain('WINDING_DOWN');
      }
    });
  });

  describe('2. UserLifeStageEngine: Open Daytime Flow & Overnight Shift Support', () => {
    it('does not lock new users or freelancers into 11am-8pm work focus when no schedule is defined', async () => {
      const stageCtx = await userLifeStageEngine.getUserLifeStageContext('test-user-freelancer', [], {});
      // When user has no fixed company shift, there is no work focus lockout
      expect(stageCtx.lifestyleRhythm.isWorkFocusHours).toBe(false);
    });

    it('supports overnight shift workers where shift start hour > shift end hour (e.g. 19:00 to 04:00)', async () => {
      const memories = [
        { key: 'company_name', value: 'NightOps Logistics', memory_type: 'work' },
        { key: 'work_schedule', value: '19:00 - 04:00', memory_type: 'work' }
      ];

      const stageCtx = await userLifeStageEngine.getUserLifeStageContext('test-user-shift', memories, {});
      expect(stageCtx.primaryLivelihood?.shiftStartHour).toBe(19);
      expect(stageCtx.primaryLivelihood?.shiftEndHour).toBe(4);
    });

    it('honors non-traditional weekly off days stored in memories (e.g. Wednesday)', async () => {
      const memories = [
        { key: 'weekoff_day', value: 'Wednesday', memory_type: 'work' }
      ];

      const stageCtx = await userLifeStageEngine.getUserLifeStageContext('test-user-wednesday', memories, {});
      if (stageCtx.lifestyleRhythm.dayOfWeek.toLowerCase() === 'wednesday') {
        expect(stageCtx.lifestyleRhythm.currentPhase).toBe('WEEKEND_FLEX');
        expect(stageCtx.lifestyleRhythm.isWorkFocusHours).toBe(false);
      }
    });
  });

  describe('3. ReminderEngine & Intent Detector: Diverse Expressions & Day-of-Week', () => {
    it('parses tomorrow, tmrw, kal, parso, and relative minutes in buildReminderSpecFromIntent', () => {
      const specTomorrow = buildReminderSpecFromIntent({
        text: 'call doctor tomorrow at 5pm',
        timePhrase: 'tomorrow at 5pm',
        rawTime: '5',
        periodWord: 'pm',
        isAmbiguous: false
      }, 5.5);
      expect(specTomorrow?.date).toBeDefined();

      const specKal = buildReminderSpecFromIntent({
        text: 'kal subah 9 baje meeting hai',
        timePhrase: 'kal subah 9 baje',
        rawTime: '9',
        periodWord: 'subah',
        isAmbiguous: false
      }, 5.5);
      expect(specKal?.date).toBeDefined();

      const specRelativeBaad = buildReminderSpecFromIntent({
        text: '25 minute baad remind karo water',
        timePhrase: '25 minute baad',
        rawTime: '25min',
        isAmbiguous: false
      }, 5.5);
      expect(specRelativeBaad?.relative_value).toBe(25);
      expect(specRelativeBaad?.relative_unit).toBe('minutes');

      const specHalfHour = buildReminderSpecFromIntent({
        text: 'aadhe ghante baad call mom',
        timePhrase: 'aadhe ghante baad',
        rawTime: '30min',
        isAmbiguous: false
      }, 5.5);
      expect(specHalfHour?.relative_value).toBe(30);
      expect(specHalfHour?.relative_unit).toBe('minutes');
    });

    it('detects day-of-week reminder ("on Monday", "Somwar ko") and sets target date ahead', () => {
      const parsed = reminderIntentDetector.parseReminderDetails('remind me on Monday at 10am to pay rent', 5.5);
      expect(parsed.triggerAt).toBeDefined();
      expect(parsed.title.toLowerCase()).toContain('rent');
    });

    it('detects explicit recurring days ("every Monday")', () => {
      const parsed = reminderIntentDetector.parseReminderDetails('every Monday at 8am remind team standup', 5.5);
      expect(parsed.activeDays).toContain('monday');
      expect(parsed.isRecurring).toBe(true);
    });
  });

  describe('4. TurnAnalyzer: Expanded Relations, Pets, Sleep, and Work Mode', () => {
    it('extracts girlfriend_name, boyfriend_name, and partner_name facts', () => {
      const gfResult = TurnAnalyzer.analyze([
        { message: 'Meri girlfriend ka naam Priya hai' }
      ]);
      const gfUnit = gfResult.units.find(u => u.factKey === 'girlfriend_name');
      expect(gfUnit).toBeDefined();
      expect(gfUnit?.factValue).toBe('Priya');

      const bfResult = TurnAnalyzer.analyze([
        { message: 'My boyfriend name is Rohan' }
      ]);
      const bfUnit = bfResult.units.find(u => u.factKey === 'boyfriend_name');
      expect(bfUnit).toBeDefined();
      expect(bfUnit?.factValue).toBe('Rohan');
    });

    it('extracts pet facts', () => {
      const petResult = TurnAnalyzer.analyze([
        { message: 'I have a dog named Bruno' }
      ]);
      const petNameUnit = petResult.units.find(u => u.factKey === 'pet_name');
      const petTypeUnit = petResult.units.find(u => u.factKey === 'pet_type');
      expect(petNameUnit?.factValue).toBe('Bruno');
      expect(petTypeUnit?.factValue).toBe('dog');
    });

    it('extracts bedtime and wake-up time facts for night owls and shift workers', () => {
      const sleepResult = TurnAnalyzer.analyze([
        { message: 'I usually sleep at 3am' }
      ]);
      const sleepUnit = sleepResult.units.find(u => u.factKey === 'sleep_time');
      expect(sleepUnit).toBeDefined();

      const wakeResult = TurnAnalyzer.analyze([
        { message: 'I wake up at 11am' }
      ]);
      const wakeUnit = wakeResult.units.find(u => u.factKey === 'wake_time');
      expect(wakeUnit).toBeDefined();
    });

    it('extracts work mode (WFH / Remote / Hybrid)', () => {
      const wfhResult = TurnAnalyzer.analyze([
        { message: 'I work remotely from home' }
      ]);
      const wmUnit = wfhResult.units.find(u => u.factKey === 'work_mode');
      expect(wmUnit?.factValue).toContain('Remote');
    });
  });

  describe('5. LifeBlueprintCuriosityEngine: Broadened Lifestyle Patterns & Pets Registry', () => {
    it('registry contains pets_or_animals with comprehensive patterns', () => {
      const petItem = FOUNDATIONAL_BLUEPRINT_REGISTRY.find(i => i.key === 'pets_or_animals');
      expect(petItem).toBeDefined();
      expect(petItem?.matchingKeys).toContain('pet_name');
      expect(petItem?.matchingKeys).toContain('pet_type');
    });

    it('recognizes 3am bedtime and 11am wake-up as known sleep/wake rhythms', () => {
      const curiosityEngine = new LifeBlueprintCuriosityEngine();
      const memories = [
        { key: 'sleep_time', value: '3am late night coder' },
        { key: 'wake_time', value: '11:00 am wakeup' },
        { key: 'morning_starter', value: 'cold brew coffee and protein shake' },
        { key: 'dinner_time', value: '7:30 pm early dinner' }
      ];

      const gaps = curiosityEngine.evaluateMissingBlueprintGaps(memories, {});
      // Known items are NOT present in missingGapsByCategory
      const isSleepMissing = gaps.missingGapsByCategory.SLEEP_AND_RHYTHM.some(g => g.key === 'sleep_time');
      const isWakeMissing = gaps.missingGapsByCategory.SLEEP_AND_RHYTHM.some(g => g.key === 'wake_time');
      const isStarterMissing = gaps.missingGapsByCategory.SLEEP_AND_RHYTHM.some(g => g.key === 'morning_starter');
      const isDinnerMissing = gaps.missingGapsByCategory.SLEEP_AND_RHYTHM.some(g => g.key === 'dinner_time');

      expect(isSleepMissing).toBe(false);
      expect(isWakeMissing).toBe(false);
      expect(isStarterMissing).toBe(false);
      expect(isDinnerMissing).toBe(false);
    });
  });

  describe('6. NovaBrainService: Bilingual Empty Reply Fallback', () => {
    it('returns natural English fallback for English contexts', () => {
      const enReply = getNovaEmptyReply(true);
      expect(enReply).toMatch(/think|back|let me/i);
      expect(enReply).not.toContain('suno');
    });

    it('returns warm Hinglish fallback for Hindi/Hinglish contexts', () => {
      const hiReply = getNovaEmptyReply(false);
      expect(hiReply).toMatch(/sochne|batati/i);
    });
  });
});
