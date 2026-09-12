import { entityRelationshipCorrectionService } from '../EntityRelationshipCorrectionService';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { classifyDomain, buildDynamicKnowledgeGraph, clusterMemoriesIntoWardrobes } from '../../lib/memoryDomains';

describe('Entity Relationship Correction & Branch Severing Engine', () => {
  describe('1. Pattern Detection & Extraction', () => {
    it('detects user exact prompt with speech typos ("is is my office frind")', () => {
      const input = 'Ijaz is not my family member is is my office frind';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.oldRelation).toContain('family');
      expect(correction?.newRelation).toBe('Office Friend');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects standard English correction with punctuation', () => {
      const input = 'Ijaz is not my family member, he is my office friend.';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.newRelation).toBe('Office Friend');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects colleague reclassification', () => {
      const input = 'Actually Ijaz is not my brother, he is my colleague at work.';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.oldRelation).toBe('brother');
      expect(correction?.newRelation).toBe('Colleague');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects modal prompt format ("Regarding memory: [Ijaz]: ... - Ijaz is not family member")', () => {
      const input = 'Regarding memory: [Ijaz]: "Friend" - Ijaz is not my family member, he is my office friend';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.newRelation).toBe('Office Friend');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects Hinglish phrasing ("Ijaz family member nahi hai, office ka dost hai")', () => {
      const input = 'Ijaz family member nahi hai, office ka dost hai';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects move/reassign command ("Move Ijaz from family to office friends branch")', () => {
      const input = 'Move Ijaz from family to office friends branch';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects reversed assertion ("Ijaz is my office friend, not a family member")', () => {
      const input = 'Ijaz is my office friend, not a family member';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Ijaz');
      expect(correction?.newDomain).toBe('work');
    });

    it('ignores unrelated regular messages', () => {
      expect(entityRelationshipCorrectionService.detectEntityCorrection('Kal subah 9 baje meeting hai')).toBeNull();
      expect(entityRelationshipCorrectionService.detectEntityCorrection('I had lunch with my brother')).toBeNull();
    });
  });

  describe('2. TurnAnalyzer Integration', () => {
    it('populates entityCorrection and sets hasCorrections in TurnAnalyzer', () => {
      const turn = TurnAnalyzer.analyze([{ message: 'Ijaz is not my family member is is my office frind' }]);

      expect(turn.hasCorrections).toBe(true);
      expect(turn.entityCorrection).toBeDefined();
      expect(turn.entityCorrection?.entityName).toBe('Ijaz');
      expect(turn.entityCorrection?.newDomain).toBe('work');

      const corrUnit = turn.units.find(u => u.type === 'correction' && u.factKey === 'colleague_ijaz');
      expect(corrUnit).toBeDefined();
      expect(corrUnit?.relationship).toBe('Office Friend');
    });
  });

  describe('3. Domain & Knowledge Graph Dynamic Classification', () => {
    it('classifies colleague and office friend keys under work domain', () => {
      expect(classifyDomain('colleague_ijaz').domain).toBe('work');
      expect(classifyDomain('office_friend_ijaz').domain).toBe('work');
      expect(classifyDomain('friend_ijaz', 'work').domain).toBe('work');
    });

    it('builds dynamic KG with Ijaz attached to dept-work (severed from dept-family)', () => {
      const memories = [
        { id: 'mem-1', key: 'colleague_ijaz', value: 'Ijaz is an Office Friend', memory_type: 'work' },
        { id: 'mem-2', key: 'company_name', value: 'Conviction HR', memory_type: 'work' },
        { id: 'mem-3', key: 'wife_name', value: 'Sakshi', memory_type: 'family' }
      ];

      const graph = buildDynamicKnowledgeGraph(memories, [], 'Saa');

      // 1. Ijaz node must exist and belong to work department
      const ijazNode = graph.nodes.find(n => n.name.includes('Ijaz'));
      expect(ijazNode).toBeDefined();
      expect(ijazNode?.department).toBe('work');
      expect(ijazNode?.parentEntityId).toBe('dept-work');
      expect(ijazNode?.treePath).toContain('Career & Professional');
      expect(ijazNode?.treePath).not.toContain('Family & Relationships');

      // 2. Edge for Ijaz must originate from dept-work, NOT dept-family
      const ijazEdge = graph.edges.find(e => e.target === ijazNode?.id);
      expect(ijazEdge).toBeDefined();
      expect(ijazEdge?.source).toBe('dept-work');
      expect(ijazEdge?.relation).toBe('OFFICE_FRIEND_BRANCH');

      const familyEdgeToIjaz = graph.edges.find(e => e.source === 'dept-family' && e.target === ijazNode?.id);
      expect(familyEdgeToIjaz).toBeUndefined();
    });

    it('clusters Ijaz into an Office Friend wardrobe under work domain', () => {
      const memories = [
        { id: 'mem-1', key: 'colleague_ijaz', value: 'Ijaz is an Office Friend', memory_type: 'work' },
        { id: 'mem-2', key: 'wife_name', value: 'Sakshi', memory_type: 'family' }
      ];

      const { wardrobes } = clusterMemoriesIntoWardrobes(memories, []);

      const ijazWardrobe = wardrobes.find(w => w.name.toLowerCase().includes('ijaz'));
      expect(ijazWardrobe).toBeDefined();
      expect(ijazWardrobe?.domain).toBe('work');
      expect(ijazWardrobe?.roleTitle).toContain('Office Friend');
      expect(ijazWardrobe?.avatarEmoji).toBe('👔');
    });
  });

  describe('4. Nova Acknowledgment Generation', () => {
    it('generates warm, natural best-friend reply confirming branch transfer', () => {
      const correction = {
        entityName: 'Ijaz',
        oldRelation: 'family member',
        oldDomain: 'family' as const,
        newRelation: 'Office Friend',
        newDomain: 'work' as const,
        rawText: 'Ijaz is not my family member is is my office frind'
      };

      const reply = entityRelationshipCorrectionService.generateNovaReply(correction);
      expect(reply).toContain('Ijaz');
      expect(reply).toContain('family se hata kar');
      expect(reply).toContain('office friends / work branch me shift kar diya hai');
    });
  });
});
