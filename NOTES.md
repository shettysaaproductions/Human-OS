# HumanOS Agent Notes

Working notes and observations maintained by the Antigravity agent.

---

## Key Observations (2026-07-30)

### Nova Behavioral State
- **Memory is essentially empty** — all 30+ entries were test_memory_* garbage. Real user facts need seeding via `cleanupTestMemories.ts`.
- **Behavioral patches table was empty** — NovaSelfImprovementService had never successfully run. The daily scheduler was there but never produced output.
- **Working memory all expired** — all entries from June 2026, none from July. This means the STM extraction pipeline is running but entries are expiring before they matter.
- **NACE was theoretically running every 15 min** but never sent a proactive message. Root cause: the `MIN_GAP_MINUTES=45` + sleep window + `gapMinutes < 30` check was blocking everything.

### Multi-Key NVIDIA Strategy
- Key 1 (`NVIDIA_API_KEY`): User-facing chat only — highest priority
- Key 2 (`NVIDIA_API_KEY_2`): NACE + Reflection Scheduler
- Key 3 (`NVIDIA_API_KEY_3`): Self-Improvement + Realtime Learning ← **ADD THIS**
- Key 4 (`NVIDIA_API_KEY_4`): Memory extraction ← **ADD THIS**
- All keys fall back to each other if one rate-limits or fails

### Architecture State After V2
- Engine count: 7 → 9 (added NovaRealtimeLearningService + FreeTierGuardService)
- Self-improvement: weekly → daily, 5 flaws → 12 flaws, incremental scan
- NACE gap: fixed 45 min → intelligent dynamic gap (15–480 min based on situation)

### Free-Tier Budget Status
- Supabase: ~30 chat messages in history, 30+ test memories being cleaned. Storage should be well under 500MB.
- NVIDIA: No rate limit issues observed yet.
- Render: 15-min NACE pulse keeps server alive during active hours (correct behavior).

---

## Known Issues (Post-V2)

1. `nova_scan_checkpoints` table doesn't exist yet — migration needs to be run in Supabase
2. `nova_corrections_log` table doesn't exist yet — same migration
3. `reply_to_content` field may not exist in the chat_history table — if the mobile app doesn't send it, correction detection will silently skip
4. The `is_recurring` column in `nova_agenda` — verify it exists before `syncHabitTriggers` runs

---

## Improvement Ideas (Future)

- Add a "relationship level" metric (0–100) that increases with each meaningful conversation. Nova's tone should shift as this increases.
- Memory consolidation: merge similar STM entries into long-term automatically.
- Goal tracking: when user mentions wanting to start something (gym, diet, learning), create a multi-day agenda with daily nudges.
- Sentiment trend: track emotional trend over 7 days and flag if consistently negative.
