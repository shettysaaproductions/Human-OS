# Data Boundaries Policy

This document defines the strict boundaries between **runtime application data** and **development/knowledge documents** within the Human OS environment.

---

## 1. Core Rule

**Supabase stores only runtime application data and user states. No documentation, source code backups, or architectural knowledge base files may ever be written to the database.**

---

## 2. Allocation Matrix

### Allowed in Supabase (Runtime Application Data)
*   **User State:** Users, profiles, onboarding states.
*   **Consciousness/Memory Module:** `chat_history`, `memories` (working, episodic, semantic vector embeddings, knowledge graph nodes/edges).
*   **System State:** `emotional_states`, `app_settings` (dynamic system toggles), `llm_providers` (encrypted API keys/routing), and diagnostics metadata.

### Forbidden from Supabase (Local Filesystem & Git Only)
*   **Knowledge Assets:** Markdown documentation, architecture books (under `/brain`), design paradigms, and session logs.
*   **Development Assets:** Implementation plans, recovery procedures, backup strategy guides, source file backups, and local test reports.

---

## 3. Repository Architecture

```
/brain         <-- Core architecture book, design principles, dreams (Git Only)
/docs          <-- PRD, MVP scopes, development manuals (Git Only)
/backend       <-- Node.js source code, Express routes, migration SQLs
/mobile        <-- React Native source code
/scripts       <-- Workstation tools (db_migrate, db_backup, doctor, etc.)
/backups       <-- Local portable table backups (JSON format)
```

---

## 4. Enforcement Strategy
*   Every migration file under `supabase/migrations/` must only concern relational DDL tables, indexes, functions, or static seed configuration values.
*   No migration should attempt to load markdown text files or documentation guides into database columns. Keep code logic and database schemas strictly bounded.
