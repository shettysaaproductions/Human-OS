import {
  validateTurn,
  isConceptRelationshipSupported,
  isValueGroundedInSource,
} from '../lib/SemanticValidator';
import { SemanticTurn } from '../lib/SemanticInterpreter';

describe('Burst Multi-Message Comprehension & Antecedent Resolution', () => {
  describe('isConceptRelationshipSupported with burst context and Hinglish synonyms', () => {
    it('supports wife_name when "wife" is in preceding burst context rather than current message', () => {
      const source = 'Uska name sakshi hai';
      const context = 'Meri wife hai';
      const isSupported = isConceptRelationshipSupported('wife_name', 'sakshi', source, false, context);
      expect(isSupported).toBe(true);
    });

    it('supports wife_name when Hinglish synonym "biwi" is in context', () => {
      const source = 'Uska naam sakshi hai';
      const context = 'Meri biwi hai';
      const isSupported = isConceptRelationshipSupported('wife_name', 'sakshi', source, false, context);
      expect(isSupported).toBe(true);
    });

    it('supports son_name when "beta" is in preceding burst context', () => {
      const source = 'Uska name shreshth hai';
      const context = 'Mera beta hai 6 months ka';
      const isSupported = isConceptRelationshipSupported('son_name', 'shreshth', source, false, context);
      expect(isSupported).toBe(true);
    });

    it('supports son_age when "beta" and "months" are in the current message', () => {
      const source = 'Mera beta hai 6 months ka';
      const isSupported = isConceptRelationshipSupported('son_age', '6 months', source, false);
      expect(isSupported).toBe(true);
    });

    it('supports son_name directly when "bete" is in the message', () => {
      const source = 'Mere bete ka naam shreshth hai';
      const isSupported = isConceptRelationshipSupported('son_name', 'shreshth', source, false);
      expect(isSupported).toBe(true);
    });

    it('supports wife_name directly for "Meri wife ka naam sakshi hai"', () => {
      const source = 'Meri wife ka naam sakshi hai';
      const isSupported = isConceptRelationshipSupported('wife_name', 'sakshi', source, false);
      expect(isSupported).toBe(true);
    });

    it('supports father_name directly for "Mere papa ka name suresh hai"', () => {
      const source = 'Mere papa ka name suresh hai';
      const isSupported = isConceptRelationshipSupported('father_name', 'suresh', source, false);
      expect(isSupported).toBe(true);
    });

    it('supports mother_name directly for "Meri mom ka naam rajeshree hai"', () => {
      const source = 'Meri mom ka naam rajeshree hai';
      const isSupported = isConceptRelationshipSupported('mother_name', 'rajeshree', source, false);
      expect(isSupported).toBe(true);
    });
  });

  describe('Full 5-Message Sequential Burst Turn Validation', () => {
    it('successfully validates all 5 turns in the user scenario with burst context', () => {
      // Message 1: "Meri wife hai" (conversational preamble)
      const turn1: SemanticTurn = {
        turnId: 'st_1',
        sourceMessageId: 'msg_1',
        intent: 'CHAT',
        facts: [],
        corrections: [],
        actions: [],
        clarification: { required: false },
        confidence: 0.9,
      };
      const res1 = validateTurn(turn1, 'Meri wife hai');
      expect(res1.facts).toHaveLength(0);

      // Message 2: "Uska name sakshi hai" with context "Meri wife hai"
      const turn2: SemanticTurn = {
        turnId: 'st_2',
        sourceMessageId: 'msg_2',
        intent: 'MEMORY',
        facts: [{
          concept: 'wife_name',
          value: 'sakshi',
          confidence: 0.95,
          groundedInTurn: true,
        }],
        corrections: [],
        actions: [],
        clarification: { required: false },
        confidence: 0.95,
      };
      const res2 = validateTurn(turn2, 'Uska name sakshi hai', 'Meri wife hai');
      expect(res2.facts).toHaveLength(1);
      expect(res2.facts[0].canonicalKey).toBe('wife_name');
      expect(res2.facts[0].value).toBe('sakshi');

      // Message 3: "Mera beta hai 6 months ka"
      const turn3: SemanticTurn = {
        turnId: 'st_3',
        sourceMessageId: 'msg_3',
        intent: 'MEMORY',
        facts: [{
          concept: 'son_age',
          value: '6 months',
          confidence: 0.95,
          groundedInTurn: true,
        }],
        corrections: [],
        actions: [],
        clarification: { required: false },
        confidence: 0.95,
      };
      const res3 = validateTurn(turn3, 'Mera beta hai 6 months ka');
      expect(res3.facts).toHaveLength(1);
      expect(res3.facts[0].canonicalKey).toBe('son_age');
      expect(res3.facts[0].value).toBe('6 months');

      // Message 4: "Uska name shreshth hai" with context "Mera beta hai 6 months ka"
      const turn4: SemanticTurn = {
        turnId: 'st_4',
        sourceMessageId: 'msg_4',
        intent: 'MEMORY',
        facts: [{
          concept: 'son_name',
          value: 'shreshth',
          confidence: 0.95,
          groundedInTurn: true,
        }],
        corrections: [],
        actions: [],
        clarification: { required: false },
        confidence: 0.95,
      };
      const res4 = validateTurn(turn4, 'Uska name shreshth hai', 'Mera beta hai 6 months ka');
      expect(res4.facts).toHaveLength(1);
      expect(res4.facts[0].canonicalKey).toBe('son_name');
      expect(res4.facts[0].value).toBe('shreshth');

      // Message 5: "Mera full name Sagar shetty hai"
      const turn5: SemanticTurn = {
        turnId: 'st_5',
        sourceMessageId: 'msg_5',
        intent: 'MEMORY',
        facts: [{
          concept: 'preferred_name',
          value: 'Sagar shetty',
          confidence: 0.98,
          groundedInTurn: true,
        }],
        corrections: [],
        actions: [],
        clarification: { required: false },
        confidence: 0.98,
      };
      const res5 = validateTurn(turn5, 'Mera full name Sagar shetty hai');
      expect(res5.facts).toHaveLength(1);
      expect(res5.facts[0].canonicalKey).toBe('preferred_name');
      expect(res5.facts[0].value).toBe('Sagar shetty');
    });
  });
});
