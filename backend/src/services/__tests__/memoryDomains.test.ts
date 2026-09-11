import { classifyDomain, synthesizeConnectedDots, buildDynamicKnowledgeGraph, formatHierarchicalMemoryPrompt } from '../../lib/memoryDomains';
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

  describe('buildDynamicKnowledgeGraph', () => {
    it('synthesizes complete graph with core node, 5 departments, memory dots, and cross-domain links', () => {
      const memories = [
        { key: 'preferred_name', value: 'Prefers to be called Saa.', memory_type: 'personal' },
        { key: 'wife_name', value: 'Sakshi', memory_type: 'family' },
        { key: 'son_name', value: 'Shreshth', memory_type: 'family' },
        { key: 'son_age', value: '6 months', memory_type: 'family' },
        { key: 'company_name', value: 'Conviction HR', memory_type: 'work' },
        { key: 'work_schedule', value: 'Monday to Saturday, 11 AM to 8 PM at Conviction HR', memory_type: 'work' },
        { key: 'goals', value: 'Scaling Conviction HR and hiring top talent', memory_type: 'goals' },
        { key: 'passions', value: 'Entrepreneurship, recruitment leadership, technology', memory_type: 'preferences' },
      ];

      const workingContext = [
        { key: 'candidates_for_job', value: '4 candidates' },
        { key: 'hope_for_job_selection', value: 'hope so 2 bhi select ho jaye' }
      ];

      const graph = buildDynamicKnowledgeGraph(memories, workingContext, 'Saa');

      expect(graph.totalNodes).toBeGreaterThanOrEqual(12);
      expect(graph.totalEdges).toBeGreaterThanOrEqual(12);

      // Core user node exists
      const userNode = graph.nodes.find(n => n.id === 'user-core');
      expect(userNode).toBeDefined();
      expect(userNode?.name).toBe('Saa');

      // 5 departments exist
      expect(graph.departments).toHaveLength(5);
      const deptNode = graph.nodes.find(n => n.id === 'dept-family');
      expect(deptNode).toBeDefined();
      expect(deptNode?.isDepartment).toBe(true);

      // Memory dots exist
      const sakshiNode = graph.nodes.find(n => n.id === 'mem-wife_name');
      expect(sakshiNode).toBeDefined();
      expect(sakshiNode?.name).toContain('Sakshi');
      expect(sakshiNode?.department).toBe('family');

      // Cross-domain edges exist
      const crossEdge = graph.edges.find(e => e.isCrossDomain);
      expect(crossEdge).toBeDefined();
    });

    it('formats hierarchical tree & stems prompt for Nova with clear branch-stem attribution and cross-domain bridges', () => {
      const memories = [
        { key: 'wife_name', value: 'Sakshi', memory_type: 'family' },
        { key: 'likes_wifes_cooking', value: 'User loves her traditional recipes', memory_type: 'family' },
        { key: 'son_name', value: 'Shreshth', memory_type: 'family' },
        { key: 'son_age', value: '6 months', memory_type: 'family' },
        { key: 'company_name', value: 'Acme Cloud Kitchen', memory_type: 'work' },
        { key: 'work_schedule', value: '11am to 8pm', memory_type: 'work' },
        { key: 'goals', value: 'Scale cloud kitchen to 5 cities', memory_type: 'goals' }
      ];
      const workingContext = [
        { key: 'candidates_for_job', value: 'Interviewing 4 chefs' }
      ];

      const promptText = formatHierarchicalMemoryPrompt(memories, workingContext, 'Saa');

      // Trunk & Branches exist
      expect(promptText).toContain('HIERARCHICAL KNOWLEDGE TREE & STEMS');
      expect(promptText).toContain('FAMILY & RELATIONSHIPS');
      expect(promptText).toContain('Sakshi');
      expect(promptText).toContain('Shreshth');
      expect(promptText).toContain('[STEM:');
      expect(promptText).toContain('6 months old');

      // Career & Work Branch/Stems
      expect(promptText).toContain('CAREER & PROFESSIONAL');
      expect(promptText).toContain('Acme Cloud Kitchen');
      expect(promptText).toContain('11am - 8pm');

      // Neural Bridges
      expect(promptText).toContain('NEURAL CROSS-DOMAIN BRIDGES');
      expect(promptText).toContain('EVENING_ROUTINE');
      expect(promptText).toContain('COLLABORATION');
    });

    it('creates separate multi-hop branches for third-party entities without polluting user relations', () => {
      const memories = [
        { key: 'father_name', value: 'Suresh', memory_type: 'family' },
        { key: 'entity:person_ejaz_father:military_service', value: 'Navy', memory_type: 'family' },
        { key: 'entity:person_sushant_wife:occupation', value: 'Banking', memory_type: 'family' },
      ];

      const graph = buildDynamicKnowledgeGraph(memories, [], 'Saa');

      // 1. User Father Node
      const userFather = graph.nodes.find(n => n.id === 'mem-father_name');
      expect(userFather).toBeDefined();
      expect(userFather?.name).toContain('Suresh');

      // 2. Ejaz (Friend) Branch & Ejaz's Father Sub-Branch
      const ejazNode = graph.nodes.find(n => n.id === 'mem-entity-ejaz');
      expect(ejazNode).toBeDefined();
      expect(ejazNode?.name).toBe('Ejaz (Friend)');

      const ejazFatherNode = graph.nodes.find(n => n.id === 'mem-entity-ejaz-father');
      expect(ejazFatherNode).toBeDefined();
      expect(ejazFatherNode?.name).toBe("Ejaz's Father");
      expect(ejazFatherNode?.parentEntityId).toBe('mem-entity-ejaz');

      // 3. Navy stem belongs to Ejaz's Father, NOT user father
      const navyStem = graph.nodes.find(n => n.raw_key === 'entity:person_ejaz_father:military_service');
      expect(navyStem).toBeDefined();
      expect(navyStem?.parentEntityId).toBe('mem-entity-ejaz-father');
      expect(navyStem?.value).toBe('Navy');

      // 4. Sushant (Friend) Branch & Sushant's Wife Sub-Branch
      const sushantNode = graph.nodes.find(n => n.id === 'mem-entity-sushant');
      expect(sushantNode).toBeDefined();
      const sushantWifeNode = graph.nodes.find(n => n.id === 'mem-entity-sushant-wife');
      expect(sushantWifeNode).toBeDefined();
      expect(sushantWifeNode?.parentEntityId).toBe('mem-entity-sushant');

      // 5. Prompt rendering preserves hierarchy
      const prompt = formatHierarchicalMemoryPrompt(memories, [], 'Saa');
      expect(prompt).toContain("Ejaz's Father");
      expect(prompt).toContain('Navy');
    });
  });

  describe('360° Canonical Schema & Child Birthdate Alignment', () => {
    it('canonicalizes child_birthdate to son_birth_date, never to user birth_date', () => {
      expect(canonicalizeKey('child_birthdate').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('child_birth_date').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('child_dob').canonical).toBe('son_birth_date');
      expect(canonicalizeKey('my_birthday').canonical).toBe('birth_date');
    });
  });
});

