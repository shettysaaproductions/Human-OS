import { userLifeStageEngine } from '../UserLifeStageEngine';

describe('UserLifeStageEngine', () => {
  const mockUserId = 'test-user-founder-123';

  const mockMemories = [
    { key: 'son_name', value: 'Shreshth', memory_type: 'family' },
    { key: 'son_age', value: '6 mahine ka old', memory_type: 'family' },
    { key: 'wife_name', value: 'Sakshi', memory_type: 'family' },
    { key: 'wife_skills', value: 'Passionate cook with signature recipes', memory_type: 'family' },
    { key: 'wife_hobbies', value: 'Self-taught nail artist with a kit', memory_type: 'family' },
    { key: 'father_name', value: 'Suresh', memory_type: 'family' },
    { key: 'father_business', value: 'Undergarments distribution business', memory_type: 'family' },
    { key: 'mother_name', value: 'Rajeshree', memory_type: 'family' },
    { key: 'mother_craft', value: 'Tailoring and garment craftsmanship', memory_type: 'family' },
    { key: 'company_name', value: 'Conviction HR', memory_type: 'work' },
    { key: 'work_schedule', value: 'Monday to Saturday, 11:00 AM – 8:00 PM', memory_type: 'work' },
    { key: 'hiring_goals', value: '4 candidates interviewing, target 2 selections', memory_type: 'work' },
    { key: 'venture_name', value: "Shetty's Dhaba", memory_type: 'work' },
    { key: 'venture_description', value: 'Cloud kitchen and food venture', memory_type: 'work' },
    { key: 'seed_funds', value: '15k PF funds pending bank portal update', memory_type: 'finances' }
  ];

  const mockWorkingContext = {
    'company_name': 'Conviction HR',
    'work_schedule': 'Mon-Sat 11 AM - 8 PM',
    'venture_name': "Shetty's Dhaba",
    'seed_funds': '15k PF pending portal update'
  };

  it('infers FAMILY_FOUNDER_WITH_INFANT life stage with high accuracy', async () => {
    const stageCtx = await userLifeStageEngine.getUserLifeStageContext(
      mockUserId,
      mockMemories,
      mockWorkingContext
    );

    expect(stageCtx.stage).toBe('FAMILY_FOUNDER_WITH_INFANT');
    expect(stageCtx.familyDependents?.hasInfant).toBe(true);
    expect(stageCtx.familyDependents?.infantName).toBe('Shreshth');
    expect(stageCtx.familyDependents?.spouseName).toBe('Sakshi');
    expect(stageCtx.familyDependents?.spouseSkills?.some(s => s.toLowerCase().includes('cook'))).toBe(true);
    expect(stageCtx.primaryLivelihood?.name).toBe('Conviction HR');
    expect(stageCtx.primaryLivelihood?.shiftStartHour).toBe(11);
    expect(stageCtx.primaryLivelihood?.shiftEndHour).toBe(20);
    expect(stageCtx.activeVentures?.[0]?.name).toBe("Shetty's Dhaba");
    expect(stageCtx.financialStakes?.[0]?.title).toContain('PF Bank Details');
  });

  it('enriches a PF reminder with venture seed capital purpose', async () => {
    const stageCtx = await userLifeStageEngine.getUserLifeStageContext(
      mockUserId,
      mockMemories,
      mockWorkingContext
    );

    const enriched = userLifeStageEngine.enrichReminderMessage(
      'PF ke lie bank details update karna',
      stageCtx
    );

    expect(enriched).toContain("Shetty's Dhaba");
    expect(enriched).toContain('15k');
    expect(enriched).toContain('Sakshi');
    expect(enriched).not.toContain('Arey sun, yaad hai na — PF ke lie bank details update karna? Time pe dekh lena!');
  });

  it('enriches a hiring / candidate interview reminder with Conviction HR scaling purpose', async () => {
    const stageCtx = await userLifeStageEngine.getUserLifeStageContext(
      mockUserId,
      mockMemories,
      mockWorkingContext
    );

    const enriched = userLifeStageEngine.enrichReminderMessage(
      'Candidate interview schedule follow up',
      stageCtx
    );

    expect(enriched).toContain('Conviction HR');
    expect(enriched).toContain('scaling');
  });
});
