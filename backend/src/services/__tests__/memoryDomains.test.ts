import { classifyDomain, synthesizeConnectedDots, DOMAIN_TAXONOMY } from '../../lib/memoryDomains';
import { canonicalizeKey } from '../../lib/memoryKeySchema';

describe('Wardrobe Memory Domains & Neural Dot-Connecting', () => {
  describe('classifyDomain', () => {
    it('classifies family relationships and children ages into family domain', () => {
      expect(classifyDomain('wife_name').domain).toBe('family');
      expect(classifyDomain('son_name').domain).toBe('family');
      expect(classifyDomain('son_age').domain).toBe('family');
      expect(classifyDomain('child_age').domain).toBe('family');
      expect(classifyDomain('mother_name').domain).toBe('family');
      expect(classifyDomain('father_name').domain).toBe('family');
      expect(classifyDomain('family_details').domain).toBe('family');
    });

    it('classifies career, schedule, and company items into work domain', () => {
      expect(classifyDomain('company_name').domain).toBe('work');
      expect(classifyDomain('work_schedule').domain).toBe('work');
      expect(classifyDomain('office_hours').domain).toBe('work');
      expect(classifyDomain('office_days').domain).toBe('work');
      expect(classifyDomain('current_company').domain).toBe('work');
      expect(classifyDomain('current_office_location').domain).toBe('work');
      expect(classifyDomain('candidates_for_job').domain).toBe('work');
      expect(classifyDomain('hope_for_job_selection').domain).toBe('work');
    });

    it('classifies aspirations and growth targets into goals domain', () => {
      expect(classifyDomain('goals').domain).toBe('goals');
      expect(classifyDomain('primary_goal').domain).toBe('goals');
      expect(classifyDomain('career_goal').domain).toBe('goals');
    });

    it('classifies favorites, routines, and habits into lifestyle domain', () => {
      expect(classifyDomain('favourite_color').domain).toBe('lifestyle');
      expect(classifyDomain('favourite_beverage').domain).toBe('lifestyle');
      expect(classifyDomain('favourite_street_food').domain).toBe('lifestyle');
      expect(classifyDomain('morning_routine').domain).toBe('lifestyle');
      expect(classifyDomain('passions', 'preferences').domain).toBe('lifestyle');
    });

    it('classifies names, anchors, and dates into identity domain', () => {
      expect(classifyDomain('preferred_name').domain).toBe('identity');
      expect(classifyDomain('birth_date').domain).toBe('identity');
      expect(classifyDomain('marriage_date').domain).toBe('identity');
      expect(classifyDomain('important_facts').domain).toBe('identity');
    });
  });

  describe('canonicalizeKey alias updates', () => {
    it('canonicalizes nai_morning_schedule to work_schedule', () => {
      const { canonical } = canonicalizeKey('nai_morning_schedule');
      expect(canonical).toBe('work_schedule');
    });

    it('canonicalizes current_company to company_name', () => {
      const { canonical } = canonicalizeKey('current_company');
      expect(canonical).toBe('company_name');
    });
  });

  describe('synthesizeConnectedDots', () => {
    it('generates cross-domain neural links between work schedule and family evening routine', () => {
      const memories = [
        { key: 'work_schedule', value: 'Monday to Saturday, 11 AM to 8 PM at Conviction HR', memory_type: 'work' },
        { key: 'wife_name', value: 'Sakshi', memory_type: 'family' },
        { key: 'son_name', value: 'Shreshth', memory_type: 'family' },
        { key: 'son_age', value: '6 months', memory_type: 'family' },
        { key: 'company_name', value: 'Conviction HR', memory_type: 'work' },
        { key: 'goals', value: 'Scaling Conviction HR and hiring top talent', memory_type: 'goals' },
      ];

      const workingContext = [
        { key: 'candidates_for_job', value: '4 candidates' },
        { key: 'hope_for_job_selection', value: 'hope so 2 bhi select ho jaye' }
      ];

      const dots = synthesizeConnectedDots(memories, workingContext);
      expect(dots.length).toBeGreaterThanOrEqual(2);

      const workFamilyDot = dots.find(d => d.id === 'dot-work-family');
      expect(workFamilyDot).toBeDefined();
      expect(workFamilyDot?.badge).toContain('Work ⇄');
      expect(workFamilyDot?.badge).toContain('Family');
      expect(workFamilyDot?.insight).toContain('Sakshi');
      expect(workFamilyDot?.insight).toContain('Shreshth');
      expect(workFamilyDot?.insight).toContain('8:00 PM');

      const hiringDot = dots.find(d => d.id === 'dot-work-hiring');
      expect(hiringDot).toBeDefined();
      expect(hiringDot?.insight).toContain('4 candidates');
      expect(hiringDot?.insight).toContain('Conviction HR');
    });
  });
});
