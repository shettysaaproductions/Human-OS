# Admin Control Panel Architectural Documentation

This document defines the live administration architecture of Human OS, enabling runtime configurations without redeployment.

---

## 1. Live Configuration Strategy

### A. Environment vs. Database
- **Static Core Configuration:** Port bindings, DB URLs, and master decryption keys remain strictly in environment variables (`.env`).
- **Live Configuration:** API keys, active models, active settings, and routing priorities are fetched dynamically at runtime from the `llm_providers` and `app_settings` tables.

### B. In-Memory TTL Cache
To prevent database query bottlenecks on every incoming user message, the configuration layer is wrapped in a lightweight in-memory cache (**`SettingsService.ts`**):
*   **Duration:** 60 seconds (TTL).
*   **Refresh Loop:** Cleared manually via `refreshCache()` or invalidated automatically after 60 seconds.

---

## 2. API Key Security (AES-256-GCM)
Plaintxt API keys are **never** stored in the database. Instead:
1.  The key is encrypted server-side using AES-256-GCM.
2.  A 12-byte random Initialization Vector (IV) and 16-byte Authentication Tag are concatenated with the ciphertext: `iv:authTag:ciphertext`.
3.  Decryption uses the **`MASTER_ENCRYPTION_KEY`** environment variable (hashed internally to sha256 to guarantee 256-bit entropy).

---

## 3. Provider Management & Failover Strategy

### A. Active Providers & Priority
Providers in `llm_providers` are fetched dynamically:
- Sorted by `priority` DESC (higher runs first).
- Decrypted on-the-fly for API calls.

### B. Failover Protocol
If a model request fails (network error, rate limits, invalid status):
1.  The system calls `failoverProvider(providerId)`.
2.  The failing provider is marked as `is_active = false`.
3.  The next provider in the priority queue is instantly returned and invoked.

---

## 4. Admin CLI / Operations Guide

### Adding a New Provider:
Encrypt the API key first using the encryption helper, then insert:
```sql
INSERT INTO public.llm_providers (provider_name, model_name, api_key_encrypted, priority)
VALUES ('openai', 'gpt-4o', 'your_encrypted_key_here', 10);
```

### Rotating Provider Priorities (Load Balancing):
```bash
# Cycles the highest priority provider to the lowest position
npx ts-node -e "require('./src/services/ModelRouterService').modelRouterService.rotateProvider()"
```

---

## 5. Future Dashboard UI (Roadmap)

A secure React/NextJS control panel will be built in the next epoch to allow non-technical administration:
*   **Key Manager:** Encrypts and saves keys via form input.
*   **System Toggles:** Live switches to enable/disable features.
*   **Diagnostics Panel:** Aggregated token usage, costs, and failover histories fetched directly from `agent_metrics`.
