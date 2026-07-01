# AI Handoff

## Current Priority
P1 Chat Performance Sprint — Make Nova feel instant and alive.

## Production Status
✅ STABLE — Founder baseline confirmed working.
- APK: `cc24f6c` / `stable-apk-baseline` tag
- Active OTA: `c3e9c7d1-59f8-4709-add6-f21a0d2a3645`
- Features verified: instant startup, timestamps, date headers, scroll fix, language settings, developer mode, phase 1 chat.

## Emergency Recovery Command
```bash
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery to stable-v3-recovered"
```

## OTA Crash Lesson (Do Not Repeat)
The crash-loop was caused by publishing an OTA that used `expo-splash-screen` native APIs on a device with an older native binary that lacked the module. 
**Rule:** Any OTA that introduces or upgrades a native module MUST be shipped with a new native binary build first.

## Next Sprint: P1 Chat Performance
### Phase 1 — SSE Streaming
1. Implement `/chat/stream` SSE endpoint on Express backend.
2. Add `streamMessage()` to `chatService.ts` with fallback to `/chat`.
3. Add `novaState: 'thinking' | 'typing' | 'complete'` to `useChatStore.ts`.
4. Add "Nova is thinking..." / "Nova is typing..." UI states in `ChatScreen.tsx`.
5. Rotate dynamic status messages ("Recalling memories...", "Reading our history...").
6. Test on canary branch before pushing to production.

### Phase 2 — Memory Architecture V2
- Tiered memory (Fast / Short-Term / Long-Term / Life Timeline).
- Cap LLM history to last 20 messages.
- Semantic retrieval (pgvector top-5) instead of full history.
- See: `docs/MEMORY_ARCHITECTURE_V2.md`

### Phase 3 — Life Timeline (Future)
- Daily summaries, HumanOS Moments, Timeline Tab.
- See: `docs/LIFE_TIMELINE_VISION.md`

## Key Files
- `docs/CHAT_PERFORMANCE_PLAN.md` — Full SSE implementation spec
- `docs/MEMORY_ARCHITECTURE_V2.md` — Tiered memory design
- `docs/LIFE_TIMELINE_VISION.md` — Timeline and daily summaries vision
- `docs/ROADMAP.md` — Updated phase plan

## Performance Targets
| Metric | Current | Target |
|--------|---------|--------|
| Time to first token | 1.5–45s | < 500ms |
| Full response | 3–60s | 1–8s |
| Perceived speed | 40–60s | 0.5–2s |
