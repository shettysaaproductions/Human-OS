import { TurnAnalyzer } from '../TurnAnalyzer';
import { canonicalizeKey, isAliasKey, sameCanonicalConcept } from '../../lib/memoryKeySchema';
import { clusterMemoriesIntoWardrobes, buildDynamicKnowledgeGraph } from '../../lib/memoryDomains';

describe('Son Shreshth Nickname (Tuku) & Date of Birth Alignment', () => {

  describe('1. TurnAnalyzer Deterministic Fact Extraction', () => {
    test('Extracts both son_name (Shreshth) and son_nickname (Tuku) from "my son shreshth nick name is tuku"', () => {
      const text = 'my son shreshth nick name is tuku';
      const analysis = TurnAnalyzer.analyze(text);
      const sonName = analysis.units.find(u => u.factKey === 'son_name');
      const sonNick = analysis.units.find(u => u.factKey === 'son_nickname');

      expect(sonName).toBeDefined();
      expect(sonName?.factValue).toBe('Shreshth');
      expect(sonNick).toBeDefined();
      expect(sonNick?.factValue).toBe('Tuku');
    });

    test('Extracts both son_name and son_nickname from Hinglish "mere bete shreshth ka nickname tuku hai"', () => {
      const text = 'mere bete shreshth ka nickname tuku hai';
      const analysis = TurnAnalyzer.analyze(text);
      const sonName = analysis.units.find(u => u.factKey === 'son_name');
      const sonNick = analysis.units.find(u => u.factKey === 'son_nickname');

      expect(sonName).toBeDefined();
      expect(sonName?.factValue).toBe('Shreshth');
      expect(sonNick).toBeDefined();
      expect(sonNick?.factValue).toBe('Tuku');
    });

    test('Extracts son_nickname from "shreshth ka nickname tuku hai"', () => {
      const text = 'shreshth ka nickname tuku hai';
      const analysis = TurnAnalyzer.analyze(text);
      const sonNick = analysis.units.find(u => u.factKey === 'son_nickname');

      expect(sonNick).toBeDefined();
      expect(sonNick?.factValue).toBe('Tuku');
    });

    test('Deterministic extraction of son_birth_date from "my son shreshth date of birth is 17/02/2026"', () => {
      const text = 'my son shreshth date of birth is 17/02/2026';
      const analysis = TurnAnalyzer.analyze(text);
      const sonDob = analysis.units.find(u => u.factKey === 'son_birth_date');

      expect(sonDob).toBeDefined();
      expect(sonDob?.factValue).toBe('17/02/2026');
    });

    test('Deterministic extraction of son_birth_date from "shreshth birthday is 17 Feb 2026"', () => {
      const text = "shreshth's birthday is 17 Feb 2026";
      const analysis = TurnAnalyzer.analyze(text);
      const sonDob = analysis.units.find(u => u.factKey === 'son_birth_date');

      expect(sonDob).toBeDefined();
      expect(sonDob?.factValue).toBe('17 Feb 2026');
    });

    test('Deterministic extraction of wife_birth_date from "wife birthday is 23 july"', () => {
      const text = "wife's birthday is 23 july";
      const analysis = TurnAnalyzer.analyze(text);
      const wifeDob = analysis.units.find(u => u.factKey === 'wife_birth_date');

      expect(wifeDob).toBeDefined();
      expect(wifeDob?.factValue).toBe('23 July');
    });
  });

  describe('2. Canonical Schema Aliases for Tuku', () => {
    test('Canonicalizes tuku and tuku_nickname to son_nickname', () => {
      expect(canonicalizeKey('tuku').canonical).toBe('son_nickname');
      expect(canonicalizeKey('tuku_nickname').canonical).toBe('son_nickname');
      expect(canonicalizeKey('son_tuku').canonical).toBe('son_nickname');
      expect(canonicalizeKey('shreshth_tuku').canonical).toBe('son_nickname');
    });

    test('Canonicalizes tuku_dob and tuku_birthday to son_birth_date', () => {
      expect(canonicalizeKey('tuku_dob').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('tuku_birthday').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('tuku_birth_date').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('shreshth_bday').canonical).toBe('son_birth_date');
    });

    test('Recognizes tuku aliases as alias keys', () => {
      expect(isAliasKey('tuku')).toBe(true);
      expect(isAliasKey('tuku_dob')).toBe(true);
      expect(sameCanonicalConcept('tuku', 'son_nickname')).toBe(true);
      expect(sameCanonicalConcept('tuku_dob', 'son_birth_date')).toBe(true);
    });
  });

  describe('3. Memory Wardrobe Traits for Shreshth', () => {
    test('Builds dedicated Birth Date trait and sets Nickname to Tuku', () => {
      const memories = [
        { id: '1', key: 'son_name', value: 'Shreshth', memory_type: 'family' },
        { id: '2', key: 'son_nickname', value: 'Tuku', memory_type: 'family' },
        { id: '3', key: 'son_birth_date', value: '17/02/2026', memory_type: 'family' },
      ];

      const { wardrobes } = clusterMemoriesIntoWardrobes(memories as any, []);
      const sonWardrobe = wardrobes.find(w => w.id === 'wardrobe-person-shreshth');

      expect(sonWardrobe).toBeDefined();
      expect(sonWardrobe?.entityType).toBe('person');

      const nickTrait = sonWardrobe?.traits.find(t => t.key === 'son_nickname');
      expect(nickTrait).toBeDefined();
      expect(nickTrait?.value).toBe('Tuku');

      const bdayTrait = sonWardrobe?.traits.find(t => t.id === 'trait-shreshth-birth-date');
      expect(bdayTrait).toBeDefined();
      expect(bdayTrait?.label).toBe('Birth Date');
      expect(bdayTrait?.value).toBe('17/02/2026');

      const ageTrait = sonWardrobe?.traits.find(t => t.key === 'son_age');
      expect(ageTrait).toBeDefined();
      expect(ageTrait?.value).toContain('months old');
    });
  });

  describe('4. Dynamic Knowledge Graph Hierarchy', () => {
    test('Renders Son branch with Tuku Nickname and 17/02/2026 Birthday stems', () => {
      const memories = [
        { id: '1', key: 'son_name', value: 'Shreshth', memory_type: 'family' },
        { id: '2', key: 'son_nickname', value: 'Tuku', memory_type: 'family' },
        { id: '3', key: 'son_birth_date', value: '17/02/2026', memory_type: 'family' },
      ];

      const kg = buildDynamicKnowledgeGraph(memories, [], 'User');

      const sonNode = kg.nodes.find(n => n.id === 'mem-son_name');
      expect(sonNode).toBeDefined();
      expect(sonNode?.name).toBe('Shreshth (Son)');

      const nickNode = kg.nodes.find(n => n.id === 'mem-son_nickname');
      expect(nickNode).toBeDefined();
      expect(nickNode?.name).toBe('Tuku (Nickname)');

      const bdayNode = kg.nodes.find(n => n.id === 'mem-son_birth_date');
      expect(bdayNode).toBeDefined();
      expect(bdayNode?.name).toBe('17/02/2026 (Birthday)');

      // Verify edges connect to son node
      const nickEdge = kg.edges.find(e => e.target === 'mem-son_nickname');
      expect(nickEdge?.source).toBe('mem-son_name');
      expect(nickEdge?.relation).toBe('NICKNAME');

      const bdayEdge = kg.edges.find(e => e.target === 'mem-son_birth_date');
      expect(bdayEdge?.source).toBe('mem-son_name');
      expect(bdayEdge?.relation).toBe('BIRTHDAY');
    });
  });
});
