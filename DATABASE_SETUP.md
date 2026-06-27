# Supabase Database Automation Setup

This project supports automated database migration, verification, and reset operations using a direct PostgreSQL connection string.

## Environment Configuration

To enable database automation, you must configure the `DATABASE_URL` environment variable inside your `backend/.env` file.

### Steps to retrieve DATABASE_URL:
1. Go to your **Supabase Dashboard** -> **Project Settings** -> **Database**.
2. Under the **Connection string** section, select **URI**.
3. Copy the URI. It looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.vhmrryofcdlgmsxvfbfn.supabase.co:6543/postgres`
4. Replace `[YOUR-PASSWORD]` with your actual database password.
5. Paste this connection string into your `backend/.env` file:
   ```env
   DATABASE_URL=postgresql://postgres:my-secure-password@db.vhmrryofcdlgmsxvfbfn.supabase.co:6543/postgres
   ```

*Note: For the application runtime, you should continue keeping `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured.*

---

## Commands

Three automation scripts have been created to manage the database schema:

### 1. Database Migration
Executes all SQL files located in `supabase/migrations/` sequentially, and automatically notifies PostgREST to reload the schema cache.
```bash
npx ts-node scripts/db_migrate.ts
```

### 2. Schema Verification
Verifies that all required tables and columns are present in the database, and performs a write/read/delete roundtrip on the `profiles` table to verify permissions.
```bash
npx ts-node scripts/db_verify.ts
```

### 3. Database Reset
Drops all tables (via `supabase/drop_all_tables.sql`), re-runs migrations sequentially, and refreshes the PostgREST cache.
```bash
npx ts-node scripts/db_reset.ts
```
