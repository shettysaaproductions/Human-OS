# HumanOS Active Tasks

## 🔥 In Progress
- [ ] Deploy Auto Upgrade V2 to Render (manual step — user to trigger)
- [ ] Add NVIDIA_API_KEY_3 and NVIDIA_API_KEY_4 to Render env vars
- [ ] Run `021_nova_corrections_log.sql` migration in Supabase
- [ ] Run `npx tsx scripts/cleanupTestMemories.ts` to seed real memories

## 📋 Backlog
- [ ] OTA update after Render redeploy
- [ ] Test correction flow: reply to Nova msg → verify patch appears in nova_behavioral_patches
- [ ] Test proactive outreach: wait 30 min silence → verify Nova reaches out
- [ ] Monitor FreeTierGuard logs for any limit warnings

## ✅ Completed (Auto Upgrade V2 — 2026-07-30)
- [x] NovaRealtimeLearningService.ts — real-time correction detection
- [x] NovaSelfImprovementService.ts — upgraded to 12 flaw types, daily, incremental scan
- [x] FreeTierGuardService.ts — zero-cost enforcement
- [x] promptBuilder.ts — 4 new anti-robot rules + dynamic reload
- [x] chat.ts — correction detection hook
- [x] NovaConsciousnessEngine.ts — intelligent dynamic gap + coma awareness
- [x] nvidia.ts — multi-key pool (Key 3 + Key 4 clients)
- [x] config/index.ts — NVIDIA_API_KEY_3 + NVIDIA_API_KEY_4
- [x] index.ts — server boot/shutdown uptime tracking
- [x] 021_nova_corrections_log.sql — corrections log + scan checkpoints table
- [x] cleanupTestMemories.ts — memory cleanup + re-seeding script
- [x] AGENTS.md — updated Auto Upgrade (12 flaws), hi agent, update agent commands
