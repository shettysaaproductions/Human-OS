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

  it('should filter working memory arrays correctly', () => {
    const list = [
      { key: 'pending_kam', value: 'Main wapas aa gaya' },
      { key: 'schedule', value: 'Meeting at 4pm with client' },
      { key: 'active_goals', value: "User's active goals" }
    ];
    const filtered = filterGarbageWorkingMemories(list);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('schedule');
  });
});
