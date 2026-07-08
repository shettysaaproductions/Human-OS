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

export function extractKeywords(userMessage: string): string[] {
  const words = userMessage
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return Array.from(new Set(words));
}
