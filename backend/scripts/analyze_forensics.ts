import * as fs from 'fs';

function run() {
  const data = JSON.parse(fs.readFileSync('forensic_dump.json', 'utf8'));

  // A. CHAT TIMELINE
  const colorKeywords = ['color', 'colour', 'blue', 'red', 'favorite', 'favourite', 'prefer', 'actually', 'change', 'instead', 'no', 'not', 'correction'];
  const chatMessages = data.chat.filter((msg: any) => {
    const text = (msg.content || '').toLowerCase();
    return colorKeywords.some(kw => text.includes(kw));
  });

  console.log('\n============================================================');
  console.log('A. CHAT TIMELINE');
  console.log('TIME | ROLE | MESSAGE | MEMORY EVENT');
  chatMessages.forEach((msg: any) => {
    console.log(`${msg.created_at} | ${msg.role.toUpperCase()} | ${msg.content} | [CHECK LOGS]`);
  });

  // B, C, D, E, F: Memories
  const colorMemories = data.memories.filter((m: any) => 
    (m.key || '').toLowerCase().includes('color') || 
    (m.key || '').toLowerCase().includes('colour')
  );
  
  const colorWm = data.working_memory.filter((m: any) => 
    (m.key || '').toLowerCase().includes('color') || 
    (m.key || '').toLowerCase().includes('colour')
  );

  console.log('\n============================================================');
  console.log('MEMORIES');
  console.log('DURABLE:', JSON.stringify(colorMemories, null, 2));
  console.log('WORKING:', JSON.stringify(colorWm, null, 2));

  console.log('\n============================================================');
  console.log('H & I. WATCHTOWER & SIGNALS');
  data.signals.forEach((s: any) => {
    if (s.created_at > '2026-09-01T20:15:00Z') {
      console.log(`SIGNAL: ${s.signal_type} at ${s.created_at}`);
    }
  });

  data.outreach.forEach((o: any) => {
    if (o.created_at > '2026-09-01T20:15:00Z') {
      console.log(`OUTREACH: at ${o.created_at}`);
    }
  });

}
run();
