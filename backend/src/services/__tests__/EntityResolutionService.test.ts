import { entityResolutionService } from '../EntityResolutionService';

describe('EntityResolutionService — 360° Semantic Entity & Reference Resolution', () => {
  describe('Example A: "Ijaz\'s father was in the Navy"', () => {
    it('correctly attributes Navy military service to Ijaz\'s father, NOT the user\'s father', () => {
      const result = entityResolutionService.resolveTurn("Ijaz's father was in the Navy.");
      
      expect(result.primarySubjectId).toBe('entity:person_ijaz_father');
      
      const facts = result.facts;
      expect(facts.length).toBe(1);
      expect(facts[0].subjectEntityId).toBe('entity:person_ijaz_father');
      expect(facts[0].subjectEntityName).toBe("Ijaz's father");
      expect(facts[0].predicate).toBe('military_service');
      expect(facts[0].value).toBe('Navy');
      expect(facts[0].canonicalKey).toBe('entity:person_ijaz_father:military_service');
      expect(facts[0].temporalState).toBe('PAST');

      // Crucial invariant: The user's father must NOT be created as the owner
      const userFather = result.entities.find(e => e.id === 'user:father');
      expect(userFather).toBeUndefined();

      // Ijaz and Ijaz's father must be present as distinct non-direct entities
      const ijaz = result.entities.find(e => e.id === 'entity:person_ijaz');
      expect(ijaz).toBeDefined();
      expect(ijaz?.name).toBe('Ijaz');
      expect(ijaz?.isDirectUserRelation).toBe(false);

      const ijazFather = result.entities.find(e => e.id === 'entity:person_ijaz_father');
      expect(ijazFather).toBeDefined();
      expect(ijazFather?.parentEntityId).toBe('entity:person_ijaz');
      expect(ijazFather?.isDirectUserRelation).toBe(false);
    });

    it('handles Hinglish variant "Ejaz ke papa Navy me the"', () => {
      const result = entityResolutionService.resolveTurn('Ejaz ke papa Navy me the');
      expect(result.primarySubjectId).toBe('entity:person_ejaz_father');
      expect(result.facts[0].value).toBe('Navy');
      expect(result.facts[0].canonicalKey).toBe('entity:person_ejaz_father:military_service');
      expect(result.facts[0].temporalState).toBe('PAST');
    });
  });

  describe('Example B: "Sushant\'s wife works in banking"', () => {
    it('correctly attributes banking occupation to Sushant\'s wife, NOT the user\'s wife', () => {
      const result = entityResolutionService.resolveTurn("Sushant's wife works in banking.");

      expect(result.primarySubjectId).toBe('entity:person_sushant_wife');
      const fact = result.facts[0];
      expect(fact.subjectEntityId).toBe('entity:person_sushant_wife');
      expect(fact.predicate).toBe('occupation');
      expect(fact.value).toBe('Banking');
      expect(fact.canonicalKey).toBe('entity:person_sushant_wife:occupation');

      const userWife = result.entities.find(e => e.id === 'user:wife');
      expect(userWife).toBeUndefined();
    });

    it('handles Hinglish variant "Sushant ki biwi banking me hai"', () => {
      const result = entityResolutionService.resolveTurn('Sushant ki biwi banking me hai');
      expect(result.primarySubjectId).toBe('entity:person_sushant_wife');
      expect(result.facts[0].value).toBe('Banking');
      expect(result.facts[0].canonicalKey).toBe('entity:person_sushant_wife:occupation');
    });
  });

  describe('Example C: "My friend\'s brother lives in Dubai"', () => {
    it('correctly attributes Dubai location to Friend\'s brother, NOT user\'s brother', () => {
      const result = entityResolutionService.resolveTurn("My friend's brother lives in Dubai.");

      expect(result.primarySubjectId).toBe('entity:person_friend_brother');
      const fact = result.facts[0];
      expect(fact.predicate).toBe('location');
      expect(fact.value).toBe('Dubai');
      expect(fact.canonicalKey).toBe('entity:person_friend_brother:location');

      const userBrother = result.entities.find(e => e.id === 'user:brother');
      expect(userBrother).toBeUndefined();
    });

    it('handles Hinglish variant "Mere dost ka bhai Dubai me rehta hai"', () => {
      const result = entityResolutionService.resolveTurn('Mere dost ka bhai Dubai me rehta hai');
      expect(result.primarySubjectId).toBe('entity:person_friend_brother');
      expect(result.facts[0].value).toBe('Dubai');
    });
  });

  describe('Example D: "My father met Ejaz yesterday"', () => {
    it('correctly distinguishes User\'s father as direct relation', () => {
      const result = entityResolutionService.resolveTurn('My father was in the Navy');
      expect(result.primarySubjectId).toBe('user:father');
      expect(result.facts[0].canonicalKey).toBe('father_occupation');
      expect(result.facts[0].value).toBe('Navy');
      
      const userFather = result.entities.find(e => e.id === 'user:father');
      expect(userFather).toBeDefined();
      expect(userFather?.isDirectUserRelation).toBe(true);
    });
  });

  describe('Example E: "Ejaz told me his father retired"', () => {
    it('correctly attributes retirement to Ejaz\'s father, not Ejaz and not user\'s father', () => {
      const result = entityResolutionService.resolveTurn('Ejaz told me his father retired');
      expect(result.primarySubjectId).toBe('entity:person_ejaz_father');
      expect(result.facts[0].subjectEntityId).toBe('entity:person_ejaz_father');
      expect(result.facts[0].predicate).toBe('status');
      expect(result.facts[0].value).toBe('Retired');
      expect(result.facts[0].temporalState).toBe('PAST');
    });
  });

  describe('Direct user relations vs third-party separation', () => {
    it('assigns user father to standard canonical key "father_name"', () => {
      const result = entityResolutionService.resolveTurn('My father is Suresh');
      expect(result.primarySubjectId).toBe('user:father');
      expect(result.facts[0].canonicalKey).toBe('father_name');
      expect(result.facts[0].value).toBe('Suresh');
    });

    it('assigns user wife to standard canonical key "wife_name"', () => {
      const result = entityResolutionService.resolveTurn('Meri wife ka naam Sakshi hai');
      expect(result.primarySubjectId).toBe('user:wife');
      expect(result.facts[0].canonicalKey).toBe('wife_name');
      expect(result.facts[0].value).toBe('Sakshi');
    });
  });
});
