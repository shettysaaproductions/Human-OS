import { isValidEntityName, isValidMemoryAttributeValue } from '../../lib/entitySemanticValidator';
import { isConceptRelationshipSupported } from '../../lib/SemanticValidator';
import { promptBuilder } from '../promptBuilder';
import { isGarbageMemoryValue } from '../../lib/memoryFilters';

describe('Memory & Entity Quality Gate Tests', () => {

  describe('1. isValidEntityName - Named Entity Boundary & Particle Rejection', () => {
    it('rejects Hindi/Hinglish light verbs and particles', () => {
      expect(isValidEntityName('kar').isValid).toBe(false);
      expect(isValidEntityName('Kar').isValid).toBe(false);
      expect(isValidEntityName('karo').isValid).toBe(false);
      expect(isValidEntityName('karna').isValid).toBe(false);
      expect(isValidEntityName('karke').isValid).toBe(false);
      expect(isValidEntityName('ke').isValid).toBe(false);
      expect(isValidEntityName('Ke').isValid).toBe(false);
      expect(isValidEntityName('ka').isValid).toBe(false);
      expect(isValidEntityName('ki').isValid).toBe(false);
      expect(isValidEntityName('ko').isValid).toBe(false);
      expect(isValidEntityName('se').isValid).toBe(false);
      expect(isValidEntityName('mein').isValid).toBe(false);
      expect(isValidEntityName('rehta').isValid).toBe(false);
      expect(isValidEntityName('rehta hai').isValid).toBe(false);
    });

    it('rejects sentence fragments and temporal expressions', () => {
      expect(isValidEntityName('6 months old').isValid).toBe(false);
      expect(isValidEntityName('5th day of every month').isValid).toBe(false);
      expect(isValidEntityName('mere society mein').isValid).toBe(false);
      expect(isValidEntityName('call kar ke').isValid).toBe(false);
    });

    it('rejects English function words and generic nouns', () => {
      expect(isValidEntityName('the').isValid).toBe(false);
      expect(isValidEntityName('and').isValid).toBe(false);
      expect(isValidEntityName('office').isValid).toBe(false);
      expect(isValidEntityName('Office').isValid).toBe(false);
      expect(isValidEntityName('washroom').isValid).toBe(false);
      expect(isValidEntityName('work').isValid).toBe(false);
    });

    it('accepts genuine entity and person names', () => {
      expect(isValidEntityName('Sagar').isValid).toBe(true);
      expect(isValidEntityName('Shreshth').isValid).toBe(true);
      expect(isValidEntityName('Sakshi').isValid).toBe(true);
      expect(isValidEntityName('Sushant').isValid).toBe(true);
      expect(isValidEntityName('Pankaj').isValid).toBe(true);
      expect(isValidEntityName('Tuku').isValid).toBe(true);
    });

    it('accepts genuine short names while rejecting particles', () => {
      expect(isValidEntityName('Om').isValid).toBe(true);
      expect(isValidEntityName('Al').isValid).toBe(true);
      expect(isValidEntityName('Bo').isValid).toBe(true);
      expect(isValidEntityName('Jo').isValid).toBe(true);
      expect(isValidEntityName('Ty').isValid).toBe(true);
      expect(isValidEntityName('Mo').isValid).toBe(true);
      expect(isValidEntityName('Ed').isValid).toBe(true);

      // But rejects 2-letter grammatical particles
      expect(isValidEntityName('ka').isValid).toBe(false);
      expect(isValidEntityName('ki').isValid).toBe(false);
      expect(isValidEntityName('ke').isValid).toBe(false);
      expect(isValidEntityName('ko').isValid).toBe(false);
      expect(isValidEntityName('se').isValid).toBe(false);
      expect(isValidEntityName('me').isValid).toBe(false);
      expect(isValidEntityName('pe').isValid).toBe(false);
    });
  });

  describe('2. isValidMemoryAttributeValue & isGarbageMemoryValue', () => {
    it('rejects verbs and copulas as locations', () => {
      expect(isValidMemoryAttributeValue('friend_location', 'Rehta hai').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('residence', 'rehti hai').isValid).toBe(false);
      expect(isGarbageMemoryValue('friend_location', 'Rehta hai')).toBe(true);
    });

    it('rejects verbs/particles as names and nicknames', () => {
      expect(isValidMemoryAttributeValue('son_name', 'Kar').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('son_nickname', 'Ke').isValid).toBe(false);
      expect(isGarbageMemoryValue('son_name', 'Kar')).toBe(true);
      expect(isGarbageMemoryValue('son_nickname', 'Ke')).toBe(true);
    });

    it('rejects generic role echo as an attribute', () => {
      expect(isValidMemoryAttributeValue('friend_attribute', 'friend').isValid).toBe(false);
      expect(isGarbageMemoryValue('friend_attribute', 'friend')).toBe(true);
    });

    it('accepts legitimate memory attribute values', () => {
      expect(isValidMemoryAttributeValue('son_name', 'Shreshth').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('son_nickname', 'Tuku').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('friend_location', 'Indirapuram').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('office_salary_day', '5th of month').isValid).toBe(true);
      expect(isGarbageMemoryValue('son_name', 'Shreshth')).toBe(false);
      expect(isGarbageMemoryValue('friend_location', 'Indirapuram')).toBe(false);
    });
  });

  describe('3. SemanticValidator - Identity vs Kinship Disambiguation', () => {
    it('rejects user identity attribution when statement only mentions relatives', () => {
      const msg = 'Tiku mere bete ka nickname hai';
      expect(isConceptRelationshipSupported('preferred_name', 'Tiku', msg, false)).toBe(false);
      expect(isConceptRelationshipSupported('user_name', 'Tiku', msg, false)).toBe(false);
      expect(isConceptRelationshipSupported('son_nickname', 'Tiku', msg, false)).toBe(true);
    });

    it('rejects relative attribution when statement describes user self-name', () => {
      const msg = 'Mera name toh Sagar hai';
      expect(isConceptRelationshipSupported('son_name', 'Sagar', msg, false)).toBe(false);
      expect(isConceptRelationshipSupported('preferred_name', 'Sagar', msg, false)).toBe(true);
    });
  });

  describe('4. PromptBuilder - Verified User Identity & Kinship Shield', () => {
    it('injects safeUserName and anti-leak shield into prompt', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base test prompt',
        [
          { key: 'son_name', value: 'Shreshth', memory_type: 'personal' } as any,
          { key: 'son_nickname', value: 'Tuku', memory_type: 'personal' } as any,
        ],
        [],
        'Sagar',
        'Empathetic Companion',
        [],
        'hi',
        undefined,
        'HUMAN_CHAT'
      );

      expect(prompt).toContain('USER / SELF NAME: "Sagar"');
      expect(prompt).toContain('ZERO IDENTITY LEAK: NEVER confuse "Sagar" with their relatives');
      expect(prompt).toContain('NEVER call "Sagar" by their son\'s nickname "Tiku"');
      expect(prompt).toContain('User\'s son: name: "Shreshth", nickname: "Tuku"');
    });

    it('filters out corrupted preferred_name that matches a family member nickname', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base test prompt',
        [
          { key: 'preferred_name', value: 'Tuku', memory_type: 'personal' } as any,
          { key: 'son_name', value: 'Shreshth', memory_type: 'personal' } as any,
          { key: 'son_nickname', value: 'Tuku', memory_type: 'personal' } as any,
        ],
        [],
        'Sagar',
        'Empathetic Companion',
        [],
        'hi',
        undefined,
        'HUMAN_CHAT'
      );

      // preferred_name: Tuku should be filtered out from compartment memories because Tuku is the son's nickname
      expect(prompt).not.toContain('- preferred name: Tuku');
    });
  });
});
