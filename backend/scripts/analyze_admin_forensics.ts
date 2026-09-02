import * as fs from 'fs';
import * as path from 'path';

function run() {
  const dataPath = path.resolve(__dirname, '../forensic_dump_admin.json');
  if (!fs.existsSync(dataPath)) {
    console.log("Dump not found");
    return;
  }
  const dump = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const colorKeywords = ['color', 'colour', 'blue', 'red', 'favorite', 'favourite', 'prefer', 'actually', 'change', 'instead', 'no', 'not'];
  
  // A. CHAT TIMELINE
  console.log("============================================================");
  console.log("A. CHAT TIMELINE");
  console.log("============================================================");
  const colorChats = (dump.chatHistory || []).filter(c => {
    const text = (c.content || '').toLowerCase();
    return colorKeywords.some(kw => text.includes(kw));
  });

  console.log("TIME | ROLE | MESSAGE_ID | CONVERSATION_ID | MESSAGE");
  colorChats.forEach(c => {
    console.log(`${c.created_at} | ${c.role.toUpperCase()} | ${c.id} | ${c.conversation_id} | ${c.content}`);
  });

  // B. MEMORY PIPELINE TRACE
  console.log("\n============================================================");
  console.log("B. MEMORY PIPELINE TRACE");
  console.log("============================================================");
  
  // Group related entities by source message
  colorChats.forEach(c => {
    if (c.role !== 'user') return;
    console.log(`\n--- TRACE FOR MESSAGE: ${c.id} ---`);
    console.log(`USER MESSAGE: ${c.content}`);
    
    // Short term memory
    const stms = dump.shortTermMemories.filter(m => m.conversation_id === c.conversation_id && new Date(m.created_at) >= new Date(c.created_at));
    stms.forEach(stm => console.log(`↓ short_term_memories (id: ${stm.id}): ${stm.content}`));
    
    // Working memory
    const wms = dump.workingMemory.filter(m => m.source_message_id === c.id);
    wms.forEach(wm => console.log(`↓ working_memory (id: ${wm.id}, key: ${wm.key}, val: ${wm.value}, status: ${wm.promotion_status})`));
    
    // Synthesis claims
    const claims = dump.synthesisClaims.filter(cl => cl.source_message_id === c.id);
    claims.forEach(cl => console.log(`↓ candidate_synthesis_claims (id: ${cl.id}, candidate_key: ${cl.candidate_key}, new_value: ${cl.new_value}, status: ${cl.status})`));
    
    // Durable memories
    const mems = dump.memories.filter(m => m.source_message_id === c.id);
    mems.forEach(mem => console.log(`↓ durable memories (id: ${mem.id}, key: ${mem.key}, val: ${mem.value}, status: ${mem.lifecycle_state || mem.promotion_status || 'ACTIVE'})`));
  });

  // C. CANONICAL KEY INTEGRITY
  console.log("\n============================================================");
  console.log("C. CANONICAL KEY INTEGRITY");
  console.log("============================================================");
  const colorMems = dump.memories.filter(m => (m.key||'').toLowerCase().includes('color') || (m.key||'').toLowerCase().includes('colour'));
  const keys = new Set(colorMems.map(m => m.key));
  console.log(`Keys found: ${Array.from(keys).join(', ')}`);
  console.log(`CANONICALIZATION = ${keys.size === 1 ? 'PASS' : 'FAIL'}`);

  // D. CORRECTION SEMANTICS
  console.log("\n============================================================");
  console.log("D. CORRECTION SEMANTICS");
  console.log("============================================================");
  colorMems.forEach(m => {
    console.log(`Memory ID: ${m.id} | Key: ${m.key} | Value: ${m.value} | State: ${m.lifecycle_state || m.promotion_status || 'ACTIVE'} | Replaced By: ${m.replaced_by || 'NONE'} | Confidence: ${m.confidence}`);
  });

  // E. UNRELATED MEMORY PROTECTION
  console.log("\n============================================================");
  console.log("E. UNRELATED MEMORY PROTECTION");
  console.log("============================================================");
  console.log("Checking for mutations on non-color memories around the same time...");
  let unrelatedMutations = 0;
  // Look at memories updated recently
  const lastColorMsgTime = new Date(colorChats[colorChats.length-1].created_at);
  const recentMems = dump.memories.filter(m => {
    if ((m.key||'').toLowerCase().includes('color') || (m.key||'').toLowerCase().includes('colour')) return false;
    const upd = new Date(m.updated_at);
    return Math.abs(upd.getTime() - lastColorMsgTime.getTime()) < 60000; // within a minute of last msg
  });
  console.log(`Unrelated memories mutated near last message: ${recentMems.length}`);
  recentMems.forEach(m => console.log(`  -> Key: ${m.key}, Value: ${m.value}, Updated: ${m.updated_at}`));
  console.log(`UNRELATED_MUTATIONS = ${recentMems.length}`);

  // F. MEMORY AUTHORITY
  console.log("\n============================================================");
  console.log("F. MEMORY AUTHORITY");
  console.log("============================================================");
  colorMems.forEach(m => {
    console.log(`id: ${m.id} | auth: ${m.source_authority} | imp: ${m.importance} | conf: ${m.confidence} | status: ${m.lifecycle_state || m.promotion_status || 'ACTIVE'} | protected: ${m.is_protected}`);
  });

  // G. PROMOTION ENGINE
  console.log("\n============================================================");
  console.log("G. PROMOTION ENGINE");
  console.log("============================================================");
  const claims2 = dump.synthesisClaims.filter(cl => (cl.candidate_key||'').toLowerCase().includes('color') || (cl.candidate_key||'').toLowerCase().includes('colour'));
  if (claims2.length === 0) {
    console.log("WORKER_NOT_EXECUTED or no claims found for color");
  } else {
    claims2.forEach(cl => {
      console.log(`Claim ID: ${cl.id} | Status: ${cl.status} | Key: ${cl.candidate_key} | Action: ${cl.action_type} | Target Mem: ${cl.target_memory_id}`);
    });
  }

  // I. WATCHTOWER / WORKER FORENSICS
  console.log("\n============================================================");
  console.log("I. WATCHTOWER / WORKER FORENSICS");
  console.log("============================================================");
  console.log("Signals:");
  dump.watchtowerSignals.forEach(s => {
    console.log(`id: ${s.id} | type: ${s.signal_type} | created: ${s.created_at} | context: ${JSON.stringify(s.context_data)}`);
  });
  console.log("Outreach:");
  dump.outreachLog.forEach(o => {
    console.log(`id: ${o.id} | trigger: ${o.trigger_source} | created: ${o.created_at}`);
  });
  console.log("Agenda:");
  if (dump.agenda) {
    dump.agenda.forEach(a => {
      console.log(`id: ${a.id} | type: ${a.task_type} | created: ${a.created_at} | status: ${a.status}`);
    });
  }

  // J. EVENT ORDERING / RACE CONDITIONS
  console.log("\n============================================================");
  console.log("J. EVENT ORDERING / RACE CONDITIONS");
  console.log("============================================================");
  const allEvents = [];
  colorChats.forEach(c => allEvents.push({ type: 'CHAT', time: c.created_at, details: `${c.role}: ${c.content}` }));
  dump.workingMemory.forEach(w => {
    if ((w.key||'').toLowerCase().includes('color')) {
      allEvents.push({ type: 'WM_WRITE', time: w.created_at, details: `key: ${w.key}, val: ${w.value}, status: ${w.promotion_status}` });
    }
  });
  dump.synthesisClaims.forEach(cl => {
    if ((cl.candidate_key||'').toLowerCase().includes('color')) {
      allEvents.push({ type: 'CLAIM', time: cl.created_at, details: `status: ${cl.status}, action: ${cl.action_type}` });
    }
  });
  colorMems.forEach(m => {
    allEvents.push({ type: 'MEM_CREATE', time: m.created_at, details: `key: ${m.key}, val: ${m.value}` });
    if (m.updated_at !== m.created_at) {
      allEvents.push({ type: 'MEM_UPDATE', time: m.updated_at, details: `key: ${m.key}, val: ${m.value}, status: ${m.lifecycle_state || m.promotion_status}` });
    }
  });
  allEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  allEvents.forEach(e => console.log(`[${e.time}] ${e.type} - ${e.details}`));
}

run();
