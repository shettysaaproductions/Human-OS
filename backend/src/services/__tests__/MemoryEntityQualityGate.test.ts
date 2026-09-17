import { isValidEntityName, isValidMemoryAttributeValue } from '../../lib/entitySemanticValidator';
import { isGarbageMemoryValue } from '../../lib/memoryFilters';
import { canonicalMemoryTreeService } from '../CanonicalMemoryTreeService';
import { buildDynamicKnowledgeGraph } from '../../lib/memoryDomains';

describe('MemoryEntityQualityGate & Semantic Validation Test Suite', () => {
  describe('isValidEntityName', () => {
    it('should accept valid multi-character personal names', () => {
      expect(isValidEntityName('Sakshi', 'person').isValid).toBe(true);
      expect(isValidEntityName('Shreshth', 'person').isValid).toBe(true);
      expect(isValidEntityName('Sushant', 'person').isValid).toBe(true);
      expect(isValidEntityName('Vikram', 'person').isValid).toBe(true);
    });

    it('should accept legitimate 2-character short names', () => {
      expect(isValidEntityName('Om', 'person').isValid).toBe(true);
      expect(isValidEntityName('Al', 'person').isValid).toBe(true);
      expect(isValidEntityName('Bo', 'person').isValid).toBe(true);
      expect(isValidEntityName('Jo', 'person').isValid).toBe(true);
      expect(isValidEntityName('Ty', 'person').isValid).toBe(true);
      expect(isValidEntityName('Mo', 'person').isValid).toBe(true);
      expect(isValidEntityName('Ed', 'person').isValid).toBe(true);
    });

    it('should reject Hindi/Hinglish grammatical particles and postpositions as entity names', () => {
      expect(isValidEntityName('ka', 'person').isValid).toBe(false);
      expect(isValidEntityName('ki', 'person').isValid).toBe(false);
      expect(isValidEntityName('ke', 'person').isValid).toBe(false);
      expect(isValidEntityName('ko', 'person').isValid).toBe(false);
      expect(isValidEntityName('se', 'person').isValid).toBe(false);
      expect(isValidEntityName('me', 'person').isValid).toBe(false);
      expect(isValidEntityName('mein', 'person').isValid).toBe(false);
      expect(isValidEntityName('par', 'person').isValid).toBe(false);
      expect(isValidEntityName('pe', 'person').isValid).toBe(false);
      expect(isValidEntityName('ne', 'person').isValid).toBe(false);
    });

    it('should reject Hindi/Hinglish verbs and light verbs as entity names', () => {
      expect(isValidEntityName('Kar', 'person').isValid).toBe(false);
      expect(isValidEntityName('kar', 'person').isValid).toBe(false);
      expect(isValidEntityName('karo', 'person').isValid).toBe(false);
      expect(isValidEntityName('karein', 'person').isValid).toBe(false);
      expect(isValidEntityName('karna', 'person').isValid).toBe(false);
      expect(isValidEntityName('karke', 'person').isValid).toBe(false);
      expect(isValidEntityName('kiya', 'person').isValid).toBe(false);
      expect(isValidEntityName('rehta', 'person').isValid).toBe(false);
      expect(isValidEntityName('rehta hai', 'person').isValid).toBe(false);
      expect(isValidEntityName('utha', 'person').isValid).toBe(false);
      expect(isValidEntityName('dena', 'person').isValid).toBe(false);
    });

    it('should reject common generic nouns and kinship roles as named entities', () => {
      expect(isValidEntityName('office', 'person').isValid).toBe(false);
      expect(isValidEntityName('washroom', 'person').isValid).toBe(false);
      expect(isValidEntityName('son', 'person').isValid).toBe(false);
      expect(isValidEntityName('beta', 'person').isValid).toBe(false);
      expect(isValidEntityName('friend', 'person').isValid).toBe(false);
      expect(isValidEntityName('dost', 'person').isValid).toBe(false);
    });
  });

  describe('isValidMemoryAttributeValue', () => {
    it('should validate name attributes and reject verbs or postpositions', () => {
      expect(isValidMemoryAttributeValue('son_name', 'Shreshth').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('son_name', 'Kar').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('son_nickname', 'Ke').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('wife_name', 'Sakshi').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('wife_name', 'ka').isValid).toBe(false);
    });

    it('should validate location attributes and reject verbs or fragments', () => {
      expect(isValidMemoryAttributeValue('friend_location', 'Kandivali, Mumbai').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('friend_location', 'Rehta hai').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('home_location', 'Bandra West').isValid).toBe(true);
    });

    it('should reject tautological or generic relationship attribute values', () => {
      expect(isValidMemoryAttributeValue('friend_attribute', 'friend').isValid).toBe(false);
      expect(isValidMemoryAttributeValue('son_attribute', 'son').isValid).toBe(false);
    });

    it('should allow valid temporal and schedule values', () => {
      expect(isValidMemoryAttributeValue('office_salary_day', '5th day of every month').isValid).toBe(true);
      expect(isValidMemoryAttributeValue('son_age', '6 months old').isValid).toBe(true);
    });
  });

  describe('isGarbageMemoryValue integration', () => {
    it('should catch corrupted values caught in live database forensics', () => {
      expect(isGarbageMemoryValue('son_name', 'Kar', 'test')).toBe(true);
      expect(isGarbageMemoryValue('son_nickname', 'Ke', 'test')).toBe(true);
      expect(isGarbageMemoryValue('friend_location', 'Rehta hai', 'test')).toBe(true);
      expect(isGarbageMemoryValue('friend_attribute', 'friend', 'test')).toBe(true);
    });

    it('should preserve legitimate user memories', () => {
      expect(isGarbageMemoryValue('son_name', 'Shreshth', 'test')).toBe(false);
      expect(isGarbageMemoryValue('son_nickname', 'Tuku', 'test')).toBe(false);
      expect(isGarbageMemoryValue('wife_name', 'Sakshi', 'test')).toBe(false);
      expect(isGarbageMemoryValue('office_salary_day', '5th day of every month', 'test')).toBe(false);
      expect(isGarbageMemoryValue('son_age', '6 months old', 'test')).toBe(false);
    });
  });

  describe('CanonicalMemoryTreeService isInvalidEntityName', () => {
    it('should reject corrupted entity bubble labels', () => {
      expect(canonicalMemoryTreeService.isInvalidEntityName('Kar')).toBe(true);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Ke')).toBe(true);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Office')).toBe(true);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Rehta hai')).toBe(true);
    });

    it('should accept valid entity names', () => {
      expect(canonicalMemoryTreeService.isInvalidEntityName('Sakshi')).toBe(false);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Shreshth')).toBe(false);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Sushant')).toBe(false);
      expect(canonicalMemoryTreeService.isInvalidEntityName('Om')).toBe(false);
    });
  });

  describe('buildDynamicKnowledgeGraph self-healing & resilience', () => {
    it('should self-heal corrupted son_name and son_nickname to canonical truths and reject verbs', () => {
      const corruptedMemories = [
        { key: 'son_name', value: 'Kar', memory_type: 'family' },
        { key: 'son_nickname', value: 'Ke', memory_type: 'family' },
        { key: 'son_age', value: '6 months old', memory_type: 'family' },
        { key: 'office_salary_day', value: '5th day of every month', memory_type: 'work' },
        { key: 'friend_location', value: 'Rehta hai', memory_type: 'lifestyle' },
        { key: 'friend_attribute', value: 'friend', memory_type: 'lifestyle' }
      ];

      const graph = buildDynamicKnowledgeGraph(corruptedMemories, [], 'Saa');

      // 1. Check that son_name is self-healed and has "Shreshth (Son)"
      const sonNode = graph.nodes.find(n => n.raw_key === 'son_name' || n.id === 'mem-son_name');
      expect(sonNode).toBeDefined();
      expect(sonNode?.name).toContain('Shreshth');
      expect(sonNode?.name).not.toContain('Kar');

      // 2. Check that son_nickname is self-healed to "Tuku (Nickname)"
      const nickNode = graph.nodes.find(n => n.raw_key === 'son_nickname' || n.id === 'mem-son_nickname');
      expect(nickNode).toBeDefined();
      expect(nickNode?.name).toContain('Tuku');
      expect(nickNode?.name).not.toContain('Ke');

      // 3. Check that office_salary_day is cleanly formatted as Salary Day
      const salaryNode = graph.nodes.find(n => n.raw_key === 'office_salary_day' || n.id === 'mem-office_salary_day');
      expect(salaryNode).toBeDefined();
      expect(salaryNode?.name).toContain('Salary Day');

      // 4. Corrupted friend memories should be excluded completely
      const friendLocNode = graph.nodes.find(n => n.raw_key === 'friend_location' || n.id === 'mem-friend_location');
      expect(friendLocNode).toBeUndefined();

      const friendAttrNode = graph.nodes.find(n => n.raw_key === 'friend_attribute' || n.id === 'mem-friend_attribute');
      expect(friendAttrNode).toBeUndefined();

      // 5. No nodes named "Kar", "Ke", or "Rehta hai" should exist anywhere in the graph
      const rogueNode = graph.nodes.find(n => ['kar', 'ke', 'rehta hai'].includes(n.name.toLowerCase().trim()));
      expect(rogueNode).toBeUndefined();
    });
  });
});
