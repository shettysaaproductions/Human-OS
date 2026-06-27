import { Client } from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing.');
  process.exit(1);
}

const REQUIRED_TABLES = ['profiles', 'chat_history', 'memories', 'llm_providers', 'app_settings'];

async function verify() {
  console.log('--- Database Verification Script ---');
  
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Successfully connected to database via PostgreSQL client.');

    // 1. Check tables
    for (const table of REQUIRED_TABLES) {
      const res = await client.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1);",
        [table]
      );
      const exists = res.rows[0].exists;
      if (exists) {
        console.log(`[PASS] Table 'public.${table}' exists.`);
      } else {
        throw new Error(`Table 'public.${table}' is missing.`);
      }
    }

    // 2. Check profile columns
    const expectedProfileCols = ['id', 'onboarding_completed', 'companion_personality', 'created_at', 'updated_at'];
    for (const col of expectedProfileCols) {
      const res = await client.query(
        "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = $1);",
        [col]
      );
      if (res.rows[0].exists) {
        console.log(`[PASS] Column 'profiles.${col}' exists.`);
      } else {
        throw new Error(`Column 'profiles.${col}' is missing.`);
      }
    }

    // 3. Perform write/read/delete tests on profiles table to verify permissions
    console.log('\nTesting permissions via write/read/delete roundtrip...');
    const testId = crypto.randomUUID();
    
    // Write
    await client.query("INSERT INTO public.profiles (id, preferred_name) VALUES ($1, 'TestUser');", [testId]);
    console.log(`[PASS] Inserted test profile with ID: ${testId}`);

    // Read
    const selectRes = await client.query("SELECT preferred_name FROM public.profiles WHERE id = $1;", [testId]);
    if (selectRes.rows.length === 1 && selectRes.rows[0].preferred_name === 'TestUser') {
      console.log(`[PASS] Read test profile back successfully.`);
    } else {
      throw new Error('Read verification failed: Row mismatch.');
    }

    // Delete
    await client.query("DELETE FROM public.profiles WHERE id = $1;", [testId]);
    console.log(`[PASS] Deleted test profile.`);

    console.log('\n--- Verification Succeeded! All checks passed. ---');
    process.exit(0);
  } catch (err: any) {
    console.error('\n[Error] Verification failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verify();
