# Nova Model Router Rules

**Mission:** Define how Nova intelligently routes LLM calls across multiple API keys and models, preserving the illusion of a single living mind while maximizing free-tier capacity.

---

## 1. Current Deployed Stack

Nova uses NVIDIA's NIM API (OpenAI-compatible endpoint) in production.

| Key | Model | Role |
|---|---|---|
| `NVIDIA_API_KEY` (Key 1) | `meta/llama-3.1-70b-instruct` | All user-facing chat replies |
| `NVIDIA_API_KEY` (Key 1) | `meta/llama-3.1-8b-instruct` (EXTRACTION_MODEL) | Fast background extraction |
| `NVIDIA_API_KEY_2` (Key 2) | `meta/llama-3.1-8b-instruct` | Background consciousness engines |

---

## 2. Two-Tier Key Routing Strategy

The second NVIDIA key exclusively powers **background consciousness work** so it never competes with live user chat:

| Tier | Key Used | Functions |
|---|---|---|
| **Tier 1 (User-Facing)** | Key 1 | `chat.ts` reply generation, `NovaBrainService` |
| **Tier 2 (Background)** | Key 2 | `ReflectionSchedulerService`, `NovaConsciousnessEngine` (NACE), `NovaSelfImprovementService`, `MomentEngineService` LLM calls |

**Failover Rule:** If Key 1 receives HTTP 429 (rate limit), transparently route to Key 2. Log the failover event.

---

## 3. ModelRouterService (Supabase-Backed)

The `ModelRouterService` (`src/services/ModelRouterService.ts`) reads from the `llm_providers` table in Supabase. This allows adding, disabling, or reprioritizing LLM keys without a code deploy.

- Keys are stored **encrypted** in `llm_providers.api_key_encrypted`
- Priority is numeric — higher number = preferred
- Failover deactivates the failing provider row and selects the next highest priority

---

## 4. Escalation Rules (Future Growth Path)

As Nova grows beyond the free tier, the following escalation ladder applies:

| Task Type | Model | Trigger |
|---|---|---|
| **User Chat (reflexes)** | `llama-3.1-8b-instruct` | Short casual messages (< 20 words) |
| **User Chat (standard)** | `llama-3.1-70b-instruct` | Default |
| **Deep Reasoning / Analysis** | Escalate to higher model | When task complexity exceeds threshold |
| **NovaSelfImprovementService** | `llama-3.1-8b-instruct` via Key 2 | Weekly background run |

---

## 5. Logging Requirements

Every LLM call must log to `agent_metrics` table asynchronously:
- Model used
- Key slot used (primary / secondary)
- Tokens consumed (estimated)
- Execution time (ms)
- Success / Failure status
- Failover triggered (boolean)

---

## 6. Implementation Notes

- `src/lib/nvidia.ts` contains both `nvidiaClient` (Key 1) and `nvidiaClientSecondary` (Key 2)
- `chatCompletion()` uses Key 1 (user-facing)
- `chatCompletionBackground()` uses Key 2 (background engines)
- Environment variables: `NVIDIA_API_KEY` and `NVIDIA_API_KEY_2`
- Both must be set in Render environment variables for production
