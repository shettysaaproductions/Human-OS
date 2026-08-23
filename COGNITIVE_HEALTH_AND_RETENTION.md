# Cognitive Storage, Memory Retention & Resource Governance

This document serves as the architectural contract for Human-OS long-term data retention, memory scaling, and background resource usage. It describes the **actual implemented policies** for the cognitive subsystem.

> **ARCHITECTURAL PRINCIPLE**: No maintenance operation may trade away user-message integrity, active task state, or interactive response availability for the sake of storage cleanup.

## 1. Memory Tiers & Compaction

Human-OS uses a multi-tier memory system to prevent unbounded growth while maintaining cognitive context over decades of use.

### Raw Chat (HOT / SHORT_TERM)
* **Definition**: The literal transcript of what was said.
* **Retention Policy**: Raw messages are retained if they are part of the active context (default 30 days or ~500 messages). 
* **Compaction Lifecycle**:
  `raw → compaction_pending → durable episode/facts persisted → compaction_verified → deletion_eligible → delete`
* **Deletion Rules**: A raw message is only hard-deleted if it is:
  - Outside the hot retention window.
  - Successfully compacted (marked `deletion_eligible`).
  - Not referenced by a pending queue job, unresolved reply, or active contradiction.
  - Not explicitly protected by the user.
  - Not part of an active debug/audit trace.

### Episodic Memories (MID_TERM)
* **Definition**: Compressed summaries of events occurring over days, weeks, or specific contexts (e.g., "August 2026: Explored starting a home cloud kitchen").
* **Policy**: Replaces raw chat transcripts. Generated via a bounded chunking pipeline to avoid overloading LLM token limits on large transcripts.

### Explicit Facts & Identity (LONG_TERM / DURABLE)
* **Definition**: Highly-durable traits, relationships, and preferences (e.g., "Wife's name is Sakshi").
* **Policy**: Persisted via idempotent upsert with confidence scoring and source-message tracking.
* **Protection/Forget Rules**: 
  - Standard decay/forget requests result in archiving (`is_archived = true`) and redaction from active retrieval context.
  - Explicit user requests to "forget completely" result in hard-deletion of the target memory (and associated protected references), validated against the exact target and ownership.

## 2. Resource Governance

### NVIDIA Capacity Selection
* **Decoupled Architecture**: Background queues do not directly manage RPM or API keys. Instead, they interact with the capability-aware `BrainKeyRouter` scheduler.
* **Advisory Yielding**: `QueueService` requests capacity (`canRun`). If the required brain region (e.g., hippocampus) is busy or rate-limited, the background job yields (exponential backoff) and remains pending.
* **Priority Allocation**: 
  - The scheduler prefers: healthy capacity, correct model capability, lower recent utilization, priority, and bounded budget.
  - **Rule**: Never generate synthetic work just to consume quota.

### Bounded Queue Lifecycle
* Jobs transition: `pending → running → completed/failed`.
* Completed and failed jobs are retained for a bounded period (e.g., 7 days) to support diagnostics and audit trails, then cleaned up by maintenance tasks.
* Cleanup tasks are rate-limited to avoid starving interactive workloads.

## 3. Maintenance & Health Thresholds

### Maintenance Pipeline
* Maintenance jobs (`compactChatHistory`, `compressLongTermMemory`, etc.) are enqueued as durable background jobs rather than monolithic direct executions.
* Jobs use locks to prevent overlapping or duplicate compaction.
* Support for a `dry_run` mode allows previewing compaction and deletion metrics before executing destructive operations.

### Kill-Switch / Backpressure Policies
Cognitive backpressure is governed by composite health metrics (e.g., Database Storage %, Raw Row Counts):
* **70% Capacity**: Increase maintenance job frequency.
* **80% Capacity**: Aggressively compact eligible raw chat and episodes.
* **90% Capacity**: Stop nonessential background persistence.
* **95% Capacity**: Disable low-priority background cognition to protect core interactive routing.

### Aggregate Health Monitoring
An endpoint (`/api/health/cognitive`) tracks:
* Pending queue age, compaction backlog, failed job rates.
* Raw chat count, memory row growth, estimated database storage footprint.
* Retention lag (e.g., `oldest_raw_message_age`, `compaction_lag_seconds`).
