import { canonicalizeKey, isAliasKey, sameCanonicalConcept } from '../../lib/memoryKeySchema';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { promptBuilder } from '../promptBuilder';
import { deterministicFactAgent } from '../../agents/DeterministicFactAgent';
import { memoryRepository } from '../memoryRepository';
import { cognitiveContextService } from '../CognitiveContextService';

jest.mock('../memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('Family Name Semantics & Analytics Memory Filter Bug Fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Canonical Schema & Nickname Aliases ──────────────────────────────────
  test('1. canonicalizeKey maps alias keys to relationship-scoped canonical keys', () => {
    expect(canonicalizeKey('sons_name').canonical).toBe('son_name');
    expect(canonicalizeKey('sons_nickname').canonical).toBe('son_nickname');
    expect(canonicalizeKey('son_nick_name').canonical).toBe('son_nickname');
    expect(canonicalizeKey('bete_ka_nickname').canonical).toBe('son_nickname');
    expect(canonicalizeKey('mothers_name').canonical).toBe('mother_name');
    expect(canonicalizeKey('mom_name').canonical).toBe('mother_name');
    expect(canonicalizeKey('mothers_nickname').canonical).toBe('mother_nickname');
    expect(canonicalizeKey('wife_nick_name').canonical).toBe('wife_nickname');
    expect(canonicalizeKey('daughter_nick_name').canonical).toBe('daughter_nickname');
  });

  test('2. isAliasKey correctly identifies aliases vs canonical keys', () => {
    expect(isAliasKey('sons_name')).toBe(true);
    expect(isAliasKey('son_name')).toBe(false);
    expect(isAliasKey('sons_nickname')).toBe(true);
    expect(isAliasKey('son_nickname')).toBe(false);
  });

  test('3. sameCanonicalConcept returns true for relationship aliases', () => {
    expect(sameCanonicalConcept('sons_name', 'son_name')).toBe(true);
    expect(sameCanonicalConcept('mom_name', 'mother_name')).toBe(true);
    expect(sameCanonicalConcept('son_nick_name', 'son_nickname')).toBe(true);
    expect(sameCanonicalConcept('son_name', 'son_nickname')).toBe(false);
  });

  // ── 2. Fact Extraction: Real Name vs Nickname ────────────────────────────────
  test('4. Son real name is extracted as son_name from initial statement', () => {
    const analysis = TurnAnalyzer.analyze([{ message: 'Mere bete ka naam Shreshth hai' }]);
    const fact = analysis.units.find(u => u.factKey === 'son_name');
    expect(fact).toBeDefined();
    expect(fact?.factValue).toBe('Shreshth');
  });

  test('5. Direct son nickname statement is extracted as son_nickname', () => {
    const analysis = TurnAnalyzer.analyze([{ message: 'Bete ka nickname Tiku hai' }]);
    const fact = analysis.units.find(u => u.factKey === 'son_nickname');
    expect(fact).toBeDefined();
    expect(fact?.factValue).toBe('Tiku');
  });

  test('6. Antecedent resolution maps generic nickname statement to son_nickname', () => {
    const context = {
      recentMessages: [
        { role: 'user', content: 'Mere bete ka naam Shreshth hai' },
        { role: 'assistant', content: 'Acha, Shreshth! Pyara naam hai' }
      ]
    };
    const analysis = TurnAnalyzer.analyze([{ message: 'Uska nickname Tiku hai' }], context);
    const fact = analysis.units.find(u => u.factKey === 'son_nickname');
    expect(fact).toBeDefined();
    expect(fact?.factValue).toBe('Tiku');
    expect(fact?.relationship).toBe('son');
  });

  // ── 3. Clarification Flow: son_name (Tiku) -> son_name (Shreshth) + son_nickname (Tiku) ─
  test('7. Clarification "I mean real name Shreshth hai, pyar se nickname Tiku rakha hai" extracts son_name and son_nickname with correction', () => {
    const context = {
      recentMessages: [
        { role: 'user', content: 'Ha actually mere bete ka naam tiku hai' },
        { role: 'assistant', content: 'Got it — Tiku, your son.' }
      ]
    };
    const analysis = TurnAnalyzer.analyze(
      [{ message: 'I mean real name shreshth hai pyar se nick name tiku rakha hai' }],
      context
    );

    const sonNameUnit = analysis.units.find(u => u.factKey === 'son_name');
    const sonNickUnit = analysis.units.find(u => u.factKey === 'son_nickname');

    expect(sonNameUnit).toBeDefined();
    expect(sonNameUnit?.factValue).toBe('Shreshth');
    expect(sonNameUnit?.type).toBe('correction');

    expect(sonNickUnit).toBeDefined();
    expect(sonNickUnit?.factValue).toBe('Tiku');

    // Ensure unscoped real_name / nickname are not emitted as keys
    expect(analysis.units.some(u => u.factKey === 'real_name')).toBe(false);
    expect(analysis.units.some(u => u.factKey === 'nickname')).toBe(false);
  });

  test('8. DeterministicFactAgent persists son_name as family fact and son_nickname as family fact', async () => {
    await deterministicFactAgent.processJob({
      payload: {
        userId: 'user-test-1',
        facts: [
          { key: 'son_name', value: 'Shreshth', isCorrection: true },
          { key: 'son_nickname', value: 'Tiku' }
        ],
        sourceMessage: 'I mean real name shreshth hai pyar se nick name tiku rakha hai'
      }
    });

    expect(memoryRepository.upsertMemory).toHaveBeenCalledTimes(2);
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-test-1',
      expect.objectContaining({
        key: 'son_name',
        value: 'Shreshth',
        type: 'family',
        correction_intent: true,
        source_authority: 'deterministic'
      }),
      expect.any(String)
    );
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-test-1',
      expect.objectContaining({
        key: 'son_nickname',
        value: 'Tiku',
        type: 'family',
        source_authority: 'deterministic'
      }),
      expect.any(String)
    );
  });

  // ── 4. PromptBuilder & Cognitive Context Presentation ────────────────────────
  test('9. PromptBuilder formats son_name and son_nickname as a coherent unified concept', () => {
    const prompt = promptBuilder.buildSystemPrompt(
      'BASE_PROMPT',
      [
        { id: '1', key: 'son_name', value: 'Shreshth', memory_type: 'family', importance: 90 } as any,
        { id: '2', key: 'son_nickname', value: 'Tiku', memory_type: 'family', importance: 80 } as any,
        { id: '3', key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 85 } as any,
      ],
      [],
      'Sagar',
      'friendly',
      [],
      'hi'
    );

    expect(prompt).toContain("User's son: name: Shreshth, nickname: Tiku (both \"Shreshth\" and \"Tiku\" refer to the user's son)");
    expect(prompt).toContain('Sakshi');
    // Ensure no disconnected separate generic lines
    expect(prompt).not.toContain('- [FAMILY] son name: Shreshth');
    expect(prompt).not.toContain('- [FAMILY] son nickname: Tiku');
  });

  // ── 5. Entity Resolution for Future Queries ──────────────────────────────────
  test('10. Antecedent resolution resolves "Tiku ko kal school se lena hai" to user son', () => {
    const memories = [
      { id: '1', key: 'son_name', value: 'Shreshth', memory_type: 'family', is_archived: false },
      { id: '2', key: 'son_nickname', value: 'Tiku', memory_type: 'family', is_archived: false }
    ];

    const antecedents = (cognitiveContextService as any).extractConversationalAntecedents(
      [],
      'Tiku ko kal school se lena hai',
      memories
    );

    expect(antecedents.length).toBeGreaterThan(0);
    const sonAnt = antecedents.find((a: any) => a.relation === 'son');
    expect(sonAnt).toBeDefined();
    expect(sonAnt.gender).toBe('masculine');
  });

  test('11. Antecedent resolution resolves "Shreshth ko kal school se lena hai" to user son', () => {
    const memories = [
      { id: '1', key: 'son_name', value: 'Shreshth', memory_type: 'family', is_archived: false },
      { id: '2', key: 'son_nickname', value: 'Tiku', memory_type: 'family', is_archived: false }
    ];

    const antecedents = (cognitiveContextService as any).extractConversationalAntecedents(
      [],
      'Shreshth ko kal school se lena hai',
      memories
    );

    expect(antecedents.length).toBeGreaterThan(0);
    const sonAnt = antecedents.find((a: any) => a.relation === 'son');
    expect(sonAnt).toBeDefined();
    expect(sonAnt.gender).toBe('masculine');
  });

  // ── 6. Unrelated Memories Integrity ─────────────────────────────────────────
  test('12. Existing unrelated memories (work, goals, dates) remain unaffected', () => {
    const analysis = TurnAnalyzer.analyze([{ message: 'I started a company called Acme' }]);
    expect(analysis.units.some(u => u.factKey === 'company_name')).toBe(true);

    const prompt = promptBuilder.buildSystemPrompt(
      'BASE_PROMPT',
      [
        { id: '1', key: 'company_name', value: 'Acme', memory_type: 'work', importance: 80 } as any,
        { id: '2', key: 'office_hours', value: '9 AM to 5 PM', memory_type: 'work', importance: 70 } as any,
      ],
      [],
      'Sagar',
      'friendly',
      [],
      'en'
    );
    expect(prompt).toContain('company name: Acme');
    expect(prompt).toContain('office hours: 9 AM to 5 PM');
  });
});
