import * as fs from "fs";
const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

console.log("nova_agenda:", JSON.stringify(data.nova_agenda || [], null, 2));
