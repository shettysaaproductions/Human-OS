import * as fs from "fs";
const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

console.log("Reminders:", JSON.stringify(data.reminders || [], null, 2));
console.log("Goals:", JSON.stringify(data.goals || [], null, 2));
console.log("Working Memory Reminders:", data.working_memory?.filter((w: any) => w.key.includes("remind") || w.key.includes("office")));
