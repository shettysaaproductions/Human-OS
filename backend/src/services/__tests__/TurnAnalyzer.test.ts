import { TurnAnalyzer } from '../TurnAnalyzer';
import { deterministicFactAgent } from '../../agents/DeterministicFactAgent';
import { memoryRepository } from '../memoryRepository';

jest.mock('../memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('Phase 7: TurnAnalyzer & Conversational Intelligence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Mandatory 3-Message Turn Regression', () => {
    it('should detect all 3 facts and semantic units in order as HIGH_CONFIDENCE_DURABLE_FACT', () => {
      const messages = [
        { message: "My dad's name is Rajesh.", client_message_id: 'msg-1' },
        { message: "My mom's name is Neeta.", client_message_id: 'msg-2' },
        { message: "I also started a company called Acme.", client_message_id: 'msg-3' }
      ];

      const result = TurnAnalyzer.analyze(messages);

      expect(result.hasFacts).toBe(true);
      expect(result.units.length).toBe(3);

      // Verify Unit 1
      expect(result.units[0].factKey).toBe('father_name');
      expect(result.units[0].factValue).toBe('Rajesh');
      expect(result.units[0].type).toBe('fact');
      expect(result.units[0].order).toBe(1);
      expect(result.units[0].isProtected).toBe(false);
      expect(result.units[0].factClass).toBe('HIGH_CONFIDENCE_DURABLE_FACT');

      // Verify Unit 2
      expect(result.units[1].factKey).toBe('mother_name');
      expect(result.units[1].factValue).toBe('Neeta');
      expect(result.units[1].type).toBe('fact');
      expect(result.units[1].order).toBe(2);
      expect(result.units[1].isProtected).toBe(false);
      expect(result.units[1].factClass).toBe('HIGH_CONFIDENCE_DURABLE_FACT');

      // Verify Unit 3
      expect(result.units[2].factKey).toBe('company_name');
      expect(result.units[2].factValue).toBe('Acme');
      expect(result.units[2].type).toBe('fact');
      expect(result.units[2].order).toBe(3);
      expect(result.units[2].isProtected).toBe(false);
      expect(result.units[2].factClass).toBe('HIGH_CONFIDENCE_DURABLE_FACT');
    });

    it('should handle correction flow: "My mother is Neeta" -> "Actually her name is Rajeshree"', () => {
      // Turn 1
      const turn1 = TurnAnalyzer.analyze([{ message: "My mother is Neeta." }]);
      expect(turn1.units[0].factKey).toBe('mother_name');
      expect(turn1.units[0].factValue).toBe('Neeta');
      expect(turn1.units[0].type).toBe('fact');
      expect(turn1.units[0].isProtected).toBe(false);

      // Turn 2 Correction
      const turn2 = TurnAnalyzer.analyze([{ message: "Actually her name is Rajeshree." }]);
      expect(turn2.hasCorrections).toBe(true);
      expect(turn2.units[0].type).toBe('correction');
      expect(turn2.units[0].factKey).toBe('mother_name');
      expect(turn2.units[0].factValue).toBe('Rajeshree');
      expect(turn2.units[0].responseRequired).toBe(true);
      expect(turn2.units[0].isProtected).toBe(false);
    });

    it('should extract 3 distinct facts from a single composite sentence', () => {
      const msg = [{ message: "My mother is Rajeshree, I live in Mumbai, and my company is Acme." }];
      const result = TurnAnalyzer.analyze(msg);

      expect(result.units.length).toBe(3);
      const keys = result.units.map(u => u.factKey);
      const values = result.units.map(u => u.factValue);

      expect(keys).toContain('mother_name');
      expect(keys).toContain('city');
      expect(keys).toContain('company_name');

      expect(values).toContain('Rajeshree');
      expect(values).toContain('Mumbai');
      expect(values).toContain('Acme');
    });

    it('should distinguish explicit "remember this" (PROTECTED_FACT) vs transient plans (TRANSIENT_FACT)', () => {
      // Explicit protected fact
      const protectedTurn = TurnAnalyzer.analyze([{ message: "Remember this: my passport number is A1234567, do not forget." }]);
      expect(protectedTurn.units[0].isProtected).toBe(true);
      expect(protectedTurn.units[0].factClass).toBe('PROTECTED_FACT');

      // Transient fact / action
      const transientTurn = TurnAnalyzer.analyze([{ message: "Tomorrow I am planning to visit the dentist." }]);
      expect(transientTurn.units[0].type).toBe('action');
      expect(transientTurn.units[0].isProtected).toBe(false);
      expect(transientTurn.units[0].factClass).toBe('TRANSIENT_FACT');
    });
  });

  describe('2. Coverage Algorithm & Repair Path', () => {
    it('should detect when all semantic units are covered in assistant reply', () => {
      const messages = [
        { message: "My dad's name is Rajesh and my mom's name is Neeta." }
      ];
      const analysis = TurnAnalyzer.analyze(messages);

      const goodReply = "Arre badhiya! Rajesh uncle aur Neeta aunty ko mera namaste bolna.";
      const uncovered = TurnAnalyzer.getUncoveredUnits(analysis, goodReply);

      expect(uncovered.length).toBe(0);
    });

    it('should detect uncovered units when assistant omits or echoes a question without answering', () => {
      const messages = [
        { message: "Where is the office located?" }
      ];
      const analysis = TurnAnalyzer.analyze(messages);

      // Mere echo of the question is NOT coverage
      const echoReply = "Where is the office located?";
      const uncovered = TurnAnalyzer.getUncoveredUnits(analysis, echoReply);

      expect(uncovered.length).toBe(1);
      expect(uncovered[0].type).toBe('question');
    });

    it('should detect uncovered units when correction is ignored', () => {
      const messages = [
        { message: "Actually her name is Rajeshree." }
      ];
      const analysis = TurnAnalyzer.analyze(messages);

      // Unrelated response ignoring correction
      const badReply = "Haan batao kya chal raha hai?";
      const uncovered = TurnAnalyzer.getUncoveredUnits(analysis, badReply);

      expect(uncovered.length).toBe(1);
      expect(uncovered[0].type).toBe('correction');
    });

    it('should verify coverage when correction is acknowledged', () => {
      const messages = [
        { message: "Actually her name is Rajeshree." }
      ];
      const analysis = TurnAnalyzer.analyze(messages);

      const goodReply = "Oh sorry yaar! Rajeshree aunty yaad rakhunga.";
      const uncovered = TurnAnalyzer.getUncoveredUnits(analysis, goodReply);

      expect(uncovered.length).toBe(0);
    });
  });

  describe('3. Prompt Injection Construction', () => {
    it('should build prompt block with explicit responsiveness constraints', () => {
      const messages = [
        { message: "My dad's name is Rajesh." },
        { message: "Where should we meet tomorrow?" }
      ];
      const analysis = TurnAnalyzer.analyze(messages);
      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(analysis);

      expect(prompt).toContain('## 🔍 TURN ANALYSIS (CRITICAL RESPONSIVENESS CONSTRAINT)');
      expect(prompt).toContain('[FACT]');
      expect(prompt).toContain('[QUESTION]');
      expect(prompt).toContain('Must provide an answer');
    });
  });

  describe('4. Deterministic Fact Persistence Worker', () => {
    it('should durably upsert facts with normal decay eligibility when not explicitly protected', async () => {
      const job = {
        payload: {
          userId: 'user-123',
          facts: [
            { key: 'father_name', value: 'Rajesh', is_protected: false, factClass: 'HIGH_CONFIDENCE_DURABLE_FACT' },
            { key: 'company_name', value: 'Acme', is_protected: false, factClass: 'HIGH_CONFIDENCE_DURABLE_FACT' },
            { key: 'city', value: 'Mumbai', is_protected: false, factClass: 'HIGH_CONFIDENCE_DURABLE_FACT' }
          ],
          sourceMessage: 'My dad is Rajesh and company is Acme in Mumbai'
        }
      };

      await deterministicFactAgent.processJob(job);

      expect(memoryRepository.upsertMemory).toHaveBeenCalledTimes(3);

      expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          type: 'family',
          key: 'father_name',
          value: 'Rajesh',
          confidence: 0.95,
          importance: 75,
          is_protected: false,
          protection_source: undefined
        }),
        job.payload.sourceMessage
      );

      expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          type: 'work',
          key: 'company_name',
          value: 'Acme',
          confidence: 0.95,
          importance: 75,
          is_protected: false
        }),
        job.payload.sourceMessage
      );

      expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          type: 'personal',
          key: 'city',
          value: 'Mumbai',
          confidence: 0.95,
          importance: 75,
          is_protected: false
        }),
        job.payload.sourceMessage
      );
    });

    it('should mark facts protected only when explicitly requested by user', async () => {
      const job = {
        payload: {
          userId: 'user-123',
          facts: [
            { key: 'passport_number', value: 'A1234567', is_protected: true, factClass: 'PROTECTED_FACT' }
          ],
          sourceMessage: 'Remember this: my passport is A1234567'
        }
      };

      await deterministicFactAgent.processJob(job);

      expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          type: 'personal',
          key: 'passport_number',
          value: 'A1234567',
          confidence: 0.95,
          importance: 90,
          is_protected: true,
          protection_source: 'user_explicit'
        }),
        job.payload.sourceMessage
      );
    });
  });
});
