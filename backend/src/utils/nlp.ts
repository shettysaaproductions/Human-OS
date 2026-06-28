export const stopWords = new Set([
  'i', 'am', 'the', 'a', 'to', 'and', 'my', 'is', 'in', 'it', 
  'that', 'of', 'for', 'with', 'on', 'this', 'but', 'what', 
  'should', 'about', 'how', 'when', 'where', 'why', 'can', 'will',
  'who', 'whom', 'whose'
]);

export function extractKeywords(userMessage: string): string[] {
  const words = userMessage
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return Array.from(new Set(words));
}
