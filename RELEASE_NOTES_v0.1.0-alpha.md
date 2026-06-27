# Release Notes - v0.1.0-alpha

This release marks the initial internal stabilization framework for the Human OS personal companion platform.

---

## 1. Features Included
*   **Decoupled System Architecture:** Defined the decoupled system stack (UX, Consciousness, Cognitive modules, Runtime services, Storage, Infrastructure) under `SYSTEM_LAYERS.md` and `DEPENDENCY_RULES.md`.
*   **Database Automation CLI:** Created scripts to migrate, verify, reset, and backup the PostgreSQL database via direct socket connection (`DATABASE_URL`).
*   **Automatic Cache Invalidation & Grants:** Integrated automatic SQL privileges (`GRANT`) and API cache reload instructions (`NOTIFY pgrst`) inside database migration scripts.
*   **Workstation Doctor Check:** Built an E2E health diagnostics utility (`npm run doctor`) and boot automation (`npm run boot`) to perform deep validation checks.
*   **Admin Panel Core:** Created encryption helper (AES-256-GCM) and dynamic configurations storage (`llm_providers` and `app_settings`) to allow live updates without redeployments.

---

## 2. Dependencies & Requirements
- Node.js >= 20.0.0
- npm >= 10.0.0
- Supabase (PostgreSQL 15+)
- Environment Variables (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_ENCRYPTION_KEY`).

---

## 3. Known Blockers
- **Release Status:** 🔴 **BLOCKED**
- **Blocker:** PostgREST schema cache desync (`PGRST205`) blocks all user-facing auth, onboarding, and chat endpoint functions. Do not deploy to staging until the Supabase API cache is manually reloaded.
