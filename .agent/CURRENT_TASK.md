# CURRENT TASK

## Task ID
ADAPTIVE-LIVING-CONSCIOUSNESS-HEARTBEAT-UPGRADE

## Objective
Implement Option A ("Adaptive Living Consciousness") to transition from rigid static 15-minute background cron loops into an always-active, dynamically paced presence orchestrator:
1. **Adaptive Living Consciousness Orchestrator (`AdaptiveConsciousnessScheduler.ts`)**:
   - Classifies user presence and activity into 3 dynamic cadence profiles:
     - `ACTIVE` (Online, typing, or chatted in last 15 min): 90s NACE pulse, 2-minute Watchtower Heartbeat.
     - `WARM` (Active in last 2 hours): 3-minute NACE pulse, 5-minute Watchtower Heartbeat.
     - `AMBIENT` (Idle > 2 hours or quiet hours 10 PM - 6 AM): 15-minute NACE, 15-minute Watchtower.
   - Guarded by 30-second tick evaluation with re-entrancy concurrency locks.
2. **Watchtower Heartbeat Dynamic Cadence Support (`WatchtowerHeartbeatService.ts`)**:
   - Upgraded `deriveHeartbeatWindowId` and `acquireLease` to support dynamic `slotMinutes` (defaulting to 2-minute slots).
   - Scaled `leaseUntil` dynamically to prevent lease collisions on high-frequency pulses.
3. **Real-Time Event-Driven Knowledge Graph Curation (`memoryRepository.ts`)**:
   - Connected `AutonomousMemoryGraphCuratorService.curateUserMemoryGraph(userId)` to the post-upsert non-blocking execution hook so memory changes curate the Knowledge Graph immediately.
4. **Server Boot Integration (`backend/src/index.ts`)**:
   - Replaced static `setInterval(15m)` calls with `adaptiveConsciousnessScheduler.start()`, preserving 30s and 90s initial boot warmup pulses.

## Scope
- `backend/src/services/AdaptiveConsciousnessScheduler.ts`
- `backend/src/services/WatchtowerHeartbeatService.ts`
- `backend/src/services/memoryRepository.ts`
- `backend/src/index.ts`

## Verification Gates Passed
- `npm run build` in `backend`: **EXIT 0** (0 errors).
- `npx jest --testPathPattern=WatchtowerHeartbeatPhase3a` in `backend`: **EXIT 0** (20/20 passed).
- `npx jest --testPathPattern=EngineSchedulerLiveness` in `backend`: **EXIT 0** (13/13 passed).
- `npx tsc --noEmit` in `mobile`: **EXIT 0** (0 errors).
