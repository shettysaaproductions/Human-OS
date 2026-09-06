import * as fs from "fs";

const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;
const chat = data.chat_history || [];
chat.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

let out = "## 2. COMPLETE CHAT TRANSCRIPT\n\n";
let totalUser = 0;
let totalNova = 0;
let novaLengths: number[] = [];
let shortNova = 0;

chat.forEach((r: any, i: number) => {
   out += `**Turn ${i+1}**\n`;
   out += `- Timestamp: ${r.created_at}\n`;
   out += `- Speaker: ${r.role === "user" ? "USER" : "NOVA"}\n`;
   out += `- ID: ${r.id}\n`;
   out += `\n${r.role === "user" ? "USER:" : "NOVA:"}\n${r.content}\n\n---\n\n`;
   
   if (r.role === "user") totalUser++;
   if (r.role === "assistant") {
      totalNova++;
      novaLengths.push(r.content.length);
      if (r.content.split(" ").length <= 10) shortNova++; // heuristic
   }
});

out += `### Stats\n`;
out += `- Total user messages: ${totalUser}\n`;
out += `- Total Nova messages: ${totalNova}\n`;
out += `- Total turns: ${chat.length}\n`;
if (novaLengths.length > 0) {
  out += `- Avg Nova length: ${novaLengths.reduce((a,b)=>a+b,0)/novaLengths.length}\n`;
  out += `- Min Nova length: ${Math.min(...novaLengths)}\n`;
  out += `- Max Nova length: ${Math.max(...novaLengths)}\n`;
}
out += `- Number of short (<= 10 words) Nova responses: ${shortNova}\n`;
fs.writeFileSync("part_a.md", out, "utf8");
