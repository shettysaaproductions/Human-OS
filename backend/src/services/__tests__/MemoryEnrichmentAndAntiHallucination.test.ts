import { MemoryEnrichmentEngine } from '../MemoryEnrichmentEngine';
import { promptBuilder } from '../promptBuilder';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { buildDynamicKnowledgeGraph, classifyDomain } from '../../lib/memoryDomains';
import { ReminderIntentDetector } from '../ReminderIntentDetector';

describe('Memory Enrichment Engine & Anti-Hallucination Shield', () => {
  describe('1. MemoryEnrichmentEngine Sparse Node Detection', () => {
    it('detects sparse artist bubble and generates natural curiosity angle for missing music depth', () => {
      const memories = [
        { key: 'profession', value: 'artist' },
        { key: 'career_milestone_mtv_hustle', value: 'Top 5 in MTV Hustle Season 1' }
      ];
      const sparse = MemoryEnrichmentEngine.detectSparseNodes(memories, []);
      expect(sparse.length).toBeGreaterThan(0);
      const artistNode = sparse.find(s => s.nodeKey === 'profession_artist');
      expect(artistNode).toBeDefined();
      expect(artistNode?.title).toBe('Artist & Music Career');
      expect(artistNode?.missingAttributes).toContain('current tracks / released songs');
      expect(artistNode?.curiosityAngle).toContain('tracks');
    });

    it('detects sparse friend bubble and generates natural curiosity for bond/habits', () => {
      const memories = [
        { key: 'friend_name', value: 'Sushant' }
      ];
      const sparse = MemoryEnrichmentEngine.detectSparseNodes(memories, []);
      const friendNode = sparse.find(s => s.nodeKey === 'friend_sushant');
      expect(friendNode).toBeDefined();
      expect(friendNode?.title).toContain('Sushant');
      expect(friendNode?.missingAttributes.length).toBeGreaterThanOrEqual(2);
      expect(friendNode?.curiosityAngle).toContain('Sushant');
    });

    it('does not flag friend as sparse when relation, habit, and since are already known', () => {
      const memories = [
        { key: 'friend_name', value: 'Sushant' },
        { key: 'friend_sushant_relation', value: 'Childhood Friend' },
        { key: 'friend_sushant_habit', value: 'Smoking Partner' },
        { key: 'friend_sushant_since', value: '15 years' }
      ];
      const sparse = MemoryEnrichmentEngine.detectSparseNodes(memories, []);
      const friendNode = sparse.find(s => s.nodeKey === 'friend_sushant');
      expect(friendNode).toBeUndefined();
    });

    it('buildCuriosityDirectiveBlock formats structured prompt instruction', () => {
      const sparse = [
        {
          nodeKey: 'profession_artist',
          title: 'Artist & Music Career',
          existingContext: 'Artist, Top 5 in MTV Hustle',
          missingAttributes: ['genre', 'tracks'],
          curiosityAngle: 'Music scene mein kaunse style ya naye tracks pe kaam chal raha hai?'
        }
      ];
      const block = MemoryEnrichmentEngine.buildCuriosityDirectiveBlock(sparse);
      expect(block).toContain('SPARSE MEMORY BUBBLES — NOVA\'S CURIOSITY DIRECTIVE');
      expect(block).toContain('Artist & Music Career');
      expect(block).toContain('Music scene mein');
    });
  });

  describe('2. Anti-Hallucination Shield in PromptBuilder', () => {
    it('injects ANTI-HALLUCINATION SHIELD at the top of buildSystemPrompt', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base prompt',
        [{ id: 'm1', user_id: 'u1', key: 'profession', value: 'artist', memory: 'artist', memory_type: 'work', created_at: new Date().toISOString() }],
        [],
        'Aman',
        'Warm Companion',
        [],
        'hi',
        undefined,
        'HUMAN_CHAT',
        'SITUATION BRIEF: Active chat'
      );

      expect(prompt).toContain('ANTI-HALLUCINATION SHIELD (HIGHEST PRIORITY — ZERO TOLERANCE)');
      expect(prompt).toContain('ZERO PRETRAINING PUBLIC-FIGURE OVERRIDE');
      expect(prompt).toContain('UNKNOWN_IS_NOT_TRUE');
      expect(prompt).toContain('MTV Hustle');
      expect(prompt).toContain('Gully Boy');
    });

    it('injects sparse node curiosity directive when sparse bubbles exist', () => {
      const prompt = promptBuilder.buildSystemPrompt(
        'Base prompt',
        [
          { id: 'm1', user_id: 'u1', key: 'profession', value: 'artist', memory: 'artist', memory_type: 'work', created_at: new Date().toISOString() },
          { id: 'm2', user_id: 'u1', key: 'career_milestone_mtv_hustle', value: 'Top 5 Season 1', memory: 'Top 5 Season 1', memory_type: 'work', created_at: new Date().toISOString() }
        ],
        [],
        'Aman',
        'Warm Companion',
        [],
        'auto',
        undefined,
        'HUMAN_CHAT'
      );

      expect(prompt).toContain('SPARSE MEMORY BUBBLES — NOVA\'S CURIOSITY DIRECTIVE');
      expect(prompt).toContain('Artist & Music Career');
    });
  });

  describe('3. Dynamic Graph Branching for Creative Milestones & Friends', () => {
    it('classifies career_milestone into work domain', () => {
      const meta = classifyDomain('career_milestone_mtv_hustle', 'work');
      expect(meta.domain).toBe('work');
    });

    it('builds Level 2 Artist branch and Level 3 Milestone stems in graph', () => {
      const memories = [
        { id: 'm1', user_id: 'u1', key: 'profession', value: 'artist', memory: 'artist', memory_type: 'work', created_at: new Date().toISOString() },
        { id: 'm2', user_id: 'u1', key: 'career_milestone_mtv_hustle', value: 'Top 5 in MTV Hustle Season 1', memory: 'Top 5 in MTV Hustle Season 1', memory_type: 'work', created_at: new Date().toISOString() },
        { id: 'm3', user_id: 'u1', key: 'career_milestone_gully_boy', value: 'Part of Gully Boy movie', memory: 'Part of Gully Boy movie', memory_type: 'work', created_at: new Date().toISOString() },
        { id: 'm4', user_id: 'u1', key: 'artist_genre', value: 'Hip-Hop / Rap', memory: 'Hip-Hop / Rap', memory_type: 'work', created_at: new Date().toISOString() },
      ];

      const graph = buildDynamicKnowledgeGraph(memories as any);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Artist & Music Career'))).toBe(true);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Top 5 in MTV Hustle Season 1'))).toBe(true);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Part of Gully Boy movie'))).toBe(true);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Hip-Hop / Rap'))).toBe(true);
    });

    it('builds friend sub-branches for relations and shared habits', () => {
      const memories = [
        { id: 'm1', user_id: 'u1', key: 'friend_name', value: 'Sushant', memory: 'Sushant', memory_type: 'family', created_at: new Date().toISOString() },
        { id: 'm2', user_id: 'u1', key: 'friend_sushant_relation', value: 'Childhood Friend', memory: 'Childhood Friend', memory_type: 'family', created_at: new Date().toISOString() },
        { id: 'm3', user_id: 'u1', key: 'friend_sushant_habit', value: 'Smoking Partner', memory: 'Smoking Partner', memory_type: 'family', created_at: new Date().toISOString() },
      ];

      const graph = buildDynamicKnowledgeGraph(memories as any);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Sushant (Friend)'))).toBe(true);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Childhood Friend'))).toBe(true);
      expect(graph.nodes.some(n => (n.name + ' ' + n.value).includes('Smoking Partner'))).toBe(true);
    });
  });

  describe('4. TurnAnalyzer Deterministic Extraction for Milestones & Friends', () => {
    it('extracts MTV Hustle season and rank deterministically', () => {
      const result = TurnAnalyzer.analyze([
        { role: 'user', message: 'i was in mtv hustle season 1 and came in top 5' }
      ]);
      const facts = result.units.filter(u => u.type === 'fact');
      const hustleFact = facts.find(f => f.factKey === 'career_milestone_mtv_hustle');
      expect(hustleFact).toBeDefined();
      expect(hustleFact?.factValue).toContain('MTV Hustle');
      expect(hustleFact?.factValue).toContain('Top 5');
    });

    it('extracts Gully Boy movie participation deterministically', () => {
      const result = TurnAnalyzer.analyze([
        { role: 'user', message: 'was also a part of gullyboy movie' }
      ]);
      const facts = result.units.filter(u => u.type === 'fact');
      const movieFact = facts.find(f => f.factKey === 'career_milestone_gully_boy');
      expect(movieFact).toBeDefined();
      expect(movieFact?.factValue).toContain('Gully Boy');
    });

    it('extracts friend relationship and shared habit without trailing copulas', () => {
      const result = TurnAnalyzer.analyze([
        { role: 'user', message: 'sushant mera childhood friend hai aur hum smoking partner hain' }
      ]);
      const facts = result.units.filter(u => u.type === 'fact');
      const relFact = facts.find(f => f.factKey === 'friend_sushant_relation');
      const habitFact = facts.find(f => f.factKey === 'friend_sushant_habit');
      expect(relFact).toBeDefined();
      expect(relFact?.factValue.toLowerCase()).toBe('childhood friend');
      expect(habitFact).toBeDefined();
      expect(habitFact?.factValue.toLowerCase()).toBe('smoking partner');
    });
  });

  describe('5. Reminder Non-Pestering Intent & Deduplication', () => {
    const detector = ReminderIntentDetector.getInstance();

    it('detects future workout with explicit time', () => {
      expect(detector.hasFuturePlanIntent('kal subah 8 baje gym jana hai')).toBe(true);
    });

    it('does not trigger on casual immediate chore without future/routine anchor', () => {
      expect(detector.hasFuturePlanIntent('mujhe khana banana hai')).toBe(false);
      expect(detector.hasFuturePlanIntent('office ja raha hoon')).toBe(false);
    });
  });
});
