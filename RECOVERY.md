# Recovery and Rollback Procedures

This document outlines emergency database recovery protocols, restore tasks, and rollback options if a migration breaks production.

---

## 1. Database Restore Procedure

If your database becomes corrupted or you accidentally delete data, you can restore from a JSON backup file.

### Steps to Restore:
1. Locate your target backup JSON file in `backend/backups/` (e.g. `backup_2026-06-27T16-12-00.json`).
2. Run the database reset script to clear old schemas:
   ```bash
   npm run db:reset
   ```
3. Run a custom restore command or use the PostgreSQL manager to import data.
   *(Since our backups are lightweight JSON files, they can be processed and re-injected using simple row-insert scripts).*

---

## 2. Emergency Rollback Procedure

If a new SQL migration breaks the database schema:

1. **Revert the code:** Roll back your git commit to the last stable state.
   ```bash
   git revert HEAD
   ```
2. **Identify the bad migration:** Delete the failing migration file from `backend/supabase/migrations/`.
3. **Reset and Rebuild:** Execute a clean database rebuild using the stable migration scripts:
   ```bash
   npm run db:reset
   ```
   *Warning: Run db:reset on production only with `--confirm-production` after confirming a valid backup exists.*

---

## 3. Disaster Recovery (Stale API Cache)

If the database is physically updated but client devices keep returning `PGRST205` (table not found) or `404`:
1. Execute this reload instruction:
   ```bash
   npx ts-node -e "const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); c.connect().then(() => c.query(\"NOTIFY pgrst, 'reload schema';\")).then(() => c.end());"
   ```
2. Alternatively, log into the Supabase Dashboard -> **Project Settings** -> **API** -> Click **"Reload schema cache"**.
