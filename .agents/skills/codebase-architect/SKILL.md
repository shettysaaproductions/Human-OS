---
name: codebase-architect
description: High-level engineered Module Architecture Map (MAM) and automated codebase tree generator. Use to navigate HumanOS files, architecture layers, database schemas, and LLM routes with minimal token usage. Essential for Gemini 3.8 Flash and fresh sessions to locate files, brainstorm architecture, and solve complex software engineering tasks without bloated context.
---

# Codebase Architect Skill (Module Architecture Map — MAM)

This skill provides an engineered, token-efficient mental map and automated directory tree for HumanOS. It empowers Gemini 3.8 Flash and developer agents to instantly navigate files, understand data flows, identify architectural boundaries, and execute complex engineering tasks without scanning hundreds of files or wasting tokens.

---

## 1. Quick Navigation Roadmap

When starting an architectural task or bug investigation, refer directly to:
👉 [ARCHITECTURE_TREE.md](./references/ARCHITECTURE_TREE.md)

### Key Subsystems & Direct File Destinations:
- **Chat Turn Pipeline & Message Delivery**:
  - `backend/src/routes/chat.ts` — Main turn intake, debouncer, burst aggregation, message coalescing, fallback safety-net.
  - `mobile/src/store/useChatStore.ts` — Client chat store, multi-bubble turn splitting, 5–10s human-paced messaging intervals.
- **LLM Cognitive Routing & Providers**:
  - `backend/src/lib/cognitiveRouter.ts` — Provider dispatcher (Gemini 3.8 Flash primary ↔ NVIDIA failover), deadline budgeting.
  - `backend/src/lib/gemini.ts` — 20-slot Gemini credential pool, model cascade, rate-limit classification, 404 fast-fail.
  - `backend/src/lib/nvidia.ts` — NVIDIA NIM client, 49B/11B/8B model integration, BrainKeyRouter.
- **Tone, Voice & Watchtower**:
  - `backend/src/services/WatchtowerInspector.ts` — Real-time filter: removes parental terms ("Beta"), repairs Hindi verbs, blocks leaks.
  - `backend/src/services/promptBuilder.ts` — Prompt assembly, feminine peer friendship, grounding rules.
- **Neural Galaxy & Knowledge Graph**:
  - `mobile/src/screens/analytics/KgExplorerScreen.tsx` — Default 2D tactical view, auto-fit zoom, 36 live synaptic action potential pulses.
  - `backend/src/services/AutonomousMemoryGraphCuratorService.ts` — Knowledge graph extraction and continuous curation.
- **Supabase Database & Memory**:
  - `backend/src/lib/supabase.ts` — Supabase admin client.
  - `backend/src/services/MemoryLayer.ts` — Working, episodic, and semantic memory retrieval.

---

## 2. Supabase Postgres Database Blueprint

- **`chat_history`**:
  - Stores coalesced turns separated by `\n<NOVA_MESSAGE_BREAK>\n`.
  - Avoids duplicate row spam and simultaneous timestamp clutter.
- **`profiles`**:
  - Stores user preferences (`preferred_name`, `companion_personality`, `grammatical_gender`, `push_token`).
- **`knowledge_nodes`** & **`knowledge_edges`**:
  - Backs the Neural Galaxy visualization.
  - 5 core departments: Core Identity, Family & Relationships, Career & Professional, Lifestyle & Rhythm, Goals & Ambitions.
- **`reminders`** & **`life_threads`**:
  - Deterministic user ambitions and reminders queried in < 200ms without LLM latency.

---

## 3. Regenerating & Growing the Architecture Tree

As new files, services, screens, and database migrations are added to HumanOS, regenerate the architecture tree by running:

```bash
npx ts-node .agents/skills/codebase-architect/scripts/generate_architecture_map.ts
```

This updates [ARCHITECTURE_TREE.md](./references/ARCHITECTURE_TREE.md) with all new files, updated sizes, and annotated descriptions.

---

## 4. Architect Engineering Guidelines for Gemini 3.8 Flash

1. **Direct File Targeting**: Always check the architecture map before running broad file searches. Target the exact module responsible for the task.
2. **Context Budgeting**: Keep prompts focused. With Gemini 3.8 Flash, pass specific module slices rather than bloated entire directories.
3. **No-Hard-Delete Invariant**: Never delete user memories or knowledge nodes permanently; mark inactive or archive.
4. **Single-Turn Coalescing**: Assistant responses must be saved as a single turn joined by `<NOVA_MESSAGE_BREAK>`.
5. **OTA & Pre-flight Protocol**: Always run `mobile/npx tsc --noEmit` and `backend/npm run build` before pushing to `main` or triggering EAS OTA updates.
