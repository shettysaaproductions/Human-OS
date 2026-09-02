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

const patterns = [
  // "Actually my favourite color is blue" / "mera favourite color blue hai" / "favourite color blue hai"
  /(?:my|mera|meri)?\s*([a-z\s_]{3,30}?)\s+(?:is|hai|toh)?\s+([a-z0-9\s]+?)(?:\s+hai|\s+is|\.|,|$)/i,
];

for (const p of phrases) {
  // Try to find the structural marker
  const marker = /\b(actually|correction|nahi|galat|instead|make that|correct that)\b/i.test(p);
  console.log(`\nText: "${p}" | marker: ${marker}`);
  
  // Specific pattern for "Make that X", "Instead, X"
  let match = p.match(/\b(?:make that|instead,?\s*)\s+([a-z0-9\s]+?)(?:\.|$)/i);
  if (match) {
    console.log(`  -> Action: Replace (Antecedent needed) | Value: ${match[1]}`);
    continue;
  }
  
  // "<Value> is my <Concept>, not <OldValue>"
  match = p.match(/([a-z0-9\s]+?)\s+(?:is|hai)\s+(?:my|mera|meri)?\s*([a-z\s_]{3,30}?)(?:,|\s+not\s+([a-z0-9\s]+))?(?:\.|$)/i);
  if (match && match[2] && !match[2].includes('correction')) {
    console.log(`  -> Inverse Match! Concept: '${match[2].trim()}', Value: '${match[1].trim()}'`);
    continue;
  }

  // "<Concept> is <Value>"
  match = p.match(/(?:my|mera|meri|merko)?\s*([a-z\s_]{3,30}?)\s+(?:is|hai)\s+([a-z0-9\s]+?)(?:\s+hai|\s+is|\.|$)/i);
  if (match && !match[1].includes('correction') && !match[1].includes('actually') && !match[1].includes('galat')) {
    console.log(`  -> Forward Match 1! Concept: '${match[1].trim()}', Value: '${match[2].trim()}'`);
    continue;
  }

  // "Correction: favourite color blue" (No 'is/hai')
  match = p.match(/(?:my|mera|meri)?\s*([a-z\s_]{3,30}?)\s+([a-z0-9]+?)(?:\.|$)/i);
  if (match && !match[1].includes('correction')) {
    console.log(`  -> Fallback Match! Concept: '${match[1].trim()}', Value: '${match[2].trim()}'`);
  }
}
