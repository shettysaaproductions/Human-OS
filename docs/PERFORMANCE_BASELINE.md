# PERFORMANCE BASELINE

Cold Start:
1.2 sec

Warm Start:
0.4 sec

History Size:
500 messages (cached client-side)

APK Size:
24 MB

Memory Usage:
180 MB

## Performance Instrumentation Results (Post-SSE Sprint)
Metrics are now actively logged client-side and server-side:
- **`DB_FETCH_MS`:** 35ms - 45ms (Concurrent queries using `Promise.all` decreased DB latency by 80%)
- **`PROMPT_BUILD_MS`:** <5ms
- **`LLM_FIRST_TOKEN_MS` (TTFT):** ~280ms - 600ms (Reduced from 1.5s - 3.5s; 75%+ latency reduction in user perception)
- **`LLM_TOTAL_MS`:** 1.5s - 3.5s (under normal load)
- **`QUEUE_WAIT_MS`:** <5ms
- **`RESPONSE_RENDER_MS`:** <10ms
- **`TOTAL_REQUEST_MS`:** 1.5s - 3.5s (Total connection time. The user starts reading at `LLM_FIRST_TOKEN_MS`)

## Live Latency Status
- **Time to First Token (TTFT):** ~450ms average (Target <1.0s met)
- **DB Fetch Latency:** ~40ms average (Target <50ms met)
