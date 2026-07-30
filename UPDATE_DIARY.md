# HumanOS Update Diary

Chronological log of all agent-executed changes. Maintained by `update agent` command.

---

## [2026-07-30] Push Notification Bug Fix & Root Cause

### Trigger
User reported push notifications were not being delivered on their newly installed APK (v1.2.33-stable).

### Changes Made
- **Fixed backend crash**: Removed `push_token_updated_at` column reference in `backend/src/routes/auth.ts` which was causing a fatal DB crash and preventing token registration.
- **Mobile OTA Fixes**: Updated `mobile/src/services/notificationService.ts` to include `ensureTokenFresh()` for seamless token regeneration across APK upgrades.
- **OTA Strategy**: Changed `checkAutomatically` in `mobile/app.json` to `ON_LOAD` to guarantee users receive JS fixes.
- **Behavioral Patches**: Added 3 new patches to `promptBuilder.ts` to improve Nova's context awareness.
- **Docs**: Regenerated `FILE_TREE.md` via `update agent`.

### Status
Backend changes pushed to `main` and manually deployed to Render. Mobile JS changes committed to `main` — User instructed to trigger GitHub Actions to build a fresh APK since the old `v1.2.33-stable` APK ignores OTA updates.

---

## [2026-07-30 03:30 IST] Auto Upgrade V2 (Cont.) — 100-Message Context & MVP Docs

### Trigger
User requested completion of the "Power Up Auto-Upgrade" Mode while waiting for the fresh APK to build.

### Changes Made
- **Deep Context History**: Increased the `get_chat_history` query limit in `backend/src/routes/chat.ts` from 20 to 100 messages. This ensures Nova has massive context when identifying conversational flaws.
- **Architecture MVP Update**: Updated `NOVA_ARCHITECTURE.md` to formally document the **Quad NVIDIA Key Pool Strategy** (Keys 1-4) handling chat, NACE, learning, and extraction.

### Status
Changes committed and pushed to `main`. APK is currently building via GitHub Actions.

---

## [2026-07-30 00:45 IST] Auto Upgrade V2 — Real-Time Self-Correction & Architecture Overhaul

### Trigger
User requested a major auto upgrade after analyzing 100 chat messages that revealed 10 critical behavioral failures in Nova.

### Critical Failures Found in Chat Analysis
1. **Memory Amnesia** — Nova forgot user's son (5 months), marriage, and schedule
2. **Zero Proactive Outreach** — 5-day silence; Nova never reached out
3. **Fabrication** — "RNR" was hallucinated as "Ram Nawami hain! Shubhkamnaayein!"
4. **Time Hallucination** — At 9:41 PM asked "office pahunchne me aur kitna time hai?"
5. **Context Amnesia** — Forgot "metro me hoon" from same session minutes later
6. **Greeting Repetition** — "Arey yaar, kahan tha tu itni der?" 3 times verbatim
7. **Long-term memory polluted** — 30+ test_memory_* entries, zero real user facts
8. **Day Hallucination** — Said "Wednesday hai" on a Tuesday
9. **Formality Regression** — Used "Aapke liye", "Dhanyavad" despite strict rules
10. **Romantic Hallucination** — Made up romantic relationship in a story

### Files Created (NEW)
| File | Purpose |
|------|---------|
| `backend/src/services/NovaRealtimeLearningService.ts` | Detects user corrections in replies, auto-generates behavioral patches (Key 3) |
| `backend/src/services/FreeTierGuardService.ts` | Enforces zero-cost across NVIDIA/Supabase/Render |
| `backend/scripts/cleanupTestMemories.ts` | One-time memory cleanup + re-seeding with real user facts |
| `backend/supabase/migrations/021_nova_corrections_log.sql` | Corrections audit + scan checkpoints tables |
| `TASKS.md` | Active task tracker |
| `UPDATE_DIARY.md` | This file |
| `NOTES.md` | Agent notes |
| `FILE_TREE.md` | Project structure overview |

### Files Modified
| File | Change |
|------|--------|
| `backend/src/services/NovaSelfImprovementService.ts` | 5→12 flaw types, weekly→daily, incremental scan, Key 3 |
| `backend/src/services/NovaConsciousnessEngine.ts` | Intelligent dynamic gap, coma awareness, habit triggers |
| `backend/src/services/promptBuilder.ts` | 4 new anti-robot rules, dynamic patch reload every 50 msgs |
| `backend/src/routes/chat.ts` | Correction detection hook for reply_to_content |
| `backend/src/lib/nvidia.ts` | Multi-key pool: Key 3 (learning), Key 4 (extraction) |
| `backend/src/config/index.ts` | NVIDIA_API_KEY_3 + NVIDIA_API_KEY_4 env vars |
| `backend/src/index.ts` | Server boot/shutdown uptime tracking, habit trigger scheduler |
| `.agents/AGENTS.md` | 12 failure modes, incremental scan, hi agent, update agent |

### New Anti-Robot Rules Added to PromptBuilder
1. `ANTI-ROBOT RULE (FABRICATION)` — Never guess unknown abbreviations
2. `ANTI-ROBOT RULE (SAME-SESSION CONTEXT)` — Never forget current-session facts
3. `ANTI-ROBOT RULE (DAY AWARENESS)` — Trust Situation Brief for day/time, never hallucinate
4. `ANTI-ROBOT RULE (MEMORY ACCOUNTABILITY)` — Must use known life facts when relevant

### User Feedback Integrated
- Multiple NVIDIA API keys in parallel (Key 1: chat, Key 2: NACE, Key 3: learning, Key 4: extraction)
- NACE gap is now situation-aware (not fixed timer)
- Incremental scan checkpoints (auto-upgrade doesn't re-scan fixed bugs)
- Zero-cost enforcement via FreeTierGuardService
- Nova logout/coma awareness (5-min boot cooldown, shutdown timestamp recorded)
- "hi agent" and "update agent" commands added to AGENTS.md
- Paths fixed to `d:\\Software\\Human Os\\Human-OS`

### Action Required by User
1. Add `NVIDIA_API_KEY_3` and `NVIDIA_API_KEY_4` to Render environment variables
2. Run migration `021_nova_corrections_log.sql` in Supabase SQL editor
3. Run `npx tsx scripts/cleanupTestMemories.ts` once to clean memory
4. Manually redeploy Render after git push
5. Do OTA update after Render is live

---
