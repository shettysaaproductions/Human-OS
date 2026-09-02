import * as fs from 'fs';
import * as path from 'path';

function run() {
  const dataPath = path.resolve(__dirname, '../forensic_dump_admin.json');
  if (!fs.existsSync(dataPath)) {
    console.log("Dump not found");
    return;
  }
  const dump = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const c1 = "d4dec555-97b3-4123-b68a-2abc422f69a7";
  const c2 = "f37bb884-e464-42ef-9b01-c1db4fd0f8e5";
  
  console.log("TRACE FOR MSG 1: " + c1);
  console.log("WM:", dump.workingMemory.filter(w => w.source_message_id === c1));
  console.log("MEM:", dump.memories.filter(m => m.source_message_id === c1));
  console.log("CLAIMS:", dump.synthesisClaims.filter(c => c.source_message_id === c1));
  console.log("STM:", dump.shortTermMemories.filter(s => s.source_message_id === c1));
  
  console.log("TRACE FOR MSG 2: " + c2);
  console.log("WM:", dump.workingMemory.filter(w => w.source_message_id === c2));
  console.log("MEM:", dump.memories.filter(m => m.source_message_id === c2));
  console.log("CLAIMS:", dump.synthesisClaims.filter(c => c.source_message_id === c2));
  console.log("STM:", dump.shortTermMemories.filter(s => s.source_message_id === c2));

  console.log("ALL WM around that time:");
  dump.workingMemory.filter(w => new Date(w.created_at) > new Date("2026-09-01T20:17:00Z")).forEach(w => console.log(w.key, w.value, w.source_message_id));
}
run();
