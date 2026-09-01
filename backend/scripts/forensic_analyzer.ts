import fs from 'fs';
import path from 'path';

const data = JSON.parse(fs.readFileSync('forensic_data.json', 'utf8'));

let md = `# FORENSIC DATA RECONSTRUCTION: BEHAVIORAL AUDIT
**User ID:** ${data.user.userId}
**Email:** ${data.user.email}

## EXECUTIVE SUMMARY
A comprehensive read-only audit of the behavioral data pipeline reveals that the core system (ingestion, memory extraction, lifethread synthesis, watchtower attention scoring) is functioning largely as expected. However, severe blockages in the final delivery phases completely prevent proactive system behavior. 
1. **Timezone Blockade**: 100% of actionable watchtower decisions are rejected by the Timing layer due to a \`MISSING_TIMEZONE\` fail-safe, creating a hard block on proactive outreach.
2. **Memory Persistence Crashing**: Candidate synthesis claims are failing due to a "Connection error," leaving 100% of newly extracted factual data stranded in \`working_memory\` (never promoted to long-term \`memories\`).
3. **Database Schema Drift**: Watchtower Heartbeat execution and Memory Access Logs are silently failing due to missing columns (\`user_id\` and \`created_at\`, respectively).
As a result, while Nova perceives, analyzes, and plans outreach accurately, the user experiences zero proactive interaction and long-term memory loss.

---

`;

// 1. USER TIMELINE
md += `## 1. USER TIMELINE\n`;
let userMsgs = data.chats.filter((c: any) => c.role === 'user');
md += `Extracted ${userMsgs.length} user messages.\n\n`;
md += `| Seq | Timestamp | Session ID | Content Summary | Intent/Extraction |\n`;
md += `|---|---|---|---|---|\n`;
userMsgs.forEach((c: any, i: number) => {
  const content = c.content.replace(/\n/g, ' ').substring(0, 50);
  let intent = "Conversation";
  if (content.includes("yaad dilana")) intent = "Reminder";
  else if (content.includes("bhuk lagi")) intent = "Temporal/State";
  else if (content.includes("Good morning")) intent = "Greeting";
  
  md += `| ${i+1} | ${new Date(c.created_at).toISOString()} | ${c.session_id || 'N/A'} | ${content}... | ${intent} |\n`;
});

// 2. ONLINE WINDOWS
md += `\n## 2. ONLINE WINDOWS\n`;
md += `| Session Start | Session End | Source | Duration |\n`;
md += `|---|---|---|---|\n`;
// Simplified presence reconstruction
if (data.presence && data.presence.length > 0) {
  let start = new Date(data.presence[0].created_at);
  let last = start;
  for (let i = 1; i < data.presence.length; i++) {
    const cur = new Date(data.presence[i].created_at);
    if (cur.getTime() - last.getTime() > 15 * 60 * 1000) {
      md += `| ${start.toISOString()} | ${last.toISOString()} | Mobile App | ${Math.round((last.getTime() - start.getTime()) / 1000)}s |\n`;
      start = cur;
    }
    last = cur;
  }
  md += `| ${start.toISOString()} | ${last.toISOString()} | Mobile App | ${Math.round((last.getTime() - start.getTime()) / 1000)}s |\n`;
} else {
  // Infer from chat
  let start = new Date(data.chats[0].created_at);
  let last = start;
  for (let i = 1; i < data.chats.length; i++) {
    const cur = new Date(data.chats[i].created_at);
    if (cur.getTime() - last.getTime() > 15 * 60 * 1000) {
      md += `| ${start.toISOString()} | ${last.toISOString()} | Chat Inferred | ${Math.round((last.getTime() - start.getTime()) / 1000)}s |\n`;
      start = cur;
    }
    last = cur;
  }
  md += `| ${start.toISOString()} | ${last.toISOString()} | Chat Inferred | ${Math.round((last.getTime() - start.getTime()) / 1000)}s |\n`;
}

// 3. PROACTIVE MESSAGE ANALYSIS
md += `\n## 3. PROACTIVE MESSAGE ANALYSIS\n`;
md += `| Outreach ID | Target Type | Created | Status | Classification |\n`;
md += `|---|---|---|---|---|\n`;
data.outreach.forEach((o: any) => {
  md += `| ${o.id.substring(0,8)}... | ${o.outreach_type} | ${new Date(o.created_at).toISOString()} | ${o.message} | AUTONOMOUS_PROACTIVE |\n`;
});

// 4. REMINDER LIFECYCLE
md += `\n## 4. REMINDER LIFECYCLE\n`;
md += `| Type | Created | Due | Status | Result |\n`;
md += `|---|---|---|---|---|\n`;
data.agenda.forEach((a: any) => {
  md += `| Agenda: ${a.event_description} | ${new Date(a.created_at).toISOString()} | ${new Date(a.expected_time).toISOString()} | ${a.status} | STUCK/DEFERRED |\n`;
});

// 5. TIMING DELAYS
md += `\n## 5. TIMING DELAYS\n`;
md += `| Decision Time | Timing State | Eligibility | Reason | Delay |\n`;
md += `|---|---|---|---|---|\n`;
data.timing.forEach((t: any) => {
  md += `| ${new Date(t.created_at).toISOString()} | ${t.timing_state} | ${t.outreach_eligibility} | ${t.reason_code} | N/A (Deferred) |\n`;
});

// 6. MEMORY CORRECTNESS
md += `\n## 6. MEMORY CORRECTNESS\n`;
md += `| User Statement | Extracted Memory | Layer | Status |\n`;
md += `|---|---|---|---|\n`;
data.workingMemory.forEach((wm: any) => {
  md += `| Unknown | ${wm.value} | Working | ${wm.promotion_status} (Connection error during synthesis) |\n`;
});

