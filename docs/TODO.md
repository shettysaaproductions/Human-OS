# TODO

## P0
- [ ] Conduct Friends & Family Testing using docs/INTERNAL_TESTING_CHECKLIST.md

## P1
- [ ] Implement message status indicators (`queued` ➔ `sending` ➔ `sent` ➔ `delivered` ticks)
- [ ] Design Conversational States UI (Thinking, Typing, Replied)
- [ ] Implement Dynamic Status Messages (e.g., "Recalling memories...")

## P2
- [ ] Build Relationship Dashboard tab
- [ ] Memory scaling database optimization (HNSW, summarization)
- [ ] Integrate background tasks and push notification pipelines

## Completed
- [x] Documented Future Product Vision in ROADMAP.md
- [x] Implement SSE Streaming chat response (`/chat/stream`) endpoint in backend
- [x] Connect `useChatStore.ts` and UI elements to stream chunked updates
- [x] Instrument logs: `DB_FETCH_MS`, `PROMPT_BUILD_MS`, `LLM_FIRST_TOKEN_MS`, `LLM_TOTAL_MS`, `RESPONSE_RENDER_MS`
- [x] Parallelize backend DB fetches (Profile, STMs, LTMs, history) using `Promise.all`
- [x] Fixed P0 stuck typing indicator (NaN backoff, queue lock, rehydration logic)
- [x] Removed NetInfo native module to restore OTA compatibility
- [x] Implemented WhatsApp-style messaging queue (outboxQueue)
- [x] Clear tokens and session logic on logout
