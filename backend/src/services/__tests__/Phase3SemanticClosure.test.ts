/**
 * Phase3SemanticClosure.test.ts
 *
 * Dedicated tests for Phase 3 Semantic Closure:
 * A. Reusable Semantic Entity Typing (no hardcoded person assumption)
 * B. Multi-Script Entity Convergence (Sakshi / साक्षी, Unicode-safe slugs)
 * C. Authoritative Canonical Relationships with Inverse Semantics & Idempotent Projection
 * D. Graph Determinism: Parent Bubble Resolution Regardless of DB Row Order
 */

// Mock Supabase before importing services
let mockBubblesReturn: any[] = [];
let mockMemoriesReturn: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'memory_bubbles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: mockBubblesReturn, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'memories') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: () => ({
                  neq: () => Promise.resolve({ data: mockMemoriesReturn, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    }),
  },
}));

import { inferSemanticEntityType } from '../../lib/entitySemanticValidator';
import { generateCanonicalSlug } from '../../lib/indicTransliteration';
import { canonicalEntityEngine, INVERSE_RELATIONS } from '../CanonicalEntityEngine';
import { canonicalGraphService } from '../CanonicalGraphService';

describe('Phase 3 Semantic Closure Test Suite', () => {
  describe('Area A: Reusable Semantic Entity Type Classification', () => {
    it('infers pet/animal breeds without hardcoding', () => {
      expect(inferSemanticEntityType('Rottweiler', 'family')).toBe('pet');
      expect(inferSemanticEntityType('Labrador', 'lifestyle')).toBe('pet');
      expect(inferSemanticEntityType('German Shepherd', 'family')).toBe('pet');
      expect(inferSemanticEntityType('Golden Retriever')).toBe('pet');
      expect(inferSemanticEntityType('Persian Cat', 'lifestyle')).toBe('pet');
      expect(inferSemanticEntityType('Bruno', 'family', 'dog')).toBe('pet');
    });

    it('infers events and celebrations without hardcoding', () => {
      expect(inferSemanticEntityType('Ganpati Celebrations', 'lifestyle')).toBe('event');
      expect(inferSemanticEntityType('Diwali Party', 'lifestyle')).toBe('event');
      expect(inferSemanticEntityType('Annual Gathering', 'work')).toBe('event');
      expect(inferSemanticEntityType('Ganesh Chaturthi Pooja', 'lifestyle')).toBe('event');
    });

    it('infers roles, habits, and relational concepts', () => {
      expect(inferSemanticEntityType('Smoking Partner', 'lifestyle')).toBe('role');
      expect(inferSemanticEntityType('Friend', 'lifestyle')).toBe('role');
      expect(inferSemanticEntityType('Hr', 'family')).toBe('role');
      expect(inferSemanticEntityType('Since College', 'lifestyle')).toBe('concept');
      expect(inferSemanticEntityType('Name Not Specified', 'lifestyle')).toBe('concept');
    });

    it('infers organizations and ventures', () => {
      expect(inferSemanticEntityType('Conviction HR Ltd', 'work')).toBe('organization');
      expect(inferSemanticEntityType('Google LLC', 'work')).toBe('organization');
      expect(inferSemanticEntityType('Shetty Productions', 'work')).toBe('organization');
    });

    it('infers real people as person', () => {
      expect(inferSemanticEntityType('Suresh', 'family', 'Father')).toBe('person');
      expect(inferSemanticEntityType('Rajeshree', 'family', 'Mother')).toBe('person');
      expect(inferSemanticEntityType('Sakshi', 'family', 'Wife')).toBe('person');
      expect(inferSemanticEntityType('साक्षी', 'family', 'Wife')).toBe('person');
      expect(inferSemanticEntityType('Shreshth', 'family', 'Son')).toBe('person');
      expect(inferSemanticEntityType('Sushant', 'family', 'Friend')).toBe('person');
      expect(inferSemanticEntityType('Ijaz', 'family', 'Friend')).toBe('person');
    });
  });

  describe('Area B: Multilingual & Multi-Script Entity Convergence', () => {
    it('generates identical canonical slugs for Devanagari and Latin representations', () => {
      const latinSlug = generateCanonicalSlug('Sakshi');
      const devanagariSlug = generateCanonicalSlug('साक्षी');
      expect(latinSlug).toBe('sakshi');
      expect(devanagariSlug).toBe('sakshi');
      expect(latinSlug).toBe(devanagariSlug);
    });

    it('never produces an empty slug for any script or symbol combination', () => {
      expect(generateCanonicalSlug('')).toMatch(/^unnamed_/);
      expect(generateCanonicalSlug('   ')).toMatch(/^unnamed_/);
      expect(generateCanonicalSlug('साक्षी')).toBe('sakshi');
      expect(generateCanonicalSlug('सुरेश')).toBe('suresh');
      expect(generateCanonicalSlug('राजेश्री')).toBe('rajeshri');
      expect(generateCanonicalSlug('श्रेयस')).toBe('shreyas');
      expect(generateCanonicalSlug('티쿠')).toBeTruthy();
      expect(generateCanonicalSlug('티쿠').length).toBeGreaterThan(0);
      expect(generateCanonicalSlug('!!!???')).toMatch(/^entity_/);
    });

    it('normalizes slugs via CanonicalEntityEngine with multi-script awareness', () => {
      expect(canonicalEntityEngine.normalizeSlug('साक्षी')).toBe('sakshi');
      expect(canonicalEntityEngine.normalizeSlug('Sakshi')).toBe('sakshi');
      expect(canonicalEntityEngine.normalizeSlug('सुरेश')).toBe('suresh');
      expect(canonicalEntityEngine.normalizeSlug('Suresh')).toBe('suresh');
    });
  });

  describe('Area C: Canonical Relationships & Inverses', () => {
    it('has complete inverse semantic mappings for core relations', () => {
      expect(INVERSE_RELATIONS['father']).toBe('child');
      expect(INVERSE_RELATIONS['mother']).toBe('child');
      expect(INVERSE_RELATIONS['husband']).toBe('wife');
      expect(INVERSE_RELATIONS['wife']).toBe('husband');
      expect(INVERSE_RELATIONS['son']).toBe('parent');
      expect(INVERSE_RELATIONS['daughter']).toBe('parent');
      expect(INVERSE_RELATIONS['friend']).toBe('friend');
      expect(INVERSE_RELATIONS['colleague']).toBe('colleague');
    });
  });

  describe('Area D: Graph Determinism (Row-Order Independence)', () => {
    it('resolves parent_bubble_id correctly even if child appears before parent in array', async () => {
      const mockUserId = 'test-user-determinism';

      // Simulate reverse order: child bubble appears at index 0, parent bubble at index 1
      const childBubble = {
        id: 'child-bubble-uuid',
        label: 'Rottweiler',
        slug: 'entity:pet_rottweiler',
        bubble_type: 'entity',
        domain_key: 'family',
        relation_type: 'Pet Dog',
        parent_bubble_id: 'parent-bubble-uuid', // Points to parent
        metadata: { entity_type: 'pet' },
        updated_at: new Date().toISOString(),
      };

      const parentBubble = {
        id: 'parent-bubble-uuid',
        label: 'Sakshi',
        slug: 'entity:sakshi',
        bubble_type: 'entity',
        domain_key: 'family',
        relation_type: 'Wife',
        parent_bubble_id: null,
        metadata: { entity_type: 'person' },
        updated_at: new Date().toISOString(),
      };

      // Set mock return: child FIRST, parent SECOND
      mockBubblesReturn = [childBubble, parentBubble];
      mockMemoriesReturn = [];

      const result = await canonicalGraphService.getCanonicalKnowledgeGraph(mockUserId);
      const childNode = result.nodes.find((n) => n.id === 'bubble-child-bubble-uuid');
      const parentNode = result.nodes.find((n) => n.id === 'bubble-parent-bubble-uuid');

      expect(childNode).toBeDefined();
      expect(parentNode).toBeDefined();
      // Verifies parentEntityId resolved to parent bubble, NOT default department trunk!
      expect(childNode!.parentEntityId).toBe('bubble-parent-bubble-uuid');
      expect(childNode!.entity_type).toBe('pet');
      expect(childNode!.emoji).toBe('🐾');

      // Verify the edge connects parent to child
      const hierarchyEdge = result.edges.find(
        (e) => e.source === 'bubble-parent-bubble-uuid' && e.target === 'bubble-child-bubble-uuid'
      );
      expect(hierarchyEdge).toBeDefined();
    });
  });
});
