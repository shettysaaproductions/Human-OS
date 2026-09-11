import {
  clusterMemoriesIntoWardrobes,
  buildDynamicKnowledgeGraph,
  formatHierarchicalMemoryPrompt,
  classifyDomain
} from '../../lib/memoryDomains';

describe('Open Cupboard Dynamic Memory Architecture (Drawers & Stems)', () => {
  const diverseMemories = [
    // Core user identity
    { id: '1', key: 'preferred_name', value: 'Sagar', memory_type: 'personal' },
    
    // Dynamic Drawer 1: Pet (Coco)
    { id: '2', key: 'pet_coco_breed', value: 'Golden Retriever', memory_type: 'family' },
    { id: '3', key: 'pet_coco_age', value: '2 years old', memory_type: 'family' },
    { id: '4', key: 'pet_coco_favorite_toy', value: 'Tennis ball', memory_type: 'lifestyle' },

    // Dynamic Drawer 2: Friend & Mentor (Rohit)
    { id: '5', key: 'friend_rohit_job', value: 'Architect in Berlin', memory_type: 'personal' },
    { id: '6', key: 'friend_rohit_call_routine', value: 'Weekly Sunday catch-up call', memory_type: 'lifestyle' },

    // Dynamic Drawer 3: Tech Project (Helios)
    { id: '7', key: 'project_helios_stack', value: 'Next.js, FastAPI and PostgreSQL', memory_type: 'work' },
    { id: '8', key: 'project_helios_deadline', value: 'Q4 2026 launch', memory_type: 'work' },
    { id: '9', key: 'project_helios_vision', value: 'Autonomous clean energy trading platform', memory_type: 'goals' },

    // Dynamic Drawer 4: Musical Instrument (Guitar)
    { id: '10', key: 'guitar_brand', value: 'Fender', memory_type: 'preferences' },
    { id: '11', key: 'guitar_model', value: 'Stratocaster Olympic White', memory_type: 'preferences' },

    // Dynamic Drawer 5: Vehicle
    { id: '12', key: 'car_model', value: 'Honda Civic 2022', memory_type: 'preferences' },
    { id: '13', key: 'car_color', value: 'Sonic Gray Pearl', memory_type: 'preferences' },

    // Dynamic Drawer 6: Marathon Athletic Goal
    { id: '14', key: 'marathon_target', value: 'Sub-4 hours in Mumbai Marathon Dec 2026', memory_type: 'goals' },
  ];

  describe('1. Open-Ended Dynamic Drawer Synthesizer in clusterMemoriesIntoWardrobes', () => {
    it('automatically generates distinct Entity Wardrobes (Drawers) for arbitrary topics', () => {
      const { wardrobes } = clusterMemoriesIntoWardrobes(diverseMemories as any, []);

      // Check Pet Coco Wardrobe
      const cocoWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'coco');
      expect(cocoWardrobe).toBeDefined();
      expect(cocoWardrobe?.avatarEmoji).toBe('🐶');
      expect(cocoWardrobe?.roleTitle).toBe('Companion Pet');
      expect(cocoWardrobe?.domain).toBe('family');
      expect(cocoWardrobe?.traits.length).toBeGreaterThanOrEqual(3);

      const breedTrait = cocoWardrobe?.traits.find(t => t.key === 'pet_coco_breed');
      expect(breedTrait).toBeDefined();
      expect(breedTrait?.value).toBe('Golden Retriever');

      // Check Friend Rohit Wardrobe
      const rohitWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'rohit');
      expect(rohitWardrobe).toBeDefined();
      expect(rohitWardrobe?.avatarEmoji).toBe('👥');
      expect(rohitWardrobe?.roleTitle).toBe('Close Friend');
      expect(rohitWardrobe?.entityType).toBe('person');
      expect(rohitWardrobe?.traits.length).toBeGreaterThanOrEqual(2);

      // Check Project Helios Wardrobe
      const heliosWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'helios');
      expect(heliosWardrobe).toBeDefined();
      expect(heliosWardrobe?.avatarEmoji).toBe('💻');
      expect(heliosWardrobe?.roleTitle).toBe('Project & Venture');
      expect(heliosWardrobe?.domain).toBe('work');
      expect(heliosWardrobe?.entityType).toBe('business');
      expect(heliosWardrobe?.traits.length).toBeGreaterThanOrEqual(3);

      // Check Guitar Wardrobe
      const guitarWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'guitar');
      expect(guitarWardrobe).toBeDefined();
      expect(guitarWardrobe?.avatarEmoji).toBe('🎸');
      expect(guitarWardrobe?.roleTitle).toBe('Musical Instrument');
      expect(guitarWardrobe?.domain).toBe('lifestyle');
      expect(guitarWardrobe?.traits.length).toBeGreaterThanOrEqual(2);

      // Check Car Wardrobe
      const carWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'car');
      expect(carWardrobe).toBeDefined();
      expect(carWardrobe?.avatarEmoji).toBe('🚗');
      expect(carWardrobe?.roleTitle).toBe('Vehicle & Mobility');

      // Check Marathon Wardrobe
      const marathonWardrobe = wardrobes.find(w => w.name.toLowerCase() === 'marathon');
      expect(marathonWardrobe).toBeDefined();
      expect(marathonWardrobe?.avatarEmoji).toBe('🏃');
      expect(marathonWardrobe?.domain).toBe('goals');
    });
  });

  describe('2. True Hierarchical Tree & Stems in buildDynamicKnowledgeGraph', () => {
    it('creates Level 2 Entity Branches and Level 3 Attribute Stems for arbitrary entities', () => {
      const kg = buildDynamicKnowledgeGraph(diverseMemories as any, [], 'Sagar');

      // Core Self exists
      const coreNode = kg.nodes.find(n => n.id === 'user-core');
      expect(coreNode).toBeDefined();

      // Coco Pet Entity Branch exists at Level 2 under Family
      const cocoBranch = kg.nodes.find(n => n.id === 'mem-pet_coco');
      expect(cocoBranch).toBeDefined();
      expect(cocoBranch?.hierarchyLevel).toBe(2);
      expect(cocoBranch?.department).toBe('family');
      expect(cocoBranch?.emoji).toBe('🐶');

      // Pet Coco Breed Stem exists at Level 3 connected to mem-pet_coco
      const breedStem = kg.nodes.find(n => n.id === 'mem-pet_coco_breed');
      expect(breedStem).toBeDefined();
      expect(breedStem?.hierarchyLevel).toBe(3);
      expect(breedStem?.parentEntityId).toBe('mem-pet_coco');

      // Edge from Coco branch to Breed stem
      const breedEdge = kg.edges.find(e => e.target === 'mem-pet_coco_breed');
      expect(breedEdge).toBeDefined();
      expect(breedEdge?.source).toBe('mem-pet_coco');
      expect(breedEdge?.edgeType).toBe('ATTRIBUTE_STEM');

      // Project Helios Entity Branch exists at Level 2 under Work
      const heliosBranch = kg.nodes.find(n => n.id === 'mem-project_helios');
      expect(heliosBranch).toBeDefined();
      expect(heliosBranch?.hierarchyLevel).toBe(2);
      expect(heliosBranch?.department).toBe('work');

      // Project Helios Stack exists at Level 3 under Helios
      const stackStem = kg.nodes.find(n => n.id === 'mem-project_helios_stack');
      expect(stackStem).toBeDefined();
      expect(stackStem?.hierarchyLevel).toBe(3);
      expect(stackStem?.parentEntityId).toBe('mem-project_helios');

      // Guitar Entity Branch exists at Level 2 under Lifestyle
      const guitarBranch = kg.nodes.find(n => n.id === 'mem-guitar');
      expect(guitarBranch).toBeDefined();
      expect(guitarBranch?.hierarchyLevel).toBe(2);
      expect(guitarBranch?.department).toBe('lifestyle');

      const brandStem = kg.nodes.find(n => n.id === 'mem-guitar_brand');
      expect(brandStem).toBeDefined();
      expect(brandStem?.hierarchyLevel).toBe(3);
      expect(brandStem?.parentEntityId).toBe('mem-guitar');
    });
  });

  describe('3. formatHierarchicalMemoryPrompt includes all drawers and stems for Nova reasoning', () => {
    it('renders complete cupboard tree structure in the prompt', () => {
      const promptText = formatHierarchicalMemoryPrompt(diverseMemories as any, [], 'Sagar');

      expect(promptText).toContain('HIERARCHICAL KNOWLEDGE TREE & STEMS');
      expect(promptText).toContain('FAMILY & RELATIONSHIPS');
      expect(promptText).toContain('CAREER & PROFESSIONAL');
      expect(promptText).toContain('LIFESTYLE & DAILY RHYTHM');
      expect(promptText).toContain('GOALS & AMBITIONS');

      // Branches
      expect(promptText).toContain('Coco');
      expect(promptText).toContain('Helios');
      expect(promptText).toContain('Guitar');

      // Stems
      expect(promptText).toContain('Golden Retriever');
      expect(promptText).toContain('Next.js, FastAPI and PostgreSQL');
      expect(promptText).toContain('Fender');

      // Clustered Wardrobes Section
      expect(promptText).toContain('ENTITY WARDROBES & LIFE CLUSTERS');
      expect(promptText).toContain('🐶 [COCO · Companion Pet]');
      expect(promptText).toContain('💻 [HELIOS · Project & Venture]');
      expect(promptText).toContain('🎸 [GUITAR · Musical Instrument]');
    });
  });

  describe('4. classifyDomain prefix routing', () => {
    it('routes open-ended entity prefixes to correct life domain compartments', () => {
      expect(classifyDomain('pet_coco_breed').domain).toBe('family');
      expect(classifyDomain('friend_rohit_job').domain).toBe('family');
      expect(classifyDomain('mentor_verma_thesis').domain).toBe('family');
      expect(classifyDomain('project_helios_stack').domain).toBe('work');
      expect(classifyDomain('guitar_model').domain).toBe('lifestyle');
      expect(classifyDomain('car_civic_mileage').domain).toBe('lifestyle');
      expect(classifyDomain('marathon_target').domain).toBe('goals');
    });
  });
});
