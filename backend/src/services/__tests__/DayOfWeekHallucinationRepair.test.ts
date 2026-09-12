import { repairDayOfWeekHallucinations, validateAndRepairGrounding } from '../NovaBrainService';

describe('DayOfWeekHallucinationRepair', () => {
  it('repairs "Abhi toh Sunday morning hai!" when today is Saturday', () => {
    const raw = 'Arey, kahan tha tu itni der? 🎉 Kya chal raha hai? Abhi toh Sunday morning hai!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Arey, kahan tha tu itni der? 🎉 Kya chal raha hai? Abhi toh Saturday morning hai!');
  });

  it('repairs "Happy Sunday!" to "Happy Saturday!" on Saturday', () => {
    const raw = 'Good morning! Happy Sunday!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Good morning! Happy Saturday!');
  });

  it('repairs "Aaj Sunday hai" to "Aaj Saturday hai" on Saturday', () => {
    const raw = 'Arre yaar, aaj Sunday hai toh aaram karte hain.';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Arre yaar, aaj Saturday hai toh aaram karte hain.');
  });

  it('repairs "Sunday ki subah" to "Saturday ki subah" on Saturday', () => {
    const raw = 'Sunday ki subah mast chai aur nashta!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Saturday ki subah mast chai aur nashta!');
  });

  it('repairs "Abhi Sunday hai" to "Abhi Saturday hai" on Saturday', () => {
    const raw = 'Abhi Sunday hai, tension mat le!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Abhi Saturday hai, tension mat le!');
  });

  it('does NOT corrupt future day-of-week references', () => {
    const raw = 'Sunday ko hum movie dekhne jaayenge, pakka!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Saturday');
    expect(repaired).toBe('Sunday ko hum movie dekhne jaayenge, pakka!');
  });

  it('handles weekday transitions cleanly (e.g. Wednesday hallucinated as Friday)', () => {
    const raw = 'Happy Friday! Aaj Friday evening enjoy karo!';
    const repaired = repairDayOfWeekHallucinations(raw, 'Wednesday');
    expect(repaired).toBe('Happy Wednesday! Aaj Wednesday evening enjoy karo!');
  });

  it('end-to-end: validateAndRepairGrounding extracts today from situationBrief', () => {
    const raw = 'Arey, kahan tha tu itni der? 🎉 Kya chal raha hai? Abhi toh Sunday morning hai!';
    const brief = '## SITUATION BRIEF\n- Right now: Saturday, September 12, 2026, 10:44 AM IST (Weekend / Weekoff)';
    const repaired = validateAndRepairGrounding(raw, '', { situationBrief: brief });
    expect(repaired).toContain('Abhi toh Saturday morning hai!');
    expect(repaired).not.toContain('Sunday');
  });
});
