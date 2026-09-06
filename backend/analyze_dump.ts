import * as fs from "fs";

const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

for (const [table, rows] of Object.entries(data)) {
  const rs = rows as any[];
  if (rs.length > 0) {
    console.log(`\n--- TABLE: ${table} (${rs.length} rows) ---`);
    if (table === "chat_history") {
       rs.sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
       rs.forEach((r, i) => console.log(`${i+1}. [${r.role}] ${r.content}`));
    } else {
       console.log(JSON.stringify(rs, null, 2));
    }
  }
}
