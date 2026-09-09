import { isGarbageMemoryValue, filterGarbageWorkingMemories } from '../../lib/memoryFilters';

describe('memoryFilters', () => {
  it('should block confirmed production garbage values', () => {
    expect(isGarbageMemoryValue('active_goals', "User's active goals")).toBe(true);
    expect(isGarbageMemoryValue('pending_kam', 'Main wapas aa gaya')).toBe(true);
    expect(isGarbageMemoryValue('last_message', 'What should I do?')).toBe(true);
    expect(isGarbageMemoryValue('current_utterance', 'the user is asking for food')).toBe(true);
  });

  it('should block question sentences as memory values', () => {
    expect(isGarbageMemoryValue('random_fact', 'Kya karna chahiye?')).toBe(true);
    expect(isGarbageMemoryValue('goal', 'where is the office?')).toBe(true);
  });

  it('should block phatic acknowledgments', () => {
    expect(isGarbageMemoryValue('feedback', 'haan')).toBe(true);
    expect(isGarbageMemoryValue('feedback', 'theek hai')).toBe(true);
    expect(isGarbageMemoryValue('feedback', 'hmm')).toBe(true);
  });

  it('should allow legitimate facts and goals', () => {
    expect(isGarbageMemoryValue('mother_name', 'Sunita')).toBe(false);
    expect(isGarbageMemoryValue('current_project', 'Opening a software consultancy')).toBe(false);
    expect(isGarbageMemoryValue('workplace', 'Google')).toBe(false);
  });

  it('should block relative age durations for birth_date keys', () => {
    expect(isGarbageMemoryValue('birth_date', '6 months')).toBe(true);
    expect(isGarbageMemoryValue('birthday', '6 months ka hai')).toBe(true);
    expect(isGarbageMemoryValue('date_of_birth', '2 years')).toBe(true);
    expect(isGarbageMemoryValue('birth_date', '1 year old')).toBe(true);
    expect(isGarbageMemoryValue('birth_date', 'abhi sirf 6 months ka hai')).toBe(true);

    // Legitimate dates should be allowed
    expect(isGarbageMemoryValue('birth_date', '1995-08-15')).toBe(false);
    expect(isGarbageMemoryValue('birth_date', '15 August 1995')).toBe(false);
    expect(isGarbageMemoryValue('birth_date', 'March 2026')).toBe(false);

    // son_age should accept age durations
    expect(isGarbageMemoryValue('son_age', '6 months')).toBe(false);
    expect(isGarbageMemoryValue('daughter_age', '2 years')).toBe(false);
  });

  it('should block system counter and internal tracking keys', () => {
    const list = [
      { key: '__sys_nova_ignored_count', value: '1' },
      { key: 'nova_ignored_deferred_count', value: '1' },
      { key: 'ignore_escalation_count', value: '2' },
      { key: 'followup_suppressed_until', value: '2026-09-09' },
      { key: 'son_age', value: '6 months' },
      { key: 'company_name', value: 'conviction hr' },
    ];
    const filtered = filterGarbageWorkingMemories(list);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(m => m.key)).toEqual(['son_age', 'company_name']);
  });
});

