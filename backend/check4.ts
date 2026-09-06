import * as fs from "fs";
const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

console.log("watchtower_heartbeat_runs:", JSON.stringify(data.watchtower_heartbeat_runs || [], null, 2));
