const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const UID = "5134132c-9a2a-46f9-a34c-70895251f685";
function toIST(s) { if (!s) return "N/A"; return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"; }
async function q(table, fn) {
  try { const r = await fn(supabase.from(table)); if (r.error) return { _error: r.error.message }; return r.data; }
  catch(e) { return { _error: String(e) }; }
}
async function run() {
  const mems = await q("memories", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("=== MEMORIES FULL total=" + (Array.isArray(mems) ? mems.length : JSON.stringify(mems)));
  if (Array.isArray(mems) && mems.length > 0) {
    console.log("COLUMNS: " + Object.keys(mems[0]).join(", "));
    for (let i = 0; i < mems.length; i++) {
      const m = mems[i];
      const arch = m.is_archived ? "ARCHIVED" : "ACTIVE";
      console.log((i+1) + "| " + arch + " | key=" + m.key + " | val=" + m.value + " | auth=" + m.source_authority + " | imp=" + m.importance + " | created=" + toIST(m.created_at) + " | src_msg=" + m.source_message + " | id=" + m.id);
    }
  }
  const lt = await q("life_threads", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("\n=== LIFE THREADS total=" + (Array.isArray(lt) ? lt.length : JSON.stringify(lt)));
  if (Array.isArray(lt)) {
    if (lt.length > 0) console.log("COLUMNS: " + Object.keys(lt[0]).join(", "));
    for (const row of lt) { console.log(JSON.stringify(row)); }
  }
  const rems = await q("reminders", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("\n=== REMINDERS total=" + (Array.isArray(rems) ? rems.length : JSON.stringify(rems)));
  if (Array.isArray(rems)) {
    if (rems.length > 0) console.log("COLUMNS: " + Object.keys(rems[0]).join(", "));
    for (const r of rems) {
      console.log("id=" + r.id + " | text=" + r.text + " | trigger_utc=" + r.trigger_at + " | trigger_IST=" + toIST(r.trigger_at) + " | status=" + r.status + " | is_auto=" + r.is_auto + " | source_msg=" + r.source_message_id + " | created=" + toIST(r.created_at));
    }
  }
  const outreach = await q("nova_outreach_log", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("\n=== OUTREACH LOG total=" + (Array.isArray(outreach) ? outreach.length : JSON.stringify(outreach)));
  if (Array.isArray(outreach) && outreach.length > 0) {
    console.log("COLUMNS: " + Object.keys(outreach[0]).join(", "));
    for (const o of outreach) { console.log(JSON.stringify(o)); }
  }
  const jobs = await q("background_jobs", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }).limit(200));
  console.log("\n=== BACKGROUND JOBS total=" + (Array.isArray(jobs) ? jobs.length : JSON.stringify(jobs)));
  if (Array.isArray(jobs) && jobs.length > 0) {
    console.log("COLUMNS: " + Object.keys(jobs[0]).join(", "));
    for (const j of jobs) {
      console.log("type=" + j.job_type + " | status=" + j.status + " | attempts=" + j.attempts + " | err=" + j.last_error + " | created=" + toIST(j.created_at) + " | payload_keys=" + (j.payload ? Object.keys(j.payload).join(",") : "none") + " | id=" + j.id);
    }
  }
  const presence = await q("user_presence", t => t.select("*").eq("user_id", UID).maybeSingle());
  console.log("\n=== USER PRESENCE ===\n" + JSON.stringify(presence, null, 2));
  const followups = await q("nova_followups", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("\n=== NOVA FOLLOWUPS total=" + (Array.isArray(followups) ? followups.length : JSON.stringify(followups)));
  if (Array.isArray(followups)) { for (const f of followups) { console.log(JSON.stringify(f)); } }
  const novaActions = await q("nova_actions", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("\n=== NOVA ACTIONS total=" + (Array.isArray(novaActions) ? novaActions.length : JSON.stringify(novaActions)));
  if (Array.isArray(novaActions)) { for (const a of novaActions) { console.log(JSON.stringify(a)); } }
}
run().catch(e => console.error("ERR:", e));
