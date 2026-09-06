import * as fs from "fs";

const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

let out = "";
for (const [table, rows] of Object.entries(data)) {
  const rs = rows as any[];
  if (rs.length > 0) {
    out += `\n--- TABLE: ${table} (${rs.length} rows) ---\n`;
    if (table === "chat_history") {
       rs.sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
       rs.forEach((r, i) => {
         out += `${i+1}. [${r.role}] ${r.content}\n`;
       });
    } else {
       out += JSON.stringify(rs, null, 2) + "\n";
    }
  }
}
fs.writeFileSync("analysis2.txt", out, "utf8");
