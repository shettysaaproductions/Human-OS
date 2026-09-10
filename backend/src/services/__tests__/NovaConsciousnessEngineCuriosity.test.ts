import { deriveMissingMemoryCuriosities } from '../NovaConsciousnessEngine';

describe('NovaConsciousnessEngine - Curiosity & Anti-Amnesia Engine', () => {
  const mockMemories = [
    { key: 'son_name', value: 'Shreshth', memory_type: 'family' },
    { key: 'son_age', value: '6 mahine ka old', memory_type: 'family' },
    { key: 'wife_name', value: 'Sakshi', memory_type: 'family' },
    { key: 'wife_skills', value: 'Passionate cook with signature recipes', memory_type: 'family' },
    { key: 'wife_hobbies', value: 'Self-taught nail artist with a kit', memory_type: 'family' },
    { key: 'company_name', value: 'Conviction HR', memory_type: 'work' },
    { key: 'venture_name', value: "Shetty's Dhaba", memory_type: 'work' },
    { key: 'venture_description', value: 'Cloud kitchen and food venture', memory_type: 'work' }
  ];

  const mockWorkingContext = {
    'company_name': 'Conviction HR',
    'venture_name': "Shetty's Dhaba"
  };

  it('never asks what Sakshi does or her hobbies when cooking/nail art are in wardrobes', () => {
    const curiosities = deriveMissingMemoryCuriosities(mockMemories, mockWorkingContext);

    // CRITICAL: Must NEVER ask "Waise Sakshi kya karti hai?"
    const asksWhatWifeDoes = curiosities.some(c => 
      c.toLowerCase().includes('kya karti hai') || 
      c.toLowerCase().includes('interests are unknown')
    );
    expect(asksWhatWifeDoes).toBe(false);
  });

  it('never asks if a 6-month-old infant has started school', () => {
    const curiosities = deriveMissingMemoryCuriosities(mockMemories, mockWorkingContext);

    const asksAboutSchool = curiosities.some(c => 
      c.toLowerCase().includes('school shuru')
    );
    expect(asksAboutSchool).toBe(false);
  });

  it('synthesizes strategic venture synergy between Sakshi cooking and Shetty Dhaba cloud kitchen', () => {
    const curiosities = deriveMissingMemoryCuriosities(mockMemories, mockWorkingContext);

    const hasSynergy = curiosities.some(c => 
      c.toLowerCase().includes('shetty') && c.toLowerCase().includes('recipe')
    );
    expect(hasSynergy).toBe(true);
  });

  it('never asks what user does for work when Conviction HR is known', () => {
    const curiosities = deriveMissingMemoryCuriosities(mockMemories, mockWorkingContext);

    const asksUserWork = curiosities.some(c => 
      c.toLowerCase().includes('aap kya kaam karte ho') ||
      c.toLowerCase().includes('user work: job')
    );
    expect(asksUserWork).toBe(false);
  });
});
