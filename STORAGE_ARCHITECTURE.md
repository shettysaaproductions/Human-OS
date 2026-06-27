# Storage Architecture Policy

This document defines where every type of data belongs within the Human OS workstation and runtime environment.

---

## 1. Storage Allocations

The storage design of Human OS is segregated into four distinct layers:

### Layer 1: Supabase (The Memory)
*   **Purpose:** Runtime application state.
*   **Data Types:** `profiles`, `chat_history`, `memories` (vector/text), `emotional_states`, `llm_providers` (decrypted API config at runtime), `app_settings`, and system diagnostics metadata.

### Layer 2: Git Repository (The Knowledge)
*   **Purpose:** Source code, operational frameworks, and cognitive knowledge books.
*   **Data Types:** `backend/` source, `mobile/` source, `/brain` (architecture chapters), prompts, refactoring plans, and session boot configurations.

### Layer 3: Local Filesystem (The Workspace)
*   **Purpose:** Heavy, local, or temporary artifacts.
*   **Data Types:** Database schema/data backups (JSON/SQL formats), user data exports, local server logs, diagnostic reports, UI screenshots, and test result outputs.

### Layer 4: Future Object Storage (The Media)
*   **Purpose:** Heavy, user-generated static assets.
*   **Data Types:** Images, voice recordings, video notes, and attachments.

---

## 2. Core Allocation Matrix

| Data Type | Storage Layer | Key Rule |
|---|---|---|
| Database Tables | Supabase | Relational runtime queries. |
| Markdown files | Git Repository | Version-tracked filesystem knowledge. |
| Source code | Git Repository | Local/remote codebase. |
| Session logs | Local Filesystem | Workspace logs, never DB columns. |
| Media files | Object Storage | Cloud/Local object storage files. |

---

## 3. Philosophic Alignment

> **The database is memory.**  
> **The repository is knowledge.**  
> **The filesystem is workspace.**  
> **The object store is media.**  
