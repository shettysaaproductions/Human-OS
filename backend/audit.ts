import { supabaseAdmin } from "./src/lib/supabase";
import * as fs from "fs";

async function dump() {
  const { data: users, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) {
     console.error(authErr);
     return;
  }
  
  if (!users.users || users.users.length === 0) {
     console.log("No users found.");
     return;
  }
  
  const userId = users.users[0].id;
  console.log(`Auditing User: ${userId}`);
  
  const tables = [
    "chat_history", "memories", "memory_events", "working_memory", "episodic_memories",
    "short_term_memories", "kg_nodes", "kg_edges", "life_threads", "reminders",
    "nova_actions", "nova_thoughts", "nova_followups", "nova_agenda", "nova_corrections_log",
    "nova_cognitive_doubts", "nova_guardian_runs", "nova_guardian_anomalies", "nova_guardian_repairs",
    "nova_outreach_log", "user_routines", "reflections", "emotional_states", "user_presence",
    "user_moments", "user_moment_preferences", "watchtower_cognitive_signals",
    "watchtower_attention_decisions", "watchtower_timing_logs", "background_jobs",
    "audit_logs", "tombstones", "telemetry_events", "profiles"
  ];
  
  const auditData: Record<string, any[]> = {};
  
  for (const t of tables) {
     const { data, error } = await supabaseAdmin.from(t).select("*").limit(1000);
     if (error) {
        console.error(`Error fetching ${t}:`, error.message);
        continue;
     }
     
     // Filter by user_id if column exists
     const filtered = data.filter(r => {
         if (t === "profiles" && r.id !== userId) return false;
         if ("user_id" in r && r.user_id !== userId) return false;
         // background_jobs payload check
         if (t === "background_jobs" && r.payload && r.payload.user_id && r.payload.user_id !== userId) return false;
         if (t === "telemetry_events" && r.properties && r.properties.user_id && r.properties.user_id !== userId) return false;
         return true;
     });
     
     auditData[t] = filtered;
  }
  
  fs.writeFileSync("audit_dump.json", JSON.stringify({ userId, data: auditData }, null, 2));
  console.log("Audit data dumped to audit_dump.json");
}

dump();
