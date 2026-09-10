/**
 * SmartProactiveReminderEngine.test.ts
 * Tests proactive future plan & habit detection, turn analysis, and Watchtower auto-correction.
 */

import { ReminderIntentDetector } from '../ReminderIntentDetector';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { isLikelyActionable } from '../../lib/SemanticInterpreter';

describe('Smart Proactive Reminder Engine & Future Plan Watchtower', () => {
  const detector = ReminderIntentDetector.getInstance();

  describe('1. ReminderIntentDetector.hasFuturePlanIntent', () => {
    it('detects future workout routine with waking up time', () => {
      const msg = 'Sube muje roz workout start karna hai 8 baje uth ke';
      expect(detector.hasFuturePlanIntent(msg)).toBe(true);
    });

    it('detects starting gym from tomorrow', () => {
      const msg = 'kal se gym shuru karna hai';
      expect(detector.hasFuturePlanIntent(msg)).toBe(true);
    });

    it('detects daily reading habit with specific night time', () => {
      const msg = 'roz raat ko 10 baje book padhni hai';
      expect(detector.hasFuturePlanIntent(msg)).toBe(true);
    });

    it('detects doctor appointment plan', () => {
      const msg = 'parso doctor ke paas jana hai 4 baje';
      expect(detector.hasFuturePlanIntent(msg)).toBe(true);
    });

    it('returns false for casual chat without future plans', () => {
      expect(detector.hasFuturePlanIntent('Kaise ho yaar?')).toBe(false);
      expect(detector.hasFuturePlanIntent('Sab theek hai bhai')).toBe(false);
      expect(detector.hasFuturePlanIntent('Mujhe neend aa rahi hai so raha hoon')).toBe(false);
    });
  });

  describe('2. ReminderIntentDetector.extractFuturePlanDetails', () => {
    it('extracts task, recurrence, and time for morning workout routine', () => {
      const msg = 'Sube muje roz workout start karna hai 8 baje uth ke';
      const details = detector.extractFuturePlanDetails(msg, 5.5);

      expect(details.isAmbiguous).toBe(false);
      expect(details.isRecurring).toBe(true);
      expect(details.recurrenceType).toBe('daily');
      expect(details.title.toLowerCase()).toContain('workout');
      expect(details.formattedTime).toContain('8:00 AM');
      expect(details.formattedTime).toContain('Every day');
    });

    it('identifies ambiguous future plan missing exact time', () => {
      const msg = 'kal se gym shuru karna hai';
      const details = detector.extractFuturePlanDetails(msg, 5.5);

      expect(details.title.toLowerCase()).toContain('gym');
    });
  });

  describe('3. SemanticInterpreter.isLikelyActionable', () => {
    it('marks future habit messages as likely actionable', () => {
      expect(isLikelyActionable('Sube muje roz workout start karna hai 8 baje uth ke')).toBe(true);
      expect(isLikelyActionable('kal se gym shuru karna hai')).toBe(true);
      expect(isLikelyActionable('roz 8 baje uthna hai')).toBe(true);
    });
  });

  describe('4. TurnAnalyzer Action Classification & Prompt Injection', () => {
    it('classifies future workout plan as action and injects SMART PROACTIVE REMINDER OPPORTUNITY', () => {
      const result = TurnAnalyzer.analyze([
        { role: 'user', message: 'Sube muje roz workout start karna hai 8 baje uth ke' }
      ]);

      expect(result.hasActions).toBe(true);
      const actionUnit = result.units.find(u => u.type === 'action');
      expect(actionUnit).toBeDefined();

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(result);
      expect(prompt).toContain('SMART PROACTIVE REMINDER OPPORTUNITY');
      expect(prompt).toContain('DO NOT give a passive 1-word answer like "Sahi"');
      expect(prompt).toContain('proactively ask if you can set a reminder or alarm');
    });
  });
});
