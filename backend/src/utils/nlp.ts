export const stopWords = new Set([
  // English (existing)
  'i', 'am', 'the', 'a', 'to', 'and', 'my', 'is', 'in', 'it', 
  'that', 'of', 'for', 'with', 'on', 'this', 'but', 'what', 
  'should', 'about', 'how', 'when', 'where', 'why', 'can', 'will',
  'who', 'whom', 'whose',
  // Hindi/Hinglish (NEW)
  'hai', 'hain', 'tha', 'thi', 'the', 'mein', 'ko', 'ka', 'ki', 'ke',
  'se', 'par', 'pe', 'bhi', 'aur', 'ya', 'toh', 'na', 'nahi', 'nai',
  'kya', 'kaise', 'kab', 'kahan', 'kyun', 'haan', 'ok', 'accha',
  'bas', 'abhi', 'yeh', 'woh', 'uska', 'uski', 'mera', 'meri',
  'tera', 'teri', 'apna', 'apni', 'kuch', 'sab', 'bahut', 'thoda',
  'bhai', 'bro', 'yaar', 'dude', 'hmm', 'hehe', 'lol', 'waise'
]);

// Maps natural Hinglish relationship, event, and activity terms to canonical English memory keys
export const CONCEPT_SYNONYM_EXPANSIONS: Record<string, string[]> = {
  // Family & Relationships
  biwi: ['wife'],
  patni: ['wife'],
  bivi: ['wife'],
  dharampatni: ['wife'],
  begum: ['wife'],
  pati: ['husband'],
  shauhar: ['husband'],
  beta: ['son', 'child'],
  bete: ['son', 'child'],
  bachha: ['child', 'kid'],
  baccha: ['child', 'kid'],
  bache: ['child', 'kid'],
  beti: ['daughter', 'child'],
  betiyan: ['daughter', 'child'],
  gudiya: ['daughter', 'child'],
  maa: ['mother', 'mom'],
  mummy: ['mother', 'mom'],
  mata: ['mother', 'mom'],
  aai: ['mother', 'mom'],
  papa: ['father', 'dad'],
  pitaji: ['father', 'dad'],
  abbu: ['father', 'dad'],
  bhaiya: ['brother'],
  behen: ['sister'],
  didi: ['sister'],
  dost: ['friend'],
  dostan: ['friend'],
  naam: ['name'],
  
  // Pets
  kutta: ['dog', 'pet'],
  kutti: ['dog', 'pet'],
  pilla: ['puppy', 'pet'],
  billi: ['cat', 'pet'],
  billu: ['cat', 'pet'],

  // Events & Life details
  janamdin: ['birthday'],
  bday: ['birthday'],
  umar: ['age'],
  saal: ['age', 'year'],
  mahina: ['month'],
  shaadi: ['wedding', 'anniversary'],

  // Career, Work & Study
  naukri: ['job', 'work', 'company'],
  kaam: ['work', 'job'],
  daftar: ['office', 'work'],
  padhai: ['study', 'college', 'exam'],
  pariksha: ['exam', 'test'],

  // Health, Fitness & Routine
  kasrat: ['workout', 'exercise', 'gym'],
  khana: ['food', 'diet', 'meal'],
  dawa: ['medicine', 'health'],
  dawakhana: ['doctor', 'hospital'],
  neend: ['sleep', 'routine'],
};

export function extractKeywords(userMessage: string): string[] {
  const words = userMessage
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const keywordSet = new Set<string>(words);

  // Expand concept synonyms so Hinglish queries find English canonical memory keys
  for (const word of words) {
    const synonyms = CONCEPT_SYNONYM_EXPANSIONS[word];
    if (synonyms) {
      for (const syn of synonyms) {
        keywordSet.add(syn);
      }
    }
  }

  return Array.from(keywordSet);
}

