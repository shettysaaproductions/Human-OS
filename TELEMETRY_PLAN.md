# Telemetry & Metrics Plan

**Mission:** Understand real user interactions, detect crashes automatically, measure AI costs, and track performance to scale Human OS for 10-50 internal users before the beta release.

---

## 1. Tracking Goals
*   **Behavioral Understanding:** Map how users interact with Human OS naturally.
*   **Stability Monitoring:** Automatically detect exceptions, crashes, and degradation.
*   **Cost Management:** Monitor AI provider costs, token limits, and performance budgets.

---

## 2. Core Metrics

### User Metrics
*   **Daily Active Users (DAU):** Number of unique users per day.
*   **Messages per Day:** Total conversational volume per user.
*   **Average Session Length:** Time spent active within the application.
*   **Retention Rate:** Measured across 1-day, 7-day, and 30-day horizons.

### Technical Metrics
*   **API Latency:** Response times across major endpoints (`/chat`, `/onboarding`).
*   **Queue Processing Time:** Latency of background worker jobs (e.g., memory embedding).
*   **Memory Retrieval Latency:** Time taken for vector/semantic memory resolution.
*   **Error Count:** Total API and frontend unhandled exceptions.
*   **Crash Count:** Hard application failures.

### AI Metrics
*   **Tokens Used:** Aggregate input/output token volume.
*   **Cost per User:** Calculated API cost attributed per profile.
*   **Cost per Conversation:** Average spend per chat session.
*   **Provider Usage Distribution:** Breakdown of usage between OpenAI, Anthropic, Google, etc.

### Memory Metrics
*   **Memories Created:** Total semantic/episodic inserts.
*   **Memories Recalled:** Successful semantic matches retrieved during chat context.
*   **Duplicate Memories Prevented:** Deduplications blocked by decay/similarity layers.
*   **Reflection Jobs Completed:** Number of successful daily/weekly background reflections.

---

## 3. Admin Dashboard Integration

To expose these metrics without incurring heavy database loads or huge payloads, we will introduce three new lightweight, aggregated endpoints under the Admin UI layer:

*   **`GET /admin/metrics`**: Lightweight aggregation of active users, conversation counts, and AI costs.
*   **`GET /admin/errors`**: Fetches recent error logs and crash trace headers.
*   **`GET /admin/health`**: Returns queue processing times, memory latencies, and database heartbeat.

---

## 4. Implementation Guidelines
> [!IMPORTANT]
> **Lightweight Rule:** All telemetry metrics will be aggregated asynchronously or cached via the `SettingsService` TTL pattern. Raw event logging will bypass heavy `Supabase` writes in favor of batched updates or specialized logging endpoints to preserve application performance.
