import {
  clusterMemoriesIntoWardrobes,
  classifyDomain,
  synthesizeConnectedDots
} from '../../lib/memoryDomains';

describe('Wardrobe Memory Clustering & Neural Dot-Connecting Engine', () => {
  const mockMemories = [
    { id: 'm1', key: 'preferred_name', value: 'Prefers to be called Saa.', memory_type: 'preferences' },
    { id: 'm2', key: 'mother_name', value: 'rajeshree', memory_type: 'family' },
    { id: 'm3', key: 'father_name', value: 'suresh', memory_type: 'family' },
    { id: 'm4', key: 'wife_name', value: 'sakshi', memory_type: 'family' },
    { id: 'm5', key: 'son_name', value: 'shreshth', memory_type: 'family' },
    { id: 'm6', key: 'family_details', value: 'Wife Sakshi, Son Shreshth (6 months old), Father Suresh, Mother Rajeshree', memory_type: 'family' },
    { id: 'm7', key: 'goals', value: 'Scaling Conviction HR and hiring top talent', memory_type: 'goals' },
    { id: 'm8', key: 'passions', value: 'Entrepreneurship, recruitment leadership, technology, quality family time', memory_type: 'preferences' },
    { id: 'm9', key: 'important_facts', value: 'Works at Conviction HR Monday to Saturday from 11 AM to 8 PM; deeply family-centric', memory_type: 'work' },
    { id: 'm10', key: 'work_schedule', value: 'Monday to Saturday, 11 AM to 8 PM at Conviction HR', memory_type: 'work' },
    { id: 'm11', key: 'son_age', value: '6 mahine ka', memory_type: 'personal' },
    { id: 'm12', key: 'company_name', value: "Shetty's Dhaba", memory_type: 'family' } // Note: mistyped family in DB
  ];

  const mockWorkingContext = [
    { id: 'w1', key: 'candidates_for_job', value: '4 candidates' },
    { id: 'w2', key: 'hope_for_job_selection', value: 'hope so 2 bhi select ho jaye' },
    { id: 'w3', key: 'purchased_nail_art_kit', value: 'last year' },
    { id: 'w4', key: 'learned_nail_art', value: 'self-taught' },
    { id: 'w5', key: 'enjoyed_nail_art', value: 'beautiful art' },
    { id: 'w6', key: 'mother_occupation', value: 'tailor' },
    { id: 'w7', key: 'father_business', value: 'Papa ka undergarments bhejne ka business hai' },
    { id: 'w8', key: 'pf_funds', value: '15k' },
    { id: 'w9', key: 'pf_update_task', value: 'Update PF details on bank portal' },
    { id: 'w10', key: 'goodnight_message', value: 'Good night sube 8 baje msg karna ab' }
  ];

  describe('classifyDomain refinements', () => {
    it('correctly classifies work and company keys even if memory_type was loosely marked as family', () => {
      expect(classifyDomain('company_name', 'family').domain).toBe('work');
      expect(classifyDomain('work_schedule', 'personal').domain).toBe('work');
      expect(classifyDomain('candidates_for_job').domain).toBe('work');
    });

    it('correctly classifies family trait keys into family domain', () => {
      expect(classifyDomain('father_business').domain).toBe('family');
      expect(classifyDomain('mother_occupation').domain).toBe('family');
      expect(classifyDomain('purchased_nail_art_kit').domain).toBe('family');
      expect(classifyDomain('son_age').domain).toBe('family');
    });
  });

  describe('clusterMemoriesIntoWardrobes', () => {
    it('clusters fragmented facts into unified entity wardrobes', () => {
      const { wardrobes, filteredMemories } = clusterMemoriesIntoWardrobes(mockMemories, mockWorkingContext);

      // Verify minimum expected wardrobes
      expect(wardrobes.length).toBeGreaterThanOrEqual(6);

      // 1. Sakshi Wardrobe
      const sakshiWardrobe = wardrobes.find(w => w.id === 'wardrobe-person-sakshi');
      expect(sakshiWardrobe).toBeDefined();
      expect(sakshiWardrobe?.name).toBe('Sakshi');
      expect(sakshiWardrobe?.roleTitle).toBe('Wife');
      expect(sakshiWardrobe?.avatarEmoji).toBe('👩');
      expect(sakshiWardrobe?.domain).toBe('family');

      // Verify Sakshi traits (Role + Cooking + Nail Artist + Birthday)
      const sakshiTraitKeys = sakshiWardrobe?.traits.map(t => t.label);
      expect(sakshiTraitKeys).toContain('Relationship');
      expect(sakshiTraitKeys).toContain('Culinary Talent');
      expect(sakshiTraitKeys).toContain('Nail Artist');
      expect(sakshiTraitKeys).toContain('Birthday');

      const nailTrait = sakshiWardrobe?.traits.find(t => t.label === 'Nail Artist');
      expect(nailTrait?.value).toContain('Self-taught');

      // 2. Shreshth Wardrobe
      const shreshthWardrobe = wardrobes.find(w => w.id === 'wardrobe-person-shreshth');
      expect(shreshthWardrobe).toBeDefined();
      expect(shreshthWardrobe?.name).toBe('Shreshth');
      expect(shreshthWardrobe?.roleTitle).toBe('Son');
      expect(shreshthWardrobe?.avatarEmoji).toBe('👶');
      const ageTrait = shreshthWardrobe?.traits.find(t => t.label === 'Age');
      expect(ageTrait?.value).toContain('6 mahine ka');

      // 3. Suresh Wardrobe (Father with undergarments business)
      const sureshWardrobe = wardrobes.find(w => w.id === 'wardrobe-person-suresh');
      expect(sureshWardrobe).toBeDefined();
      expect(sureshWardrobe?.name).toBe('Suresh');
      expect(sureshWardrobe?.avatarEmoji).toBe('👨‍🦳');
      const fatherBizTrait = sureshWardrobe?.traits.find(t => t.label === 'Business');
      expect(fatherBizTrait?.value).toContain('Undergarments');

      // 4. Rajeshree Wardrobe (Mother with tailoring)
      const rajeshreeWardrobe = wardrobes.find(w => w.id === 'wardrobe-person-rajeshree');
      expect(rajeshreeWardrobe).toBeDefined();
      expect(rajeshreeWardrobe?.name).toBe('Rajeshree');
      expect(rajeshreeWardrobe?.avatarEmoji).toBe('👵');
      const motherOccTrait = rajeshreeWardrobe?.traits.find(t => t.label === 'Occupation');
      expect(motherOccTrait?.value).toContain('Tailor');

      // 5. Conviction HR Wardrobe (Recruitment Agency)
      const convictionWardrobe = wardrobes.find(w => w.id === 'wardrobe-biz-conviction-hr');
      expect(convictionWardrobe).toBeDefined();
      expect(convictionWardrobe?.name).toBe('Conviction HR');
      expect(convictionWardrobe?.avatarEmoji).toBe('💼');
      expect(convictionWardrobe?.domain).toBe('work');
      const schedTrait = convictionWardrobe?.traits.find(t => t.label === 'Work Schedule');
      expect(schedTrait?.value).toContain('11 AM to 8 PM');
      const goalTrait = convictionWardrobe?.traits.find(t => t.label === 'Scaling Goal');
      expect(goalTrait?.value).toContain('Scaling Conviction HR');
      const hiringTrait = convictionWardrobe?.traits.find(t => t.label === 'Hiring Drive');
      expect(hiringTrait?.value).toContain('4 candidates');

      // 6. Shetty's Dhaba Wardrobe (Cloud Kitchen Venture)
      const dhabaWardrobe = wardrobes.find(w => w.id === 'wardrobe-biz-shettys-dhaba');
      expect(dhabaWardrobe).toBeDefined();
      expect(dhabaWardrobe?.name).toBe("Shetty's Dhaba");
      expect(dhabaWardrobe?.avatarEmoji).toBe('🍲');
      expect(dhabaWardrobe?.domain).toBe('work');
      const pfTrait = dhabaWardrobe?.traits.find(t => t.label === 'Seed Capital');
      expect(pfTrait?.value).toContain('15k PF funds');

      // 7. Identity Wardrobe (Saa)
      const identityWardrobe = wardrobes.find(w => w.id === 'wardrobe-identity-user');
      expect(identityWardrobe).toBeDefined();
      expect(identityWardrobe?.name).toBe('Saa');

      // 8. Life Rhythm & Reminders
      const rhythmWardrobe = wardrobes.find(w => w.id === 'wardrobe-routine-reminders');
      expect(rhythmWardrobe).toBeDefined();
      expect(rhythmWardrobe?.avatarEmoji).toBe('⏰');

      // 9. Composite duplicates suppressed from clean view without deletion
      const familyDetailsMem = filteredMemories.find(m => m.key === 'family_details');
      expect(familyDetailsMem?.isCompositeDuplicate).toBe(true);
      const importantFactsMem = filteredMemories.find(m => m.key === 'important_facts');
      expect(importantFactsMem?.isCompositeDuplicate).toBe(true);
      const nonCompositeMem = filteredMemories.find(m => m.key === 'wife_name');
      expect(nonCompositeMem?.isCompositeDuplicate).toBe(false);
    });
  });

  describe('synthesizeConnectedDots dynamic cross-wardrobe links', () => {
    it('synthesizes multi-domain bridges between related entities', () => {
      const dots = synthesizeConnectedDots(mockMemories, mockWorkingContext);

      // Verify cross-wardrobe connections
      const dotIds = dots.map(d => d.id);
      expect(dotIds).toContain('dot-work-family'); // Conviction HR ⇄ Family
      expect(dotIds).toContain('dot-cooking-dhaba'); // Sakshi Cooking ⇄ Shetty's Dhaba
      expect(dotIds).toContain('dot-family-heritage'); // Suresh ⇄ Rajeshree (apparel roots)
      expect(dotIds).toContain('dot-work-hiring'); // Hiring ⇄ Scaling Goal
      expect(dotIds).toContain('dot-pf-venture'); // PF ⇄ Dhaba launch

      const cookingDot = dots.find(d => d.id === 'dot-cooking-dhaba');
      expect(cookingDot?.insight).toContain('Sakshi');
      expect(cookingDot?.insight).toContain('Dhaba');

      const heritageDot = dots.find(d => d.id === 'dot-family-heritage');
      expect(heritageDot?.insight).toContain('Suresh');
      expect(heritageDot?.insight).toContain('Rajeshree');
    });
  });
});
