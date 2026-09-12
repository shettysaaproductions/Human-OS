import { entityRelationshipCorrectionService } from '../EntityRelationshipCorrectionService';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { classifyDomain, buildDynamicKnowledgeGraph, clusterMemoriesIntoWardrobes } from '../../lib/memoryDomains';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

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

    it('detects instrument to career reclassification ("Guitar is not my hobby, it is my full time profession")', () => {
      const input = 'Guitar is not my hobby, it is my full time profession';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Guitar');
      expect(correction?.oldRelation).toBe('hobby');
      expect(correction?.oldDomain).toBe('lifestyle');
      expect(correction?.newRelation).toBe('Full Time Profession');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects pet species correction ("Coco is not my cat, he is my pet dog")', () => {
      const input = 'Coco is not my cat, he is my pet dog';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Coco');
      expect(correction?.oldRelation).toBe('cat');
      expect(correction?.newRelation).toBe('Pet Dog');
      expect(correction?.newDomain).toBe('family');
    });

    it('detects tech stack / project reclassification ("React is not a side project, it is my core tech stack")', () => {
      const input = 'React is not a side project, it is my core tech stack';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('React');
      expect(correction?.oldRelation).toBe('side project');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects location / identity correction ("Mumbai is not a vacation trip, that is my home city")', () => {
      const input = 'Mumbai is not a vacation trip, that is my home city';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Mumbai');
      expect(correction?.oldRelation).toBe('vacation trip');
      expect(correction?.newDomain).toBe('identity');
    });

    it('detects health / diet restriction ("Keto is not a casual diet, it is my medical restriction")', () => {
      const input = 'Keto is not a casual diet, it is my medical restriction';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Keto');
      expect(correction?.oldRelation).toBe('casual diet');
      expect(correction?.newRelation).toBe('Medical Restriction');
    });

    it('detects routine / habit shift ("Morning run is not an occasional hobby, it is my daily routine")', () => {
      const input = 'Morning run is not an occasional hobby, it is my daily routine';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Morning Run');
      expect(correction?.oldRelation).toBe('occasional hobby');
      expect(correction?.newRelation).toBe('Daily Routine');
    });

    it('detects move commands for arbitrary topics ("Move tennis from sports to fitness routine")', () => {
      const input = 'Move tennis from sports to fitness routine';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Tennis');
      expect(correction?.oldRelation).toBe('sports');
      expect(correction?.newRelation).toBe('Fitness Routine');
    });

    it('detects "don\'t put under" commands ("Don\'t put BMW under travel, put it under cars")', () => {
      const input = "Don't put BMW under travel, put it under cars";
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Bmw');
      expect(correction?.oldRelation).toBe('travel');
      expect(correction?.newRelation).toBe('Cars');
    });

    it('detects Hinglish random topics ("Guitar mera timepass nahi hai, career hai")', () => {
      const input = 'Guitar mera timepass nahi hai, career hai';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.entityName).toBe('Guitar');
      expect(correction?.oldRelation).toBe('timepass');
      expect(correction?.newRelation).toBe('Career');
      expect(correction?.newDomain).toBe('work');
    });

    it('detects cross-branch attribute transfer: "my timing of office is not 8am it of my gym time"', () => {
      const input = 'my timing of office is not 8am it of my gym time';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.isAttributeTransfer).toBe(true);
      expect(correction?.entityName).toBe('8am');
      expect(correction?.transferredValue).toBe('8am');
      expect(correction?.oldRelation).toContain('office');
      expect(correction?.oldDomain).toBe('work');
      expect(correction?.newRelation).toBe('Gym Time');
      expect(correction?.newDomain).toBe('lifestyle');
      expect(correction?.targetKey).toBe('gym_time');
    });

    it('detects attribute transfer variation: "office timing is not 8am, it is of my gym time"', () => {
      const input = 'office timing is not 8am, it is of my gym time';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.isAttributeTransfer).toBe(true);
      expect(correction?.transferredValue).toBe('8am');
      expect(correction?.newRelation).toBe('Gym Time');
      expect(correction?.newDomain).toBe('lifestyle');
    });

    it('detects attribute transfer value-first: "8am is not my office time, it is my gym time"', () => {
      const input = '8am is not my office time, it is my gym time';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.isAttributeTransfer).toBe(true);
      expect(correction?.transferredValue).toBe('8am');
      expect(correction?.oldDomain).toBe('work');
      expect(correction?.newDomain).toBe('lifestyle');
    });

    it('detects Hinglish attribute transfer: "office timing 8am nahi hai, gym ka time hai"', () => {
      const input = 'office timing 8am nahi hai, gym ka time hai';
      const correction = entityRelationshipCorrectionService.detectEntityCorrection(input);

      expect(correction).not.toBeNull();
      expect(correction?.isAttributeTransfer).toBe(true);
      expect(correction?.transferredValue).toBe('8am');
      expect(correction?.newDomain).toBe('lifestyle');
    });

    it('ignores unrelated regular messages', () => {
      expect(entityRelationshipCorrectionService.detectEntityCorrection('Kal subah 9 baje meeting hai')).toBeNull();
      expect(entityRelationshipCorrectionService.detectEntityCorrection('I had lunch with my brother')).toBeNull();
    });
  });

  describe('2. Conversational Bubble Cascading Delete Detection', () => {
    it('detects user exact prompt: "in family i delete my pet bubble whose name was Tomy and its stems ware morning walk with him daily"', () => {
      const input = 'in family i delete my pet bubble whose name was Tomy and its stems ware morning walk with him daily';
      const deleteIntent = entityRelationshipCorrectionService.detectDeleteIntent(input);

      expect(deleteIntent).not.toBeNull();
      expect(deleteIntent?.isDelete).toBe(true);
      expect(deleteIntent?.entityName).toBe('Tomy');
      expect(deleteIntent?.cascade).toBe(true);
    });

    it('detects simple bubble deletion: "delete my pet bubble Tomy and all its stems"', () => {
      const input = 'delete my pet bubble Tomy and all its stems';
      const deleteIntent = entityRelationshipCorrectionService.detectDeleteIntent(input);

      expect(deleteIntent).not.toBeNull();
      expect(deleteIntent?.entityName).toBe('Tomy');
      expect(deleteIntent?.cascade).toBe(true);
    });

    it('detects conversational deletion: "delete Tomy bubble"', () => {
      const input = 'delete Tomy bubble';
      const deleteIntent = entityRelationshipCorrectionService.detectDeleteIntent(input);

      expect(deleteIntent).not.toBeNull();
      expect(deleteIntent?.entityName).toBe('Tomy');
      expect(deleteIntent?.cascade).toBe(true);
    });

    it('detects Hinglish deletion: "Tomy bubble ko delete kar do aur uske saare stems bhi"', () => {
      const input = 'Tomy bubble ko delete kar do aur uske saare stems bhi';
      const deleteIntent = entityRelationshipCorrectionService.detectDeleteIntent(input);

      expect(deleteIntent).not.toBeNull();
      expect(deleteIntent?.entityName).toBe('Tomy');
      expect(deleteIntent?.cascade).toBe(true);
    });

    it('detects "forget Tomy and all his details"', () => {
      const input = 'forget Tomy and all his details';
      const deleteIntent = entityRelationshipCorrectionService.detectDeleteIntent(input);

      expect(deleteIntent).not.toBeNull();
      expect(deleteIntent?.entityName).toBe('Tomy');
      expect(deleteIntent?.cascade).toBe(true);
    });

    it('does not falsely trigger delete on normal conversation', () => {
      expect(entityRelationshipCorrectionService.detectDeleteIntent('I took Tomy for a walk')).toBeNull();
      expect(entityRelationshipCorrectionService.detectDeleteIntent('Can you remind me about Tomy at 5pm?')).toBeNull();
    });
  });

  describe('3. TurnAnalyzer Integration', () => {
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

    it('populates attribute transfer unit in TurnAnalyzer', () => {
      const turn = TurnAnalyzer.analyze([{ message: 'my timing of office is not 8am it of my gym time' }]);

      expect(turn.hasCorrections).toBe(true);
      expect(turn.entityCorrection).toBeDefined();
      expect(turn.entityCorrection?.isAttributeTransfer).toBe(true);
      expect(turn.entityCorrection?.transferredValue).toBe('8am');
      expect(turn.entityCorrection?.targetKey).toBe('gym_time');

      const corrUnit = turn.units.find(u => u.type === 'correction' && u.factKey === 'gym_time');
      expect(corrUnit).toBeDefined();
      expect(corrUnit?.factValue).toBe('8am');
      expect(corrUnit?.memoryDomain).toBe('lifestyle');
    });
  });

  describe('4. Domain & Knowledge Graph Dynamic Classification', () => {
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

  describe('5. Nova Acknowledgment Generation', () => {
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

    it('generates attribute transfer reply confirming time shift', () => {
      const correction = {
        entityName: '8am',
        transferredValue: '8am',
        oldRelation: 'office timing',
        oldDomain: 'work' as const,
        newRelation: 'Gym Time',
        newDomain: 'lifestyle' as const,
        isAttributeTransfer: true,
        rawText: 'my timing of office is not 8am it of my gym time'
      };

      const reply = entityRelationshipCorrectionService.generateNovaReply(correction);
      expect(reply).toContain('8am');
      expect(reply).toContain('office timing');
      expect(reply).toContain('Gym Time');
    });

    it('generates cascading delete confirmation reply', () => {
      const deleteResult = {
        success: true,
        entityName: 'Tomy',
        deletedStemsCount: 3,
        cancelledRemindersCount: 1,
        deletedStemNames: ['morning walk with him daily', 'food details', 'breed'],
        cancelledReminderTexts: ['Walk Tomy at 6:30am'],
        message: 'Deleted'
      };

      const reply = entityRelationshipCorrectionService.generateCascadingDeleteReply(deleteResult);
      expect(reply).toContain('Tomy');
      expect(reply).toContain('delete kar diya hai');
      expect(reply).toContain('3 connected stems');
      expect(reply).toContain('1 connected reminder(s) cancel');
    });
  });

  describe('6. Cascading Bubble & Stem Deletion Engine Execution', () => {
    it('previews cascading delete accurately identifying stems and active reminders', async () => {
      const mockMemories = [
        { id: 'mem-root', key: 'pet_tomy', value: 'Tomy is my pet dog', memory_type: 'family' },
        { id: 'mem-stem1', key: 'morning_walk_tomy', value: 'Morning walk with him daily at 6:30am', memory_type: 'lifestyle' },
        { id: 'mem-stem2', key: 'pet_tomy_food', value: 'Pedigree and chicken', memory_type: 'lifestyle' },
        { id: 'mem-stem3', key: 'pet_tomy_breed', value: 'Golden Retriever', memory_type: 'family' },
        { id: 'mem-other', key: 'wife_name', value: 'Sakshi', memory_type: 'family' }
      ];

      const mockReminders = [
        { id: 'rem-1', text: 'Take Tomy for morning walk', due_time: '2026-09-13T06:30:00Z', status: 'pending' },
        { id: 'rem-2', text: 'Call electrician', due_time: '2026-09-13T10:00:00Z', status: 'pending' }
      ];

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: mockMemories })
            })
          };
        }
        if (table === 'reminders') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              neq: jest.fn().mockReturnValue({
                neq: jest.fn().mockResolvedValue({ data: mockReminders })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [] }) };
      });

      const preview = await entityRelationshipCorrectionService.previewCascadingDelete('user-1', {
        entityName: 'Tomy'
      });

      expect(preview.entityName).toBe('Tomy');
      expect(preview.stemsCount).toBe(3);
      expect(preview.stems.map(s => s.id)).toEqual(['mem-stem1', 'mem-stem2', 'mem-stem3']);
      expect(preview.remindersCount).toBe(1);
      expect(preview.reminders[0].text).toBe('Take Tomy for morning walk');
    });

    it('executes cascading delete, soft-tombstoning memories and cancelling reminders', async () => {
      const mockMemories = [
        { id: 'mem-root', key: 'pet_tomy', value: 'Tomy is my pet dog', memory_type: 'family' },
        { id: 'mem-stem1', key: 'morning_walk_tomy', value: 'Morning walk with him daily at 6:30am', memory_type: 'lifestyle' }
      ];
      const mockReminders = [
        { id: 'rem-1', text: 'Take Tomy for morning walk', due_time: '2026-09-13T06:30:00Z', status: 'pending' }
      ];

      const memoryUpdateSpy = jest.fn();
      const reminderUpdateSpy = jest.fn();
      const workingMemoryDeleteSpy = jest.fn();
      const kgEdgesDeleteSpy = jest.fn();
      const kgNodesDeleteSpy = jest.fn();

      const createChain = (resolveData: any = null) => {
        const chain: any = {
          select: jest.fn(() => chain),
          update: jest.fn((...args) => {
            memoryUpdateSpy(...args);
            return chain;
          }),
          delete: jest.fn((...args) => {
            workingMemoryDeleteSpy(...args);
            return chain;
          }),
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
          eq: jest.fn(() => chain),
          neq: jest.fn(() => chain),
          in: jest.fn(() => chain),
          or: jest.fn(() => chain),
          then: (resolve: any) => Promise.resolve({ data: resolveData, error: null }).then(resolve)
        };
        return chain;
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return createChain(mockMemories);
        }
        if (table === 'reminders') {
          const remChain = createChain(mockReminders);
          remChain.update = jest.fn((...args) => {
            reminderUpdateSpy(...args);
            return remChain;
          });
          return remChain;
        }
        if (table === 'working_memory') {
          return createChain(null);
        }
        if (table === 'kg_nodes') {
          const knChain = createChain([{ id: 'kn-tomy', name: 'Tomy' }]);
          knChain.delete = jest.fn((...args) => {
            kgNodesDeleteSpy(...args);
            return knChain;
          });
          return knChain;
        }
        if (table === 'kg_edges') {
          const keChain = createChain([]);
          keChain.delete = jest.fn((...args) => {
            kgEdgesDeleteSpy(...args);
            return keChain;
          });
          return keChain;
        }
        if (table === 'nova_correction_ledger') {
          return createChain(null);
        }
        return createChain(null);
      });

      const result = await entityRelationshipCorrectionService.cascadingDeleteEntityBubble('user-1', {
        entityName: 'Tomy',
        reason: 'User deleted pet Tomy'
      });

      expect(result.success).toBe(true);
      expect(result.entityName).toBe('Tomy');
      expect(result.deletedStemsCount).toBe(1);
      expect(result.cancelledRemindersCount).toBe(1);
      expect(result.message).toContain('Permanently deleted "Tomy"');
      expect(memoryUpdateSpy).toHaveBeenCalled();
      expect(reminderUpdateSpy).toHaveBeenCalled();
      expect(workingMemoryDeleteSpy).toHaveBeenCalled();
    });
  });
});
