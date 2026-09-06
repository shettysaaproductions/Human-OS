import { validateTurn } from '../../lib/SemanticValidator';
import { SemanticTurn, SemanticAction } from '../../lib/SemanticInterpreter';

describe('Semantic Integration - State Transition Validations (Step 7)', () => {

  const makeTurn = (overrides: Partial<SemanticTurn> = {}): SemanticTurn => ({
    turnId: 'turn-test-01',
    sourceMessageId: 'msg-01',
    intent: 'MIXED',
    facts: [],
    corrections: [],
    actions: [],
    clarification: { required: false },
    confidence: 0.95,
    ...overrides
  });

  describe('Scenario: Working Memory / Goal Negation', () => {
    it('should extract negated goal as GOAL_UPDATE with abandoned status', () => {
      // Simulate "cloud kitchen abhi start nahi kar raha hoon"
      const turn = makeTurn({
        intent: 'GOAL_UPDATE',
        actions: [{
          type: 'GOAL_UPDATE',
          data: {
            goal_name: 'cloud kitchen',
            status: 'abandoned',
            target_fact_key: 'current_project'
          },
          completenessScore: 1.0,
          missingFields: []
        }]
      });
      const result = validateTurn(turn, "cloud kitchen abhi start nahi kar raha hoon");
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].data?.status).toBe('abandoned');
    });

    it('should extract paused goal as GOAL_UPDATE with paused status', () => {
      // Simulate "cloud kitchen abhi hold pe rakha hai"
      const turn = makeTurn({
        intent: 'GOAL_UPDATE',
        actions: [{
          type: 'GOAL_UPDATE',
          data: {
            goal_name: 'cloud kitchen',
            status: 'paused',
            target_fact_key: 'current_project'
          },
          completenessScore: 1.0,
          missingFields: []
        }]
      });
      const result = validateTurn(turn, "cloud kitchen abhi hold pe rakha hai");
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].data?.status).toBe('paused');
    });
  });

  describe('Scenario: Clarification Check (Ambiguous Reminder)', () => {
    it('sets requiresClarification for incomplete reminder', () => {
      const turn = makeTurn({
        intent: 'REMINDER',
        actions: [{
          type: 'REMINDER',
          data: { task: 'doctor appointment' },
          completenessScore: 0.5,
          missingFields: ['exact_time']
        }]
      });
      const result = validateTurn(turn, "remind me about doctor appointment");
      expect(result.requiresClarification).toBe(true);
      expect(result.clarificationQuestion).toBeTruthy();
    });
  });

  describe('Scenario: False Commitment (Passive Acknowledgement)', () => {
    it('should not extract passive acknowledgements as actionable intents when responding to suggestions', () => {
      // Assistant: "You could start a cloud kitchen."
      // User: "Okay."
      const turn = makeTurn({
        intent: 'CHAT',
        facts: [],
        actions: [],
        corrections: []
      });
      const result = validateTurn(turn, "Okay.");
      expect(result.actions).toHaveLength(0);
      expect(result.facts).toHaveLength(0);
      expect(result.corrections).toHaveLength(0);
    });

    it('should extract explicit user commitments as actionable goal intents', () => {
      // User: "Yes, I want to start the cloud kitchen."
      const turn = makeTurn({
        intent: 'GOAL_UPDATE',
        facts: [],
        actions: [{
          type: 'GOAL_UPDATE',
          data: {
            goal_name: 'cloud kitchen',
            status: 'active',
            target_fact_key: 'current_project'
          },
          completenessScore: 1.0,
          missingFields: []
        }],
        corrections: []
      });
      const result = validateTurn(turn, "Yes, I want to start the cloud kitchen.");
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('GOAL_UPDATE');
      expect(result.actions[0].data?.status).toBe('active');
    });
  });

  describe('Scenario: User Isolation (Self-referential checks)', () => {
    it('should reject malformed self-referential relations', () => {
      const turn = makeTurn({
        intent: 'MEMORY',
        facts: [{
          concept: 'wife_name',
          value: 'wife',
          confidence: 0.9,
          groundedInTurn: true
        }]
      });
      const result = validateTurn(turn, "my wife's name is wife");
      expect(result.facts).toHaveLength(0); // Validated to empty
    });
  });

  describe('Scenario: Multiple Reminders in Mixed Turn', () => {
    it('should process multiple independent reminder actions without truncation', () => {
      const turn = makeTurn({
        intent: 'MIXED',
        actions: [
          {
            type: 'REMINDER',
            data: { task: 'office meeting', time_of_day: '16:00' },
            completenessScore: 1.0,
            missingFields: []
          },
          {
            type: 'REMINDER',
            data: { task: 'buy groceries', relative_value: 2, relative_unit: 'hours' },
            completenessScore: 1.0,
            missingFields: []
          }
        ]
      });
      const result = validateTurn(turn, "remind me about office at 4 PM and buy groceries in 2 hours");
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].type).toBe('REMINDER');
      expect(result.actions[1].type).toBe('REMINDER');
    });
  });
});
