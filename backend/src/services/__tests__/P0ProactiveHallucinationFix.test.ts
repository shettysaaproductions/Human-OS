import { proactiveFactGroundingGate, ProactiveAuthoritativeContext } from '../ProactiveFactGroundingGate';

describe('P0 Proactive Hallucination Fix - Grounding Gate', () => {

  const emptyContext: ProactiveAuthoritativeContext = {
    memories: [],
    workingMemories: [],
    lifeThreads: [],
    conversationSnippet: '',
    agendaItem: null,
    negatedClaims: [],
  };

  test('TEST 1: No event in state → Nova must not assert one (Blocks unsupported event assertion)', () => {
    const result = proactiveFactGroundingGate.validate('Kal ka event kaisa chal raha hai?', emptyContext);
    
    // Gate converts to a question because it detects an event block
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Kal kuch plan hai kya?');
    expect(result.claimsBlocked.some(c => c.toLowerCase().includes('kal ka event'))).toBe(true);
  });

  test('TEST 2: No event in state → Nova may ask (Questions are always allowed)', () => {
    const result = proactiveFactGroundingGate.validate('Kal kuch plan hai kya?', emptyContext);
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Kal kuch plan hai kya?');
    expect(result.claimClass).toBe('SUPPORTED_INFERENCE');
  });

  test('TEST 3: User correction invalidates assumption (Negated claim blocks future assertions)', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      negatedClaims: ['event'],
    };
    // Should completely block, no question conversion for negated claims
    const result = proactiveFactGroundingGate.validate('Kal tera event hai na?', ctx);
    expect(result.allowed).toBe(false);
    expect(result.transformedMessage).toBeNull();
    expect(result.claimsBlocked).toContain('negated_claim:event');
  });

  test('TEST 4: Dinner/friend assertion fails grounding when not in authoritative state', () => {
    const result = proactiveFactGroundingGate.validate('Mere dost ne mujhe dinner ka invite diya hai.', emptyContext);
    
    // Third-party action inventions cannot be safely converted to questions
    expect(result.allowed).toBe(false);
    expect(result.transformedMessage).toBeNull();
    expect(result.claimsBlocked.some(c => c.toLowerCase().includes('dost'))).toBe(true);
  });

  test('TEST 5: Confirmed calendar/memory → may assert event', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      memories: [{ key: 'upcoming_event', value: 'Tomorrow is the annual tech conference event' }],
    };
    
    const result = proactiveFactGroundingGate.validate('Kal ka event kaisa lag raha hai?', ctx);
    expect(result.allowed).toBe(true);
    // Preserves original message
    expect(result.transformedMessage).toBe('Kal ka event kaisa lag raha hai?');
    expect(result.claimClass).toBe('CONFIRMED_MEMORY');
  });

  test('TEST 6: Confirmed working memory → may assert third party action', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      workingMemories: [{ key: 'friend_action', value: 'Rahul dost ne dinner invite diya' }],
    };
    
    const result = proactiveFactGroundingGate.validate('Dost ne dinner pe invite kiya tha na?', ctx);
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Dost ne dinner pe invite kiya tha na?');
    expect(result.claimClass).toBe('CONFIRMED_MEMORY');
  });

  test('TEST 7: Unsupported personal plan → grounding gate converts to question', () => {
    const result = proactiveFactGroundingGate.validate('Tumhara kal ka dinner plan kaisa hai?', emptyContext);
    
    // "tumhara ... dinner plan ... hai" matches pattern
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Kal kuch plan hai kya?');
    expect(result.claimsBlocked.some(c => c.toLowerCase().includes('tumhara') && c.toLowerCase().includes('dinner plan'))).toBe(true);
  });

  test('TEST 8: Question about unknown fact → allowed', () => {
    const result = proactiveFactGroundingGate.validate('Tumhari wife ka naam kya hai?', emptyContext);
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Tumhari wife ka naam kya hai?');
    // Questions pass untouched
  });

  test('TEST 9: User denies → negation takes precedence over old memory', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      memories: [{ key: 'plan', value: 'Kal dinner plan hai' }], // Old memory says yes
      negatedClaims: ['dinner'], // Recent correction says no
    };
    
    const result = proactiveFactGroundingGate.validate('Kal tera dinner kaisa raha?', ctx);
    expect(result.allowed).toBe(false); // Negation wins, blocks outright
    expect(result.transformedMessage).toBeNull();
  });

  test('TEST 10: Mixed confirmed + unknown → unsupported third party action blocks', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      memories: [{ key: 'work', value: 'Working at Microsoft' }],
    };
    
    // Knows about work, but invents a boss action
    const result = proactiveFactGroundingGate.validate('Boss ne aaj bahut kaam diya kya?', ctx);
    expect(result.allowed).toBe(false);
    expect(result.transformedMessage).toBeNull();
    expect(result.claimsBlocked.some(c => c.toLowerCase().includes('boss ne'))).toBe(true);
  });

  test('TEST 11: Agenda deterministic state allows related assertion', () => {
    const ctx: ProactiveAuthoritativeContext = {
      ...emptyContext,
      agendaItem: { event_description: 'Doctor appointment for routine checkup' }
    };
    
    const result = proactiveFactGroundingGate.validate('Kal ka appointment kaisa raha?', ctx);
    expect(result.allowed).toBe(true);
    expect(result.transformedMessage).toBe('Kal ka appointment kaisa raha?');
    expect(result.claimClass).toBe('DETERMINISTIC_STATE');
  });

  test('TEST 12: Empty message gets blocked', () => {
    const result = proactiveFactGroundingGate.validate('   ', emptyContext);
    expect(result.allowed).toBe(false);
    expect(result.claimClass).toBe('UNKNOWN');
  });
});
