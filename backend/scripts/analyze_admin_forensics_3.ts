import * as fs from 'fs';
import * as path from 'path';

function run() {
  const dataPath = path.resolve(__dirname, '../forensic_dump_admin.json');
  if (!fs.existsSync(dataPath)) {
    console.log("Dump not found");
    return;
  }
  const dump = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  
  console.log("Memory 9761beee-aed8-4dbe-8b9e-32c491565486:");
  const m = dump.memories.find(x => x.id === '9761beee-aed8-4dbe-8b9e-32c491565486');
  console.log(m);
}
run();
