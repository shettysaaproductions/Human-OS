import { deterministicFactAgent } from '../DeterministicFactAgent';
import { factAssertionConsumer } from '../../consumers/FactAssertionConsumer';
import { goalAssertedConsumer } from '../../consumers/GoalAssertedConsumer';
import * as CorrectionPropagator from '../../services/CorrectionPropagator';

// Mock the consumers
jest.mock('../../consumers/FactAssertionConsumer', () => ({
  factAssertionConsumer: {
    consume: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../consumers/GoalAssertedConsumer', () => ({
  goalAssertedConsumer: {
    consume: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../services/CorrectionPropagator', () => ({
  propagateCorrection: jest.fn().mockResolvedValue({ fullySucceeded: true, scopes: [] })
}));

jest.mock('../../services/MemoryPolicyService', () => ({
  memoryPolicyService: {
    isMemoryEnabled: jest.fn().mockResolvedValue(true)
  }
}));

describe('DeterministicFactAgent (Phase 11 Canonical Routing)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Routes semanticEvents to canonical consumers correctly', async () => {
    const mockEvents = [
      {
        family: 'FactAsserted',
        eventId: 'evt-1',
        timestamp: new Date().toISOString(),
        canonicalKey: 'wife_name',
        value: 'Sakshi'
      },
      {
        family: 'GoalAsserted',
        eventId: 'evt-2',
        timestamp: new Date().toISOString(),
        goalKey: 'fitness',
        goalSpec: {
          topic: 'Fitness',
          description: 'Lose weight'
        }
      },
      {
        family: 'FactCorrected',
        eventId: 'evt-3',
        timestamp: new Date().toISOString(),
        canonicalKey: 'workplace',
        correctionSpec: {
          newValue: 'Google'
        }
      }
    ];

    await deterministicFactAgent.processJob({
      id: 'job-123',
      job_type: 'extract_deterministic_fact',
      payload: {
        userId: 'user-123',
        messageId: 'msg-123',
        turnId: 'turn-123',
        semanticEvents: mockEvents
      }
    });

    // Verify FactAssertionConsumer was called for FactAsserted
    expect(factAssertionConsumer.consume).toHaveBeenCalledTimes(1);
    expect(factAssertionConsumer.consume).toHaveBeenCalledWith(
      'user-123',
      [mockEvents[0]],
      undefined // sourceMessage
    );

    // Verify GoalAssertedConsumer was called for GoalAsserted
    expect(goalAssertedConsumer.consume).toHaveBeenCalledTimes(1);
    expect(goalAssertedConsumer.consume).toHaveBeenCalledWith(
      'user-123',
      [mockEvents[1]],
      'turn-123'
    );

    // Verify CorrectionPropagator was called for FactCorrected
    expect(CorrectionPropagator.propagateCorrection).toHaveBeenCalledTimes(1);
    expect(CorrectionPropagator.propagateCorrection).toHaveBeenCalledWith(
      'user-123',
      mockEvents[2]
    );
  });
});