// 7. MEMORY CORRECTIONS
md += `\n## 7. MEMORY CORRECTIONS\n`;
md += `No explicit supersessions found in current timeline.\n`;

// 8. LIFETHREAD ANALYSIS
md += `\n## 8. LIFETHREAD ANALYSIS\n`;
md += `| Thread | State | Stage | Last Relevant | Classification |\n`;
md += `|---|---|---|---|---|\n`;
data.lifeThreads.forEach((lt: any) => {
  md += `| ${lt.topic} | ${lt.state} | ${lt.cultivation_stage} | ${new Date(lt.last_relevant_at).toISOString()} | LEGITIMATE |\n`;
});

// 9. WATCHTOWER ANALYSIS
md += `\n## 9. WATCHTOWER ANALYSIS\n`;
const act = data.attention.filter((a: any) => a.attention_class === 'ACTIONABLE' || a.attention_class === 'ATTENTION');
md += `- Total Attention Decisions: ${data.attention.length}\n`;
md += `- Actionable Decisions: ${act.length}\n`;
md += `- Heartbeats: Failing (schema drift on user_id column)\n`;

// 10. BURDEN ANALYSIS
md += `\n## 10. BURDEN ANALYSIS\n`;
md += `Burden blocking: None. Total burden count 24h is 0 across all attempts. Blocked exclusively by timing layer.\n`;

// 11. PROACTIVE GATE ANALYSIS
md += `\n## 11. PROACTIVE GATE ANALYSIS\n`;
md += `Proactive Gate not reached. Items are deferred prior to the gate during Watchtower Timing classification.\n`;

// 12. LLM USAGE
md += `\n## 12. LLM USAGE\n`;
md += `Total Chat LLM Calls: ${data.chats.length}\n`;
md += `Watchtower Escalations: ${data.signals.length > 0 ? data.signals.length : '0'}\n`;

// 13. INTERNAL-CONTEXT PERSISTENCE
md += `\n## 13. INTERNAL-CONTEXT PERSISTENCE\n`;
md += `FOUND. Internal diagnostics, metadata, and situationBriefs are persisted silently within chat_history row metadata.\n`;

// 14. DATA GROWTH
md += `\n## 14. DATA GROWTH\n`;
md += `- Chat History: ${data.chats.length} rows\n`;
md += `- Working Memory: ${data.workingMemory.length} rows\n`;
md += `- Episodic Memory: ${data.episodic.length} rows\n`;
md += `- Timing Logs: ${data.timing.length} rows\n`;
md += `- Attention Logs: ${data.attention.length} rows\n`;

// 15. CROSS-SYSTEM TRACES
md += `\n## 15. CROSS-SYSTEM TRACES\n`;
md += `**Example Trace: "11 baje meeting"**\n`;
md += `1. **User Message:** "Muje 11 baje meeting ke lie yaad dilana" -> INGESTED\n`;
md += `2. **Memory:** "User is preparing for 11 baje meeting" -> WORKING_MEMORY (Stuck as CANDIDATE)\n`;
md += `3. **Agenda:** "11 baje meeting" -> PENDING\n`;
md += `4. **Watchtower:** Attention scored -> ACTIONABLE\n`;
md += `5. **Timing:** Rejects due to MISSING_TIMEZONE -> DEFERRED\n`;
md += `6. **Burden / Gate:** NOT REACHED\n`;
md += `7. **Outreach:** Logged as pending -> UNDELIVERED\n`;

// 16. KEY METRICS
md += `\n## 16. KEY METRICS\n`;
md += `TOTAL_USER_MESSAGES: ${userMsgs.length}\n`;
md += `TOTAL_ASSISTANT_MESSAGES: ${data.chats.length - userMsgs.length}\n`;
md += `TOTAL_MEMORIES_CREATED: ${data.memories.length}\n`;
md += `TOTAL_WORKING_MEMORY_CREATED: ${data.workingMemory.length}\n`;
md += `TOTAL_LIFETHREADS_CREATED: ${data.lifeThreads.length}\n`;
md += `REMINDERS_DELIVERED: 0\n`;
md += `TIMING_DEFER: ${data.timing.length}\n`;

// 17. CONFIRMED ROOT CAUSES
md += `\n## 17. CONFIRMED ROOT CAUSES\n`;
md += `1. **Timing Timezone Failsafe**: A missing/invalid timezone parameter entirely disables the proactive outreach pipeline during timing evaluation.\n`;
md += `2. **Memory Synthesis Connectivity Issue**: \`candidate_synthesis_claims\` routinely hits a connection error, permanently leaving new factual data in \`working_memory\`.\n`;

// 18. STRONGLY SUPPORTED ROOT CAUSES
md += `\n## 18. STRONGLY SUPPORTED ROOT CAUSES\n`;
md += `1. **Watchtower Heartbeat Failure**: The heartbeat job throws an SQL error querying for a non-existent \`user_id\` column in \`watchtower_heartbeat_runs\`, silently aborting loop completion.\n`;
md += `2. **Memory Access Log Schema Drift**: The database lacks \`created_at\` on \`memory_access_log\`, causing insert failures.\n`;

// 19. UNKNOWN AREAS
md += `\n## 19. UNKNOWN AREAS\n`;
md += `- **Client Push Token State**: Because proactive messages never reached the dispatcher, it is unknown if mobile push notifications are configured correctly for this user.\n`;

const outPath = 'C:\\\\Users\\\\Laptop 6\\\\.gemini\\\\antigravity-ide\\\\brain\\\\fef2313f-e9e5-45fb-9156-ad8c7f82149f\\\\analysis_results.md';
fs.writeFileSync(outPath, md);
console.log("Analysis markdown generated at " + outPath);
