import { Client } from 'pg';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';
import { logger } from '../src/lib/logger';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

async function migrate() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in environment.');
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  logger.info('[Migration 060] Setting up account_tombstones and TOCTOU triggers');

  try {
    // 1. One-time Historical Zombie Cleanup
    logger.info('Performing one-time controlled cleanup of historical zombie row...');
    const zombieId = 'a2754adc-3d7e-48ba-b2d7-1e8711d54aa3';
    const zombieCleanupRes = await client.query('DELETE FROM public.working_memory WHERE user_id = $1', [zombieId]);
    logger.info(`Zombie cleanup completed. Rows deleted: ${zombieCleanupRes.rowCount}`);

    // 2. Build explicit table -> ownership mapping
    const tablesToProtect = AccountLifecycleService.USER_OWNED_TABLES;
    if (!tablesToProtect || tablesToProtect.length === 0) {
      throw new Error('Migration aborted: No user-owned tables defined in AccountLifecycleService');
    }

    // Verify mapping safely - if any table is missing, Postgres query would fail on trigger creation
    // but we want to ensure we don't proceed with partial setup.
    logger.info(`Discovered ${tablesToProtect.length} user-owned tables to protect.`);

    // 3. Create the account_tombstones table (No personal data allowed!)
    logger.info('Creating account_tombstones table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.account_tombstones (
        user_id UUID PRIMARY KEY,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      
      -- Add RLS to block all external access if needed, though this is backend-managed
      ALTER TABLE public.account_tombstones ENABLE ROW LEVEL SECURITY;
    `);

    // 4. Create the Trigger Function
    logger.info('Creating enforce_account_tombstone trigger function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION public.enforce_account_tombstone()
      RETURNS TRIGGER AS $$
      DECLARE
        uid UUID;
      BEGIN
        -- TG_ARGV[0] contains the column name for the user ID (e.g., 'user_id' or 'id')
        EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) USING NEW INTO uid;
        
        IF EXISTS (SELECT 1 FROM public.account_tombstones WHERE user_id = uid) THEN
          RAISE EXCEPTION 'ACCOUNT_TOMBSTONE_VIOLATION: Cannot write data for deleted user %', uid;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);

    // 5. Attach the trigger to all user-owned tables for INSERT and UPDATE
    logger.info('Attaching triggers to all user-owned tables...');
    for (const { table, userColumn } of tablesToProtect) {
      // First, check if the table and column actually exist to satisfy "fail migration if unmapped safely"
      const colCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = $1 
          AND column_name = $2
      `, [table, userColumn]);

      if (colCheck.rowCount === 0) {
        throw new Error(`Migration aborted: Table '${table}' does not have column '${userColumn}'. Ownership mapping failed.`);
      }

      const triggerName = `tr_enforce_tombstone_${table}`;
      
      // Drop if exists to ensure clean state
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.${table}`);
      
      // Create trigger passing the column name as an argument
      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT OR UPDATE ON public.${table}
        FOR EACH ROW
        EXECUTE FUNCTION public.enforce_account_tombstone('${userColumn}');
      `);
      logger.info(`[Protected] Attached tombstone trigger to ${table} on column ${userColumn}`);
    }

    logger.info('Migration 060 completed successfully.');
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  logger.error('Migration 060 failed', { error: err.message });
  process.exit(1);
});
