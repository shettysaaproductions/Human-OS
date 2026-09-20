---
description: Automatically sync and maintain Archify architecture, sequence, workflow, dataflow, and lifecycle diagrams when modifying core subsystems
---
# Archify Living Diagram Synchronization Protocol

## Trigger
Whenever modifying core subsystems or architectural contracts in Human OS:
1. `backend/src/services/` (NovaBrain, Consciousness NACE, ModelRouter, Memory/Graph Engines)
2. `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`, `mobile/src/services/api.ts` (Auth lifecycle & token refresh)
3. `DEPLOYMENT.md`, `mobile/app.json`, `render.yaml` (Deployment & release tracks)
4. `backend/src/workers/` (e.g. `SemanticTurnWorker.ts`), `COGNITIVE_HEALTH_AND_RETENTION.md` (Memory ingestion, ETL, and compaction lifecycle)

## Architecture Matrix & Mapping

| Subsystem Changed | Primary Archify Spec | Compiled HTML Output | Diagram Type |
|---|---|---|---|
| Core engines, gateways, database boundaries | `human-os.architecture.json` | `human-os.architecture.html` | `architecture` |
| Auth, JWT, silent token refresh, 401 replay | `auth-flow.sequence.json` | `auth-flow.sequence.html` | `sequence` |
| Git push, Render build, EAS OTA, release channels | `deployment-pipeline.workflow.json` | `deployment-pipeline.workflow.html` | `workflow` |
| Message intake, embeddings, entity extraction, pgvector | `memory-etl.dataflow.json` | `memory-etl.dataflow.html` | `dataflow` |
| Memory lifecycle, compaction, quota backpressure | `memory-compaction.lifecycle.json` | `memory-compaction.lifecycle.html` | `lifecycle` |

## Required Execution Sequence

1. **Review & Update Specification:**
   - Update the relevant Archify `.json` specification so that nodes, endpoints, services, and labels reflect the real code changes.
   - Maintain schema invariants (`schema_version: 2` for workflow, strict staging for dataflow, valid column alignments for lifecycle).

2. **Validate Quality:**
   Run the showcase quality validator to ensure 9/9 checks pass with 0 errors and 0 warnings:
   ```bash
   node "C:/Users/Laptop 6/.gemini/config/skills/archify/bin/archify.mjs" validate <type> <spec.json> --quality showcase --json
   ```

3. **Deliver & Recompile HTML:**
   Recompile the standalone interactive HTML artifact:
   ```bash
   node "C:/Users/Laptop 6/.gemini/config/skills/archify/bin/archify.mjs" deliver <type> <spec.json> <output.html> --quality showcase --json
   ```

4. **Commit with Changes:**
   Commit the updated `.json` and `.html` files alongside the source code modifications so the diagrams remain an accurate, live blueprint for both developers and AI agents.
