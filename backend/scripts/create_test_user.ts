import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';

async function run() {
  console.log("Creating test user...");
  const email = `test_user_${Date.now()}@humanos.app`;
  const password = "TestPassword123!";

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      is_test_user: true,
      preferred_name: "Test User"
    }
  });

  if (authErr) {
    console.error("Failed to create auth user:", authErr);
    return;
  }

  const userId = authData.user.id;
  console.log(`Created auth user: ${userId}`);

  // Wait a moment in case there's a DB trigger for profiles
  await new Promise(resolve => setTimeout(resolve, 1000));

  let { data: profile, error: profErr } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  
  if (profErr || !profile) {
    console.log("Profile not found, inserting profile manually...");
    const { data: newProfile, error: insertErr } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      preferred_name: "Test User",
      onboarding_completed: true
    }).select().single();

    if (insertErr) {
      console.error("Failed to create profile:", insertErr);
    } else {
      profile = newProfile;
      console.log("Profile created.");
    }
  } else {
    console.log("Profile automatically created by trigger.");
  }

  console.log("\n============================================================");
  console.log("2. CLEAN-STATE VERIFICATION");
  console.log("============================================================");
  
  let allZero = true;
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    try {
      const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true }).eq(item.userColumn, userId);
      console.log(`  ${item.table}: ${count}`);
      if (count && count > 0) allZero = false;
    } catch (e) {
      console.error(`  ${item.table}: Error`);
    }
  }
  
  console.log("\n============================================================");
  console.log("FINAL REPORT PREPARATION");
  console.log("============================================================");
  console.log(`TEST_USER_CREATED = YES`);
  console.log(`TEST_USER_ID = ${userId}`);
  console.log(`TEST_PROFILE_ID = ${userId}`);
  console.log(`TEST_USER_EMAIL = ${email}`);
  console.log(`TEST_USER_PASSWORD = ${password}`);
  console.log(`OTHER_USER_OWNED_TABLES = ${allZero ? 'all verified at 0' : 'some tables have data'}`);
}

run().catch(console.error);
