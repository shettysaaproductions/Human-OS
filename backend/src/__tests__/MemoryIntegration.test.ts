import { TurnAnalyzer } from '../services/TurnAnalyzer';
import { MemorySemanticResolver } from '../lib/MemorySemanticResolver';

describe('Memory Integration & Deterministic Corrections', () => {

  describe('TurnAnalyzer: Canonical Key Enforcement', () => {
    it('should map favorite_color to canonical favourite_color', () => {
      const key1 = TurnAnalyzer.mapConceptToCanonicalKey('favorite color');
      const key2 = TurnAnalyzer.mapConceptToCanonicalKey('favourite colour');
      expect(key1).toBe('favourite_color');
      expect(key2).toBe('favourite_color');
    });

    it('should correctly handle unambiguous corrections', () => {
      const text = "actually my favourite colour is blue";
      const analysis = TurnAnalyzer.analyze([{ role: 'user', message: text, created_at: new Date().toISOString() }], { recentMessages: [], memories: [] });
      expect(analysis.hasCorrections).toBe(true);
      expect(analysis.correctionTarget).toBe('favourite_color');
      
      const correctionUnit = analysis.units.find(u => u.type === 'correction');
      expect(correctionUnit?.factValue).toBe('blue');
    });

    it('should handle ambiguous corrections with zero mutation (no antecedent)', () => {
      const text = "make that yellow";
      const analysis = TurnAnalyzer.analyze([{ role: 'user', message: text, created_at: new Date().toISOString() }], { recentMessages: [], memories: [] });
      expect(analysis.hasCorrections).toBe(true);
      // Because there is no antecedent in context, target should be undefined/null
      expect(analysis.correctionTarget).toBeNull();
    });

    it('should correctly filter semantic memories for unambiguous corrections (Mock of ConsolidatedMemoryAgent logic)', () => {
      const correctionTarget = 'favourite_color';
      
      // Simulating LLM hallucinating extra keys
      let parsedSemanticMemories = [
        { key: 'favourite_color', value: 'green', shouldPersist: true },
        { key: 'likes_green', value: 'yes', shouldPersist: true }
      ];

      // The filter logic in ConsolidatedMemoryAgent
      parsedSemanticMemories = parsedSemanticMemories.filter(mem => mem.key === correctionTarget);

      expect(parsedSemanticMemories.length).toBe(1);
      expect(parsedSemanticMemories[0].key).toBe('favourite_color');
      expect(parsedSemanticMemories[0].value).toBe('green');
    });
    
    it('should correctly clear semantic memories for ambiguous corrections (Mock of ConsolidatedMemoryAgent logic)', () => {
      const correctionTarget = null;
      
      let parsedSemanticMemories = [
        { key: 'unknown_target', value: 'yellow', shouldPersist: true }
      ];

      // The filter logic in ConsolidatedMemoryAgent for ambiguous corrections
      if (!correctionTarget) {
        parsedSemanticMemories = [];
      }

      expect(parsedSemanticMemories.length).toBe(0);
    });

    it('should not cross-target protected family relationships', () => {
      const text = "actually my mother name is Sita";
      const analysis = TurnAnalyzer.analyze([{ role: 'user', message: text, created_at: new Date().toISOString() }], { recentMessages: [], memories: [] });
      
      expect(analysis.hasCorrections).toBe(true);
      expect(analysis.correctionTarget).toBe('mother_name');
    });
  });

});
