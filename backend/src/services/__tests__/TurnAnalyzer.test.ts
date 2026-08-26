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

    it('should handle correction flow with pronoun antecedent inheritance: "My mother is Neeta" -> "Actually her name is Rajeshree"', () => {
      // Turn with antecedent in prior message
      const turn = TurnAnalyzer.analyze([
        { message: "My mother is Neeta." },
        { message: "Actually her name is Rajeshree." }
      ]);
      expect(turn.hasCorrections).toBe(true);
      const correctionUnit = turn.units.find(u => u.type === 'correction');
      expect(correctionUnit).toBeDefined();
      expect(correctionUnit?.factKey).toBe('mother_name');
      expect(correctionUnit?.factValue).toBe('Rajeshree');
      expect(correctionUnit?.oldValue).toBe('Neeta');
      expect(correctionUnit?.relationship).toBe('mother');
      expect(correctionUnit?.responseRequired).toBe(true);
      expect(correctionUnit?.isProtected).toBe(false);
      expect(correctionUnit?.factClass).toBe('HIGH_CONFIDENCE_DURABLE_FACT');
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

  describe('3. Phase 7.1 Regression Suite: Relationship-Aware Corrections & History Guard', () => {
    it('A. Unknown relation: "Her name is Supriya" with no antecedent -> UNKNOWN_RELATION and prompt constraint', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "Her name is Supriya." }
      ]);
      expect(turn.units[0].factKey).toBe('UNKNOWN_RELATION');
      expect(turn.units[0].factValue).toBe('Supriya');

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('RELATIONSHIP_STATE = UNKNOWN');
      expect(prompt).toContain('RELATIONSHIP_VALUE = NONE');
      expect(prompt).toContain('ANTECEDENT = NONE');
      expect(prompt).toContain("The relationship of 'Supriya' is completely UNKNOWN");
      expect(prompt).toContain('Output ONLY ONE concise clarification question');
      expect(prompt).not.toContain('<OPTIONS>');
    });

    it('B. Known correction: "My sister is Soni" -> "Actually her name is Supriya" -> sister_name = Supriya, no clarification', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "My sister is Soni." },
        { message: "Actually her name is Supriya." }
      ]);
      expect(turn.hasCorrections).toBe(true);
      const correctionUnit = turn.units.find(u => u.type === 'correction');
      expect(correctionUnit?.factKey).toBe('sister_name');
      expect(correctionUnit?.factValue).toBe('Supriya');
      expect(correctionUnit?.oldValue).toBe('Soni');
      expect(correctionUnit?.relationship).toBe('sister');

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('RELATIONSHIP_STATE = KNOWN');
      expect(prompt).toContain("RELATIONSHIP = 'sister'");
      expect(prompt).toContain('ANTECEDENT = FOUND');
      expect(prompt).toContain('No clarification needed');
    });

    it('C. Known correction with business context: "My sister handles finance" -> "Actually her name is Supriya"', () => {
      const turn = TurnAnalyzer.analyze(
        [{ message: "Actually her name is Supriya." }],
        { recentMessages: [{ role: 'user', content: "My sister is Soni and she handles finance for my cloud kitchen." }] }
      );
      expect(turn.hasCorrections).toBe(true);
      const unit = turn.units[0];
      expect(unit.factKey).toBe('sister_name');
      expect(unit.factValue).toBe('Supriya');
      expect(unit.relationship).toBe('sister');

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('RELATIONSHIP_STATE = KNOWN');
      expect(prompt).toContain("RELATIONSHIP = 'sister'");
    });

    it('D. Name-only message: "Supriya" -> does not infer relationship', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "Supriya" }
      ]);
      expect(turn.units[0].type).toBe('casual');
      expect(turn.units[0].factKey).toBeUndefined();
      expect(turn.units[0].relationship).toBeUndefined();
    });

    it('E. Legitimate antecedent: "My sister is Supriya" -> "She handles finance" -> resolves she to sister', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "My sister is Supriya." },
        { message: "She handles finance." }
      ]);
      expect(turn.units[0].factKey).toBe('sister_name');
      expect(turn.units[0].factValue).toBe('Supriya');

      const antecedent = TurnAnalyzer.resolveAntecedent("She handles finance.", [turn.units[0]]);
      expect(antecedent).not.toBeNull();
      expect(antecedent?.relationship).toBe('sister');
      expect(antecedent?.oldValue).toBe('Supriya');
    });

    it('F. Pronoun with no antecedent does NOT pull from long-term memory', () => {
      const turn = TurnAnalyzer.analyze(
        [{ message: "Her name is Supriya." }],
        {
          memories: [
            { key: 'sister_name', value: 'Soni' },
            { key: 'mother_name', value: 'Neeta' }
          ]
        }
      );
      // Isolated "Her name is Supriya" with no antecedent in recentMessages must remain UNKNOWN
      expect(turn.units[0].factKey).toBe('UNKNOWN_RELATION');
      expect(turn.units[0].relationship).toBeUndefined();
    });

    it('G. Brother correction via pronoun: "My brother is Amit" -> "Actually his name is Arjun"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "My brother is Amit." },
        { message: "Actually his name is Arjun." }
      ]);
      expect(turn.hasCorrections).toBe(true);
      const correctionUnit = turn.units.find(u => u.type === 'correction');
      expect(correctionUnit?.factKey).toBe('brother_name');
      expect(correctionUnit?.factValue).toBe('Arjun');
      expect(correctionUnit?.oldValue).toBe('Amit');
      expect(correctionUnit?.relationship).toBe('brother');

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('RELATIONSHIP_STATE = KNOWN');
      expect(prompt).toContain("RELATIONSHIP = 'brother'");
      expect(prompt).toContain('No clarification needed');
    });

    it('H. Unknown "him" with no antecedent in action: "Tell him I will call tomorrow"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "Tell him I will call tomorrow." }
      ]);
      expect(turn.units[0].type).toBe('action');

      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('[CLARIFICATION GUARD: If an action is missing a critical parameter (e.g., WHO \'him\' refers to, WHERE to go) and it cannot be resolved from context, ask the user directly in normal chat who \'him\' refers to with a single concise question.]');
      expect(prompt).not.toContain('<OPTIONS>');
    });

    it('I. Anti-robot rules in promptBuilder contain unknown relationship, minimal clarification & grounded correction guards', () => {
      const { promptBuilder } = require('../promptBuilder');
      const systemPrompt = promptBuilder.buildSystemPrompt({
        memories: [],
        workingMemories: [],
        situationBrief: '',
        recentMessages: []
      });

      expect(systemPrompt).toContain('ANTI-ROBOT RULE (FABRICATED HISTORY GUARD — ZERO TOLERANCE)');
      expect(systemPrompt).toContain('ANTI-ROBOT RULE (NAME & GENDER ASSUMPTION — ZERO TOLERANCE)');
      expect(systemPrompt).toContain('ANTI-ROBOT RULE (UNKNOWN RELATIONSHIP & MINIMAL CLARIFICATION — ZERO TOLERANCE)');
      expect(systemPrompt).toContain('ANTI-ROBOT RULE (GROUNDED CORRECTION ACKNOWLEDGEMENT — RELEVANCE-FIRST)');
      expect(systemPrompt).toContain('ANTI-ROBOT RULE (RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT)');
      expect(systemPrompt).toContain('Output ONLY ONE concise clarification question');
    });

    it('J. Phase 7.2: Unknown relationship emits concise single-question restraint instructions', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "Her name is Supriya." }
      ]);
      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('Output ONLY ONE concise clarification question');
      expect(prompt).toContain('RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT: Do NOT guess any relationship');
      expect(prompt).toContain('Do NOT append time-of-day commentary, speculative emotions, unrelated questions, or generic reassurance');
    });

    it('K. Phase 7.2: Known correction emits grounded acknowledgement without speculative history', () => {
      const turn = TurnAnalyzer.analyze([
        { message: "My sister is Soni." },
        { message: "Actually her name is Supriya." }
      ]);
      const prompt = TurnAnalyzer.buildTurnAnalysisPrompt(turn);
      expect(prompt).toContain('Acknowledge the correction concisely and cleanly');
      expect(prompt).toContain('RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT: Continue ONLY with context that genuinely exists');
      expect(prompt).toContain('Do NOT generate speculative commentary');
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

    it('should accurately capture all 4 facts from rapid succession turn: wife, son, full name, and city', () => {
      const messages = [
        { message: "Meri wife ka naam Sakshi hai" },
        { message: "Mere bete ka naam Shresht hai" },
        { message: "Mera pura name Sagar shetty hai" },
        { message: "Mai Dahisar me rehta hu" }
      ];

      const result = TurnAnalyzer.analyze(messages);

      expect(result.units.length).toBe(4);
      expect(result.units[0].factKey).toBe('wife_name');
      expect(result.units[0].factValue).toBe('Sakshi');

      expect(result.units[1].factKey).toBe('son_name');
      expect(result.units[1].factValue).toBe('Shresht');

      expect(result.units[2].factKey).toBe('user_name');
      expect(result.units[2].factValue).toBe('Sagar shetty');

      expect(result.units[3].factKey).toBe('city');
      expect(result.units[3].factValue).toBe('Dahisar');
    });

    it('L. Correction flow: "Meri wife ka naam Sakshi hai" → "Actually uska naam Priya hai" → wife_name=Priya, oldValue=Sakshi', () => {
      const result = TurnAnalyzer.analyze([
        { message: 'Meri wife ka naam Sakshi hai.' },
        { message: 'Actually uska naam Priya hai.' }
      ]);

      expect(result.hasCorrections).toBe(true);
      const correctionUnit = result.units.find(u => u.type === 'correction');
      expect(correctionUnit).toBeDefined();
      expect(correctionUnit?.factKey).toBe('wife_name');
      expect(correctionUnit?.factValue).toBe('Priya');
      expect(correctionUnit?.oldValue).toBe('Sakshi');
      expect(correctionUnit?.relationship).toBe('wife');
      expect(correctionUnit?.factClass).toBe('HIGH_CONFIDENCE_DURABLE_FACT');
    });

    it('M. Hinglish city: "Main Bandra me rehta hun" → city=Bandra', () => {
      const result = TurnAnalyzer.analyze([{ message: 'Main Bandra me rehta hun.' }]);
      const cityUnit = result.units.find(u => u.factKey === 'city');
      expect(cityUnit).toBeDefined();
      expect(cityUnit?.factValue).toBe('Bandra');
    });
  });
});

