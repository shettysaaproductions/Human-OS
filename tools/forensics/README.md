# tools/forensics — Human-OS Forensic Tooling

This directory contains **non-production** forensic and recovery scripts for Human-OS.

## CRITICAL SAFETY RULES

1. **Never run these scripts against the production database.**
2. Every script is **dry-run by default** — no mutations occur unless `--execute` is explicit.
3. Every script requires `HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS=true` environment variable.
4. Every script refuses to run when `NODE_ENV === 'production'`.
5. **No script will enumerate all users and operate on all of them.** Explicit user IDs are always required.

## Scripts

### `safe_account_repair.ts`

Safely delete specific user accounts in a development/staging environment.

```bash
# Dry run — shows what would happen, zero mutations:
npx ts-node tools/forensics/safe_account_repair.ts --user-ids=<uuid1>,<uuid2>

# Execute — requires both the env var AND --execute:
HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS=true npx ts-node tools/forensics/safe_account_repair.ts \
  --user-ids=<uuid1>,<uuid2> --execute
```

**Replaced scripts (removed from production tree):**
- `backend/execute_reset.ts` — deleted (was: delete ALL auth users, no guards)
- `backend/cleanup_orphans.ts` — deleted (was: delete ALL discovered user IDs, no guards)

## Why these scripts were removed from the backend tree

`execute_reset.ts` enumerated ALL auth users and called `deleteAccount()` on every one with no
environment guard, dry-run default, or confirmation requirement. If executed with production
credentials it would have deleted every user account.

`cleanup_orphans.ts` had the same problem: it scanned all user-owned tables, collected every
discovered user ID, and called `deleteAccount()` on all of them. An orphan row does not imply
the account is safe to delete — it may be delayed replication, migration artifact, or
soft-deleted state.

## Orphan cleanup safety contract

An orphan row MUST NOT be assumed to mean "safe to delete that account."

Before any repair action, verify:
- The user does NOT exist in `auth.users`
- The user does NOT have an active account
- The row is genuinely orphaned (not delayed replication or migration artifact)

Default: **DRY RUN**.
