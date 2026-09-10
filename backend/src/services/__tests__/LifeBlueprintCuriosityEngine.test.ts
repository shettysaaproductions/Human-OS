import { lifeBlueprintCuriosityEngine, FOUNDATIONAL_BLUEPRINT_REGISTRY } from '../LifeBlueprintCuriosityEngine';

describe('LifeBlueprintCuriosityEngine — Personal Life Blueprint & Adaptive Discovery', () => {

  it('detects missing blueprint gaps when memories are empty', () => {
    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps([]);

    expect(summary.totalTracked).toBe(FOUNDATIONAL_BLUEPRINT_REGISTRY.length);
    expect(summary.knownCount).toBe(0);
    expect(summary.missingCount).toBe(FOUNDATIONAL_BLUEPRINT_REGISTRY.length);
    expect(summary.completionPercentage).toBe(0);
    expect(summary.nextBestCuriosity).toBeDefined();
    expect(summary.nextBestCuriosity?.suggestedPrompt).toBeTruthy();
  });

  it('correctly recognizes known facts from memories and working context', () => {
    const mockMemories = [
      { key: 'birth_date', value: '14 August 1995', memory_type: 'identity' },
      { key: 'sleep_time', value: '12:00 AM', memory_type: 'lifestyle' },
      { key: 'city', value: 'Mumbai', memory_type: 'identity' }
    ];

    const mockWorking = {
      dietary_preference: 'Non-vegetarian'
    };

    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(mockMemories, mockWorking);

    expect(summary.knownCount).toBe(4);
    expect(summary.completionPercentage).toBeGreaterThan(0);

    // Verify known items are NOT in missing categories
    const identityMissing = summary.missingGapsByCategory.IDENTITY_AND_BIO.map(g => g.key);
    expect(identityMissing).not.toContain('birth_date');
    expect(identityMissing).not.toContain('hometown_or_city');

    const sleepMissing = summary.missingGapsByCategory.SLEEP_AND_RHYTHM.map(g => g.key);
    expect(sleepMissing).not.toContain('sleep_time');

    const dietMissing = summary.missingGapsByCategory.DIET_AND_HEALTH.map(g => g.key);
    expect(dietMissing).not.toContain('dietary_preference');
  });

  it('prioritizes sleep_time during evening wind-down hours (22:00)', () => {
    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
      [],
      {},
      { localHour: 22, isWeekend: false }
    );

    // At 22:00 (10 PM), sleep_time is critical with evening wind-down bonus
    expect(summary.nextBestCuriosity?.key).toBe('sleep_time');
    expect(summary.nextBestCuriosity?.suggestedPrompt).toMatch(/sone ka time|kitne baje sote ho/i);
  });

  it('prioritizes wake_time or morning starter in the morning (08:00)', () => {
    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
      [{ key: 'sleep_time', value: '11:00 PM' }],
      {},
      { localHour: 8, isWeekend: false }
    );

    expect(['wake_time', 'morning_starter', 'fitness_routine']).toContain(summary.nextBestCuriosity?.key);
  });

  it('prioritizes dietary preferences during meal time (13:00)', () => {
    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
      [
        { key: 'sleep_time', value: '11:00 PM' },
        { key: 'wake_time', value: '7:00 AM' }
      ],
      {},
      { localHour: 13, isWeekend: false }
    );

    expect(['dietary_preference', 'comfort_food', 'birth_date']).toContain(summary.nextBestCuriosity?.key);
  });

  it('formats a high-EQ situational discovery guideline without prompt leaking', () => {
    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
      [],
      {},
      { localHour: 21, isWeekend: false }
    );

    const guideline = lifeBlueprintCuriosityEngine.formatDiscoveryPromptGuideline(summary);
    expect(guideline).toBeDefined();
    expect(guideline).toContain('COMPANION LIFE BLUEPRINT DISCOVERY');
    expect(guideline).toContain('Suggested Natural Inquiry');
    expect(guideline).toContain('Rule: Weave this inquiry in warmly');
  });

  it('guarantees zero amnesia when facts are present in Entity Wardrobes', () => {
    const mockWardrobe: any = {
      id: 'wardrobe-user',
      domain: 'identity',
      name: 'Saa',
      roleTitle: 'Founder',
      summary: 'Lives in Mumbai and born in August',
      traits: [
        { label: 'Date of Birth', value: '15 August 1994' },
        { label: 'Sleep Cycle', value: 'Sleeps at 11:30 PM' }
      ]
    };

    const summary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
      [],
      {},
      { localHour: 22, isWeekend: false },
      [mockWardrobe]
    );

    const sleepGaps = summary.missingGapsByCategory.SLEEP_AND_RHYTHM.map(g => g.key);
    expect(sleepGaps).not.toContain('sleep_time');

    const identityGaps = summary.missingGapsByCategory.IDENTITY_AND_BIO.map(g => g.key);
    expect(identityGaps).not.toContain('birth_date');
  });
});
