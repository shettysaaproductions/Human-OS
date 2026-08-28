const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scripts/forensic_snapshot_full.json', 'utf8'));

console.log('=== MEMORIES DETAILS & PROVENANCE ===');
data.memories.forEach((m, idx) => {
  console.log(`[${idx+1}] Key: "${m.key}" | Value: "${m.value}" | Type: "${m.memory_type}" | Source: "${m.source_message}" | Created: ${m.created_at}`);
});
