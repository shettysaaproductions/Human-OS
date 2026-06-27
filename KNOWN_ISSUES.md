# Known Issues List (v0.1.0-alpha)

This document tracks identified bugs, limitations, and workarounds for the internal alpha release of Human OS.

---

## 1. Database Schema Cache Desync (P0 - Blocker)
*   **Symptom:** API calls to `/onboarding`, `/chat`, and `/auth` fail with a `PGRST205` error indicating tables cannot be found in the schema cache.
*   **Workaround:** The database tables must be manually created in the Supabase Dashboard, and the PostgREST cache must be forced to refresh by clicking the **"Reload schema cache"** button in **Project Settings -> API** on the Supabase console.

---

## 2. Mock Authentication in Development (P2)
*   **Symptom:** Signup and Login fail with `Invalid API key` because `SUPABASE_ANON_KEY` is configured as a dummy value in development.
*   **Workaround:** For local backend verification and E2E testing, authentication checks are bypassed by generating mock UUIDs directly inside test drivers. The production build requires a valid anonymous key.
