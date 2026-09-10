# CURRENT TASK

## Task ID
BACKEND-BRAIN-OPTIMIZATION-DIVERSE-LIFESTYLES

## Objective
Fix critical backend Brain bugs, implement high-impact in-memory TTL caching and query parallelization to accelerate 20-second mobile polling, expand dynamic entity wardrobes and universal neural dot synthesis to support any lifestyle (students, fitness enthusiasts, artists, pet parents, freelancers, diverse families), and synthesize complete goals, emotions, and timeline milestone streams.

## Scope
- Keep `main` as the production source of truth.
- Implement in-memory TTL caching (15s) and parallel Supabase queries in `backend/src/routes/analytics.ts`.
- Invalidate analytics cache upon memory mutations in `backend/src/routes/memoryManagement.ts`.
- Overhaul `/analytics/goals` to synthesize both `kg_nodes` and `memories` table goals, partitioning active and completed goals with milestone timelines.
- Overhaul `/analytics/emotions` to calculate dominant emotion distributions and trends.
- Overhaul `/analytics/timeline` to blend high-importance life milestones (`importance >= 7`) with episodic memories and moments.
- Expand `backend/src/lib/memoryDomains.ts` and `backend/src/lib/memoryKeySchema.ts` with diverse lifestyle support (pets, daughters, partners, fitness, education, custom ventures).
- Maintain 100% test passing across all test suites (62/62 tests passing).

## Approved Code
All changes pass `cd backend && npm run build` (code 0), `cd mobile && npx tsc --noEmit` (code 0), and 62/62 backend unit tests.

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
