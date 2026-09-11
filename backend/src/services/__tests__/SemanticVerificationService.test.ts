import { adaptiveRiskScorer } from '../AdaptiveRiskScorer';
import { semanticVerificationService } from '../SemanticVerificationService';
import { ResolvedFact } from '../EntityResolutionService';

// Mock supabaseAdmin
jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: [], error: null })
          })
        })
      })
    })
  }
}));

describe('AdaptiveRiskScorer & SemanticVerificationService (Sections 12-15)', () => {
  describe('1. AdaptiveRiskScorer', () => {
    it('rates simple casual conversation as LOW risk', () => {
      const result = adaptiveRiskScorer.evaluate('Hello good morning, how are you today?');
      expect(result.tier).toBe('LOW');
      expect(result.score).toBeLessThan(30);
      expect(result.requiresMultiModelCheck).toBe(false);
    });

    it('rates explicit correction as elevated risk', () => {
      const result = adaptiveRiskScorer.evaluate('Actually, that is wrong, uska naam Rajesh nahi hai.');
      expect(result.score).toBeGreaterThanOrEqual(35);
      expect(result.factors.some(f => f.name === 'EXPLICIT_CORRECTION')).toBe(true);
    });

    it('rates complex multi-entity kinship with third party facts as HIGH risk', () => {
      const result = adaptiveRiskScorer.evaluate(
        "Ijaz's father was in the Navy, but Sushant's wife works in banking.",
        [{ key: 'entity:person_ijaz_father:military_service', value: 'Navy' }]
      );
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.requiresMultiModelCheck).toBe(true);
    });
  });

  describe('2. SemanticVerificationService (Multi-Model Compounding & Self-Audit)', () => {
    it('detects and autonomously repairs entity misattribution when third party kinship is misassigned to user', async () => {
      const mockFact: ResolvedFact = {
        subjectEntityId: 'user',
        subjectEntityName: 'User',
        predicate: 'military_service',
        value: 'Navy',
        canonicalKey: 'father_occupation', // Misattributed to user father!
        temporalState: 'PAST',
        confidence: 0.95
      };

      const result = await semanticVerificationService.verifyTurn({
        userId: 'test-user-1',
        sourceMessageId: 'msg-999',
        userMessage: "Ijaz's father was in the Navy.",
        generatedResponse: "That's wonderful! Navy service requires great discipline.",
        candidateFacts: [mockFact],
        currentMemories: []
      });

      expect(result.entityAttributionAccurate).toBe(false);
      expect(result.repairedFacts[0].canonicalKey).toBe('entity:person_ijaz_father:military_service');
      expect(result.repairedFacts[0].subjectEntityId).toBe('entity:person_ijaz_father');
    });

    it('detects when Nova incorrectly claims third party entity belongs to the user', async () => {
      const result = await semanticVerificationService.verifyTurn({
        userId: 'test-user-1',
        userMessage: "Ejaz's father was in the Navy.",
        generatedResponse: "Tumhare papa Navy me the, yeh sunkar bohot garv hua!", // Hallucinated user's father!
        candidateFacts: [],
        currentMemories: []
      });

      expect(result.responseGrounded).toBe(false);
      expect(result.disagreements).toContain('RESPONSE_GROUNDING_FAILURE: Nova addressed third party entity as user\'s father');
    });

    it('confirms 100% valid grounding when attribution and response are correct', async () => {
      const correctFact: ResolvedFact = {
        subjectEntityId: 'entity:person_ejaz_father',
        subjectEntityName: "Ejaz's father",
        predicate: 'military_service',
        value: 'Navy',
        canonicalKey: 'entity:person_ejaz_father:military_service',
        temporalState: 'PAST',
        confidence: 0.95
      };

      const result = await semanticVerificationService.verifyTurn({
        userId: 'test-user-1',
        userMessage: "Ejaz's father was in the Navy.",
        generatedResponse: "Got it, Ejaz's father served in the Navy. That is a prestigious service!",
        candidateFacts: [correctFact],
        currentMemories: []
      });

      expect(result.isValid).toBe(true);
      expect(result.entityAttributionAccurate).toBe(true);
      expect(result.responseGrounded).toBe(true);
      expect(result.auditMetrics.semanticConfidence).toBe(1.0);
    });
  });
});
