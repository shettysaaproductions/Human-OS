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
  // FULL MEMORY LIST
  const mems = await q("memories", t => t.select("*").eq("user_id", UID).order("created_at", { ascending: true }));
  console.log("=== ALL MEMORIES total=" + (Array.isArray(mems) ? mems.length : JSON.stringify(mems)));
  if (Array.isArray(mems)) {
    for (let i = 0; i < mems.length; i++) {
      const m = mems[i];
      console.log((i+1) + ". [" + (m.is_archived ? "ARCHIVED" : "ACTIVE") + "] key=" + m.key + " | val=" + m.value + " | auth=" + m.source_authority + " | imp=" + m.importance + " | created=" + toIST(m.created_at) + " | id=" + m.id);
    }
  }
  
  // BACKGROUND JOBS - find correct column
  const { data: colCheck, error: colErr } = await supabase.from("background_jobs").select("*").limit(1);
  if (colErr) {
    console.log("\nBACKGROUND_JOBS error:", colErr.message);
  } else if (colCheck && colCheck.length > 0) {
    console.log("\nBACKGROUND_JOBS columns:", Object.keys(colCheck[0]).join(", "));
    // Try querying with correct column
    const cols = Object.keys(colCheck[0]);
    const userCol = cols.find(c => c.includes("user")) || "";
    console.log("User column found:", userCol);
    if (userCol) {
      const jobs = await q("background_jobs", t => t.select("*").eq(userCol, UID).order("created_at", { ascending: false }).limit(50));
      console.log("Jobs for user:", JSON.stringify(jobs));
    }
  } else {
    console.log("\nBACKGROUND_JOBS: table empty or no access");
  }

  // Also try ALL recent bg jobs for any user
  const { data: recentJobs } = await supabase.from("background_jobs").select("*").gte("created_at", "2026-08-29T00:00:00Z").order("created_at", { ascending: true }).limit(100);
  if (recentJobs) {
    console.log("\nALL RECENT BACKGROUND_JOBS (Aug 29):", recentJobs.length);
    for (const j of recentJobs) {
      console.log(JSON.stringify(j));
    }
  }

  // USER PRESENCE full
  const pres = await q("user_presence", t => t.select("*").eq("user_id", UID).maybeSingle());
  console.log("\n=== USER PRESENCE ===");
  console.log(JSON.stringify(pres, null, 2));

  // ALL USER INVENTORY
  const allProfiles = await q("profiles", t => t.select("id, preferred_name, onboarding_completed_at, last_active_at, is_online, push_token").order("onboarding_completed_at", { ascending: false }));
  console.log("\n=== ALL USER INVENTORY ===");
  if (Array.isArray(allProfiles)) {
    for (const p of allProfiles) {
      const { count: chatC } = await supabase.from("chat_history").select("*", { count: "exact", head: true }).eq("user_id", p.id);
      const { count: memC } = await supabase.from("memories").select("*", { count: "exact", head: true }).eq("user_id", p.id);
      const { count: ltC } = await supabase.from("life_threads").select("*", { count: "exact", head: true }).eq("user_id", p.id);
      const { count: remC } = await supabase.from("reminders").select("*", { count: "exact", head: true }).eq("user_id", p.id);
      const hasPush = p.push_token ? "HAS_PUSH" : "NO_PUSH";
      const isOnline = p.is_online ? "ONLINE" : "OFFLINE";
      console.log("user=" + p.id + " name=" + p.preferred_name + " | " + isOnline + " | " + hasPush + " | chats=" + chatC + " mems=" + memC + " threads=" + ltC + " rems=" + remC + " | onboarded=" + toIST(p.onboarding_completed_at) + " | last_active=" + toIST(p.last_active_at));
    }
  }
}
run().catch(e => console.error("ERR:", e));
