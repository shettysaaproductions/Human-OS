import { entityResolutionService } from '../EntityResolutionService';
import { adaptiveRiskScorer } from '../AdaptiveRiskScorer';
import { buildDynamicKnowledgeGraph, clusterMemoriesIntoWardrobes } from '../../lib/memoryDomains';
import { isKnownCanonicalKey, canonicalizeKey } from '../../lib/memoryKeySchema';

describe('Human-OS / Nova 360 Comprehensive Regression Corpus (Sections 33, 34, 52)', () => {

  describe('1. Family & Friends Entity Ownership (Bug Class #1)', () => {
    test('Example A: "Ijaz father was in the Navy" attaches to Ijaz->Father, not User', () => {
      const res = entityResolutionService.resolveTurn("Ijaz's father was in the Navy.");
      const navyFact = res.facts.find(f => f.value.toLowerCase() === 'navy');
      expect(navyFact).toBeDefined();
      expect(navyFact?.subjectEntityId).toBe('entity:person_ijaz_father');
      expect(navyFact?.isDirectUserFact).toBe(false);
      expect(navyFact?.canonicalKey).toBe('entity:person_ijaz_father:military_service');
      expect(navyFact?.canonicalKey).not.toBe('father_occupation');
    });

    test('Example B: "Sushant wife works in banking" attaches to Sushant->Wife, not User', () => {
      const res = entityResolutionService.resolveTurn("Sushant's wife works in banking.");
      const wifeFact = res.facts.find(f => f.value.toLowerCase() === 'banking');
      expect(wifeFact).toBeDefined();
      expect(wifeFact?.subjectEntityId).toBe('entity:person_sushant_wife');
      expect(wifeFact?.isDirectUserFact).toBe(false);
      expect(wifeFact?.canonicalKey).toBe('entity:person_sushant_wife:occupation');
      expect(wifeFact?.canonicalKey).not.toBe('wife_occupation');
    });

    test('Example C: "My friend brother lives in Dubai" attaches to Friend->Brother', () => {
      const res = entityResolutionService.resolveTurn("My friend's brother lives in Dubai.");
      const locFact = res.facts.find(f => f.value.toLowerCase() === 'dubai');
      expect(locFact).toBeDefined();
      expect(locFact?.subjectEntityId).toBe('entity:person_friend_brother');
      expect(locFact?.canonicalKey).toBe('entity:person_friend_brother:location');
      expect(locFact?.isDirectUserFact).toBe(false);
    });

    test('Example D: "My father met Ejaz yesterday" keeps User Father and Ejaz as distinct entities', () => {
      const res = entityResolutionService.resolveTurn("My father met Ejaz yesterday.");
      const ejaz = res.entities.find(e => e.name.toLowerCase() === 'ejaz');
      const father = res.entities.find(e => e.name.toLowerCase().includes('father'));
      expect(ejaz).toBeDefined();
      expect(father).toBeDefined();
      expect(ejaz?.id).not.toBe(father?.id);
    });

    test('Example E: "Ejaz told me his father retired" attaches retired to Ejaz father, not Ejaz or User', () => {
      const res = entityResolutionService.resolveTurn("Ejaz told me his father retired.");
      const retiredFact = res.facts.find(f => f.value.toLowerCase().includes('retired'));
      expect(retiredFact).toBeDefined();
      expect(retiredFact?.subjectEntityId).toBe('entity:person_ejaz_father');
      expect(retiredFact?.isDirectUserFact).toBe(false);
    });

    test('Example F: "My wife likes the same restaurant that Ejaz wife likes" keeps two wives separate', () => {
      const res = entityResolutionService.resolveTurn("My wife likes the same restaurant that Ejaz's wife likes.");
      const ejazWife = res.entities.find(e => e.id.includes('ejaz_wife'));
      expect(ejazWife).toBeDefined();
      expect(ejazWife?.isDirectUserRelation).toBe(false);
    });
  });

  describe('2. Canonical Key Schema Invariants', () => {
    test('Entity-scoped keys are recognized as known canonical keys', () => {
      expect(isKnownCanonicalKey('entity:person_ijaz_father:military_service')).toBe(true);
      expect(isKnownCanonicalKey('entity:person_sushant_wife:occupation')).toBe(true);
      expect(isKnownCanonicalKey('entity:person_friend_brother:location')).toBe(true);
    });

    test('CanonicalizeKey preserves valid entity-scoped keys identically', () => {
      const { canonical, wasAliased } = canonicalizeKey('entity:person_ijaz_father:military_service');
      expect(canonical).toBe('entity:person_ijaz_father:military_service');
      expect(wasAliased).toBe(false);
      expect(isKnownCanonicalKey(canonical)).toBe(true);
    });

    test('Fixed child_birthdate canonicalizes to son_birth_date, NOT birth_date', () => {
      const { canonical } = canonicalizeKey('child_birthdate');
      expect(canonical).toBe('son_birth_date');
      expect(canonical).not.toBe('birth_date');
    });
  });

  describe('3. Dynamic Knowledge Graph Multi-Hop Branches (Section 20 & 21)', () => {
    test('Dynamic KG preserves User -> Friend -> Father -> Attribute hierarchy', () => {
      const memories = [
        { key: 'entity:person_ejaz_father:military_service', value: 'Navy' },
        { key: 'entity:person_sushant_wife:occupation', value: 'Banking' },
        { key: 'father_occupation', value: 'Teacher' },
      ];

      const kg = buildDynamicKnowledgeGraph(memories, [], 'Sagar');
      const nodes = kg.nodes;
      const edges = kg.edges;

      const ejazFatherNode = nodes.find(n => n.id === 'mem-entity-ejaz-father');
      const navyNode = nodes.find(n => n.raw_key === 'entity:person_ejaz_father:military_service');
      const userFatherOccNode = nodes.find(n => n.id === 'mem-father_occupation');

      expect(ejazFatherNode).toBeDefined();
      expect(navyNode).toBeDefined();
      expect(userFatherOccNode).toBeDefined();

      expect(navyNode?.parentEntityId).toBe('mem-entity-ejaz-father');
      expect(navyNode?.parentEntityId).not.toBe('user-core');
      expect(navyNode?.parentEntityId).not.toBe('mem-father_name');
    });

    test('Wardrobe synthesis clusters entity-scoped facts into separate entity wardrobe', () => {
      const memories = [
        { key: 'entity:person_ejaz_father:military_service', value: 'Navy' },
        { key: 'wife_name', value: 'Sakshi' },
        { key: 'son_name', value: 'Shreshth' }
      ];

      const { wardrobes } = clusterMemoriesIntoWardrobes(memories as any, []);
      const ejazWardrobe = wardrobes.find(w => w.name.includes('Ejaz') || w.id.includes('ejaz'));
      expect(ejazWardrobe).toBeDefined();
      expect(ejazWardrobe?.name).toBe('Ejaz Father');
      const navyTrait = ejazWardrobe?.traits.find(t => t.key.includes('military_service'));
      expect(navyTrait).toBeDefined();
      expect(navyTrait?.value).toBe('Navy');
    });
  });

  describe('4. Adaptive Risk Scorer (Section 13)', () => {
    test('Routine conversational greeting is LOW risk (0 overhead)', () => {
      const risk = adaptiveRiskScorer.evaluate('Good morning Nova, how are you today?', []);
      expect(risk.tier).toBe('LOW');
      expect(risk.requiresMultiModelCheck).toBe(false);
    });

    test('Kinship and occupation mention is MEDIUM or HIGH risk', () => {
      const risk = adaptiveRiskScorer.evaluate("Ijaz's father was in the Navy.", [
        { key: 'entity:person_ijaz_father:military_service', value: 'Navy' }
      ], { activeEntitiesCount: 2 });
      expect(risk.tier).toBe('HIGH');
      expect(risk.requiresMultiModelCheck).toBe(true);
    });

    test('Explicit correction triggers HIGH risk escalation', () => {
      const risk = adaptiveRiskScorer.evaluate("Actually, that is Ejaz's father, not my father.", [], {
        hasCorrections: true
      });
      expect(risk.tier).toBe('HIGH');
      expect(risk.requiresMultiModelCheck).toBe(true);
    });
  });

  describe('5. Temporal Validity (Section 9)', () => {
    test('"I used to work at Google" is resolved with PAST temporalState', () => {
      const res = entityResolutionService.resolveTurn("I used to work at Google.");
      const fact = res.facts.find(f => f.value.toLowerCase().includes('google'));
      expect(fact?.temporalState).toBe('PAST');
    });

    test('"I work at Conviction HR" is resolved with CURRENT temporalState', () => {
      const res = entityResolutionService.resolveTurn("I work at Conviction HR.");
      const fact = res.facts.find(f => f.value.toLowerCase().includes('conviction'));
      expect(fact?.temporalState).toBe('CURRENT');
    });

    test('"I will open a cloud kitchen next month" is resolved with FUTURE temporalState', () => {
      const res = entityResolutionService.resolveTurn("I will open a cloud kitchen next month.");
      const fact = res.facts.find(f => f.value.toLowerCase().includes('cloud kitchen'));
      expect(fact?.temporalState).toBe('FUTURE');
    });
  });
});
