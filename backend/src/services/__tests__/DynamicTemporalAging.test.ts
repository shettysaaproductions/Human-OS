import { computeDynamicAge, promptBuilder } from '../promptBuilder';
import { canonicalizeKey, isKnownCanonicalKey } from '../../lib/memoryKeySchema';

describe('Dynamic Temporal Aging & Companion Dot-Connecting', () => {
  describe('computeDynamicAge', () => {
    it('returns exact value with approx birth anchor when elapsed time is 0', () => {
      const created = new Date('2026-09-09T10:00:00Z');
      const now = new Date('2026-09-09T12:00:00Z');

      const result = computeDynamicAge('6 months', created, now);
      expect(result).toContain('6 months');
      expect(result).toContain('approx birth: March 2026');
      expect(result).toContain('recorded on 2026-09-09');
    });

    it('dynamically increments age by elapsed months (+1 month = 7 months)', () => {
      const created = new Date('2026-09-09T10:00:00Z');
      const oneMonthLater = new Date('2026-10-09T10:00:00Z');

      const result = computeDynamicAge('6 months', created, oneMonthLater);
      expect(result).toContain('7 months');
      expect(result).toContain('originally recorded as "6 months"');
      expect(result).toContain('approx birth: March 2026');
    });

    it('dynamically advances to years when child turns 24+ months', () => {
      const created = new Date('2026-09-09T10:00:00Z');
      const eighteenMonthsLater = new Date('2028-03-09T10:00:00Z'); // +18 months = 24 months total

      const result = computeDynamicAge('6 months', created, eighteenMonthsLater);
      expect(result).toContain('2 years');
      expect(result).toContain('originally recorded as "6 months"');
      expect(result).toContain('approx birth: March 2026');
    });

    it('returns non-age values unchanged', () => {
      const created = new Date('2026-09-09T10:00:00Z');
      expect(computeDynamicAge('conviction hr', created)).toBe('conviction hr');
      expect(computeDynamicAge('1990-05-15', created)).toBe('1990-05-15');
    });
  });

  describe('PromptBuilder age rendering & companion directives', () => {
    it('renders dynamic age in PromptBuilder long-term memory', () => {
      const created = new Date('2026-09-09T10:00:00Z');
      const prompt = promptBuilder.buildSystemPrompt(
        'BASE_PROMPT',
        [
          { id: '1', key: 'son_age', value: '6 months', memory_type: 'personal', importance: 90, created_at: created } as any,
          { id: '2', key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 90 } as any,
        ],
        [],
        'Sagar'
      );

      expect(prompt).toContain('son age: 6 months');
      expect(prompt).toContain('approx birth: March 2026');
      expect(prompt).toContain('SIDE-BY-SIDE HUMAN COMPANION');
      expect(prompt).toContain('MEMORY DOT-CONNECTING RULE');
    });
  });

  describe('Canonical Schema Expansion', () => {
    it('recognizes onboarding keys as known canonical keys', () => {
      expect(isKnownCanonicalKey('passions')).toBe(true);
      expect(isKnownCanonicalKey('goals')).toBe(true);
      expect(isKnownCanonicalKey('family_details')).toBe(true);
      expect(isKnownCanonicalKey('important_facts')).toBe(true);
      expect(isKnownCanonicalKey('work_schedule')).toBe(true);
      expect(isKnownCanonicalKey('son_age')).toBe(true);
      expect(isKnownCanonicalKey('daughter_age')).toBe(true);
    });

    it('canonicalizes onboarding aliases to canonical keys', () => {
      expect(canonicalizeKey('hobbies').canonical).toBe('passions');
      expect(canonicalizeKey('family_and_relationships').canonical).toBe('family_details');
      expect(canonicalizeKey('bete_ki_umar').canonical).toBe('son_age');
      expect(canonicalizeKey('office_hours').canonical).toBe('work_schedule');
      expect(canonicalizeKey('important_life_facts').canonical).toBe('important_facts');
    });
  });
});
