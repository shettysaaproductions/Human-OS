import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';

async function run() {
  const intendedId = '43aa42fb-5af8-4133-a0e5-ac9534ec0fec';
  const accidentalId = 'a5f926e9-91d6-4bd7-b70b-ab1a37d716f0';

  console.log("=== 1. PRE-CHECK ===");
  const { data: user1 } = await supabaseAdmin.auth.admin.getUserById(intendedId);
  const { data: user2 } = await supabaseAdmin.auth.admin.getUserById(accidentalId);
  console.log(`Intended user exists: ${!!user1?.user}`);
  console.log(`Accidental user exists: ${!!user2?.user}`);

  console.log("\n=== 2. CANONICAL ACCOUNT ERASURE ===");
  if (user2?.user) {
    try {
      const { accountLifecycleService } = await import('../src/services/AccountLifecycleService');
      await accountLifecycleService.deleteAccount(accidentalId);
      console.log(`Successfully eradicated accidental user: ${accidentalId}`);
    } catch (e) {
      console.error("Error eradicating user:", e);
    }
  } else {
    console.log("Accidental user not found.");
  }

  console.log("\n=== 3. VERIFY ACCIDENTAL ACCOUNT ERASURE ===");
  let accidentalResiduals = 0;
  const { data: u2After } = await supabaseAdmin.auth.admin.getUserById(accidentalId);
  if (u2After?.user) {
    console.log("Accidental auth user still exists!");
    accidentalResiduals++;
  }

  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true }).eq(item.userColumn, accidentalId);
    console.log(`  ${item.table} (accidental): ${count}`);
    if (count && count > 0) accidentalResiduals += count;
  }
  console.log(`Accidental residual rows: ${accidentalResiduals}`);

  console.log("\n=== 4. VERIFY INTENDED USER REMAINS CLEAN ===");
  let intendedRows = 0;
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true }).eq(item.userColumn, intendedId);
    console.log(`  ${item.table} (intended): ${count}`);
    if (count && count > 0) intendedRows += count;
  }
  console.log(`Intended user cognitive rows: ${intendedRows}`);
}

run().catch(console.error);
