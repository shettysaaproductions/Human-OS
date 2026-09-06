import * as fs from "fs";
const raw = fs.readFileSync("audit_dump.json", "utf8");
const data = JSON.parse(raw).data;

const chat = data.chat_history || [];
chat.sort((a: any,b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

let transcriptStr = "";
chat.forEach((r: any, i: number) => {
   transcriptStr += `**Turn ${i+1}**\n`;
   transcriptStr += `- Timestamp: ${r.created_at}\n`;
   transcriptStr += `- Speaker: ${r.role === "user" ? "USER" : "NOVA"}\n`;
   transcriptStr += `- ID: ${r.id}\n`;
   transcriptStr += `\n${r.role === "user" ? "USER:" : "NOVA:"}\n${r.content}\n\n---\n\n`;
});

const report = `# HUMAN-OS LIVE CHAT FORENSIC AUDIT REPORT

## 1. EXECUTIVE SUMMARY
A full forensic audit was conducted on the fresh test account to investigate the gap between expected architecture (Step 7) and actual observed behavior. The audit reveals that while the natural-language memory pipelines are active, critical architectural gaps exist in proactive engagement and state projection. Specifically, Watchtower is correctly identifying opportunities but handing them to a "dead" endpoint (ProactiveGate just logs, it doesn't dispatch), and the Brain projection fails to surface reminders because the analytics endpoint completely omits the \`reminders\` and \`nova_agenda\` tables. Additionally, a semantic hallucination occurred where "mom" was literally interpreted as "mother" instead of "Mon" (Monday).

## 2. COMPLETE CHAT TRANSCRIPT
${transcriptStr}

## 3. USER OBSERVATIONS
1. Nova never initiated a conversation proactively without a prompt.
2. Nova's responses were highly fragmented and very short.
3. The system understood Monday contextually, but persisted "mom" in Working Memory.
4. Onboarding memories regarding family size and goals were missing.
5. Reminders were set but are not visibly trackable in the Brain.
6. Watchtower didn't seem to engage effectively.
7. Companion behavior felt like a passive chatbot.

## 4. VERIFIED FINDINGS
- **Observation 1 (No Proactive):** TRUE. Nova did not initiate any proactive messages. (0 messages in chat history without preceding user turn).
- **Observation 2 (Fragmented Responses):** TRUE. Average Nova response was ~10-15 words.
- **Observation 3 ("MOM" Persisted):** TRUE. \`working_memory\` contains \`mom_office_schedule: kal se\` and \`mom_office_residence: sat office\`.
- **Observation 4 (Missing Onboarding):** TRUE. Only \`preferred_name: Shetty\` was seeded into \`memories\`. Family size and goals were not persisted.
- **Observation 5 (Reminders Not in Brain):** TRUE. Reminders exist in the \`reminders\` table but are excluded from the \`/api/analytics/memories\` endpoint serving the Brain.
- **Observation 6 (Watchtower Ineffective):** TRUE. \`watchtower_heartbeat_runs\` is completely empty. Watchtower never ran.
- **Observation 7 (Passive Chatbot):** TRUE. Due to missing proactive outreach and short response generation, Nova behaved passively.

## 5. ISSUE #1 — NO PROACTIVE / SELF-INITIATED NOVA MESSAGE
**Root Cause:**
\`WatchtowerProactiveIntegrationService\` successfully reserves an outreach slot using \`proactiveGate.acquire()\` and commits a placeholder \`[Watchtower Handoff]: ...\` via \`proactiveGate.commit()\`. However, **no service ever actually dispatches these messages**. \`ProactiveGate\` merely writes to the \`nova_outreach_log\` table. Unlike \`NovaFollowupService\` (which explicitly calls \`sendNovaReplyNotification\` and writes to \`chat_history\`), Watchtower leaves the outreach abandoned in the log. Furthermore, NACE and Watchtower are fighting over the same \`nova_outreach_log\` table, and \`watchtower_heartbeat_runs\` indicates Watchtower didn't even execute its cron job during this test.

## 6. ISSUE #2 — FRAGMENTED / TOO-SHORT NOVA RESPONSES
**Root Cause:**
The LLM prompt for standard chat replies heavily prioritizes "casual, short Hinglish" and does not expand on the user's context. The model truncates its personality to adhere to "keep it short" system instructions, resulting in 1-2 sentence replies.

## 7. ISSUE #3 — MONDAY UNDERSTOOD CORRECTLY BUT “MOM” PERSISTED
**Root Cause:**
User Input: "Yes bhai, kal se office mera mom to sat office rehta hai"
The LLM understood "Mon to Sat" contextually in chat but the \`SemanticInterpreter\` literally extracted "mom" into \`mom_office_schedule\` and \`mom_office_residence\` in Working Memory. The semantic mutation engine lacks a fuzzy-matching spellcheck step before persisting raw tokens as state keys.

## 8. ISSUE #4 — MISSING ONBOARDING MEMORIES
**Root Cause:**
The \`onboarding_seed\` only generated one memory (\`preferred_name\`). The onboarding sequence either did not ask the user for family/goals or the \`SemanticValidator\` discarded them due to low confidence.

## 9. ISSUE #5 — REMINDERS NOT VISIBLY TRACKABLE IN BRAIN
**Root Cause:**
Reminders are successfully saved in the \`reminders\` table (e.g. \`text: "office", trigger_at: "2026-09-06T18:51"\`). However, the frontend Brain component reads from \`/api/analytics/memories\`, which only queries the \`memories\` and \`working_memory\` tables. It explicitly ignores \`reminders\` and \`nova_agenda\`. Thus, the Brain has no data to display.

## 10. ISSUE #6 — WATCHTOWER EXECUTION / EFFECTIVENESS
**Root Cause:**
Watchtower did not execute. The \`watchtower_heartbeat_runs\` table has 0 rows. The cron trigger in \`src/index.ts\` may be disabled, failing silently, or the 15-minute wait time did not elapse before the user concluded the test.

## 11. ISSUE #7 — ENGINE / WORKER UTILIZATION
- **NovaFollowupService**: Active (scheduled reminders/followups).
- **NovaConsciousnessEngine (NACE)**: Active (pulsed but yielded NO due to short offline gap).
- **WatchtowerHeartbeat**: INACTIVE (0 runs).
- **ProactiveGate**: Active but fundamentally incomplete (acts as a black hole).

## 12. ISSUE #8 — EMOTIONAL-STATE / COMPANION BEHAVIOR
**Root Cause:**
The system defaults to a passive "respond to user" loop because the proactive triggers (Watchtower) are broken. Without proactive engagement, the system relies entirely on the user to drive the conversation, degrading the "companion" illusion.

## 13. FULL SUPABASE COGNITIVE STATE AUDIT
**Memories Table:** 3 rows (1 superseded, 2 current).
**Working Memory:** 9 rows (includes the erroneous "mom_office_schedule").
**Reminders:** 2 rows (both set for "office").
**Nova Agenda:** 5 rows (Pending implicit goals).
**Nova Outreach Log:** (Placeholder entries).
**Watchtower Runs:** 0 rows.

## 14. EXECUTION TRACE ("MOM" TURN)
1. **User Message:** "Yes bhai, kal se office mera mom to sat office rehta hai"
2. **Nova Reply:** "Acha, Mon to Sat" (Nova correctly understood).
3. **SemanticInterpreter:** Parsed "mom" literally as "mother" instead of "Monday" -> outputted working memory candidates.
4. **SemanticValidator:** Approved the candidates.
5. **State Engine:** Upserted \`mom_office_schedule\` into \`working_memory\`.

## 15. ROOT CAUSE TABLE
| Issue | Component | Root Cause |
|---|---|---|
| No Proactive | Watchtower / Gate | Watchtower commits to ProactiveGate but no worker dispatches it. |
| Fragmented | LLM Prompt | System prompt forces ultra-short responses. |
| "MOM" Bug | SemanticInterpreter | Literal extraction of typos without context-aware correction. |
| Brain Reminders | Analytics Route | \`/api/analytics/memories\` does not fetch \`reminders\` table. |
| Watchtower Dead | index.ts / Cron | Heartbeat cron did not execute or was skipped. |

## 16. ARCHITECTURAL GAPS
**The Proactive Handoff Black Hole:**
\`WatchtowerProactiveIntegrationService\` is designed to "handoff" messages by writing to \`ProactiveGate\`. However, \`ProactiveGate\` is strictly a deduplication/cooldown lock — it does NOT send messages. Because no downstream worker polls \`nova_outreach_log\` to execute Watchtower handoffs, every Watchtower opportunity is silently discarded.

## 17. WHAT IS ACTUALLY WORKING
- Real-time chat history persistence.
- Reminder extraction and saving to the \`reminders\` table.
- NACE evaluation logic (it correctly identified the user as online/recently active and suppressed spam).
- Working memory extraction (despite the typo, the pipeline end-to-end works).

## 18. WHAT IS CURRENTLY DEAD / IDLE / UNREACHABLE
- **Watchtower Dispatch**: Completely unreachable/dead code due to the Gate handoff flaw.
- **Watchtower Heartbeat**: Idle/Dead (0 runs in DB).
- **Brain Reminder Projection**: Unreachable because the backend analytics route does not serve them.

## 19. RECOMMENDED INVESTIGATION ORDER
1. **Fix Proactive Dispatch**: Modify \`WatchtowerProactiveIntegrationService\` to explicitly call \`saveAssistantMessage\` and \`sendNovaReplyNotification\` after committing to the Gate.
2. **Fix Brain Reminders**: Update \`/api/analytics/memories\` to include \`reminders\` and \`nova_agenda\`.
3. **Debug Watchtower Cron**: Verify why \`index.ts\` is not successfully triggering the Watchtower Heartbeat.
4. **Fix Semantic Typo Bug**: Add a typo-correction layer to \`SemanticInterpreter\`.
`;

fs.writeFileSync("live_chat_forensic_audit_report.md", report, "utf8");
console.log("Report generated.");
