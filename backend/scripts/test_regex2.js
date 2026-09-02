const phrases = [
  "Ek correction hai mera favourite color blue hai",
  "Actually my favourite color is blue",
  "Actually, correct that — my favourite color is blue",
  "Nahi, favourite color blue hai",
  "Galat tha, mera favourite color blue hai",
  "Correction: favourite color blue",
  "Make that blue",
  "Instead, blue",
  "Blue is my favourite color, not red"
];

function extractStructuredCorrection(text) {
  let lower = text.toLowerCase();
  
  // 1. Identify and strip correction markers
  const markerRegex = /\b(actually|correction|nahi(?: yaar)?|galat(?: tha)?|not that|instead|wait no|correction:?|ek correction hai|correct that\s*[-—]*)\b/ig;
  const hasMarker = markerRegex.test(lower);
  lower = lower.replace(markerRegex, '').replace(/^[,.\-\s—]+|[,.\-\s—]+$/g, '').trim();

  // If text is like "Make that blue" or "Instead, blue" -> antecedent needed
  const directValueMatch = lower.match(/^(?:make that|make it)\s+([a-z0-9\s]+)$/i) || 
                           (hasMarker && lower.split(/\s+/).length <= 2 ? [null, lower] : null);
  if (directValueMatch && directValueMatch[1]) {
    return { concept: null, value: directValueMatch[1].trim() };
  }

  // 2. Try generic split: "<Concept> is/hai <Value>"
  let match = lower.match(/^(?:my|mera|meri|merko)?\s*(.+?)\s+(?:is|hai|toh)\s+(.+?)(?:\s+hai|\s+is|\.|$)/i);
  if (match) {
    return { concept: match[1].trim(), value: match[2].trim() };
  }
  
  // 3. Try reverse: "<Value> is my <Concept>"
  match = lower.match(/^([a-z0-9\s]+?)\s+(?:is|hai)\s+(?:my|mera|meri)?\s*(.+?)(?:,|\s+not\s+.*|\.|$)/i);
  if (match) {
    return { concept: match[2].trim(), value: match[1].trim() };
  }
  
  // 4. Try space-based fallback for "<Concept> <Value> hai"
  match = lower.match(/^(?:my|mera|meri)?\s*(.+?)\s+([a-z0-9]+)(?:\s+hai|\s+is|\.|$)/i);
  if (match) {
    return { concept: match[1].trim(), value: match[2].trim() };
  }
  
  return null;
}

for (const p of phrases) {
  console.log(`\nText: "${p}"`);
  console.log(extractStructuredCorrection(p));
}
