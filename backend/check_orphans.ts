import { supabaseAdmin } from "./src/lib/supabase";

async function check() {
  const { data: ch } = await supabaseAdmin.from("chat_history").select("user_id").limit(10);
  const { data: wm } = await supabaseAdmin.from("working_memory").select("user_id").limit(10);
  console.log("chat_history user_ids:", ch);
  console.log("working_memory user_ids:", wm);
}
check();
