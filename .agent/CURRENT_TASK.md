# CURRENT TASK

## Task ID
CONT-SETTINGS-CRASH-MEMORY-NAVIGATION

## Objective
Fix the persistent Android app crash when navigating from Settings toward the
memory-management / "Mark Dead (Shoot)" area, and ensure the existing memory
system keeps saving/editing the canonical memories — NOT a parallel memory
system.

## Scope
- Settings -> Brain navigation targets must point at routes that actually exist.
- MemoryManagementScreen must consume the backend's canonical memory
  representation (canonicalKey, label, memoryType, isArchived, createdAt,
  updatedAt) and edit existing memories via PATCH /memories/:id.
- Preserve the existing canonical memory lifecycle (archive/forget, atomic
  supersession, exactly one CURRENT) untouched.
- Validate the Shoot Dead confirmation modal does not crash and only calls
  DELETE /auth/mark-dead after exact "DELETE" confirmation.

## Non-Goals
- NOT redesigning the memory architecture.
- NOT creating a second memory store or replacing canonical memories.
- NOT hard-deleting memories where the lifecycle uses archive/forget.
- NOT touching auth, OTA, rate-limit, chat, or backend architecture.
- NOT blindly rewriting large files.
- NOT merging into `main` or pushing `main`.

## Acceptance Criteria
1. Static validation passes (mobile type-check; relevant backend tests).
2. Every Settings navigation target resolves to a real route in the current
   navigators.
3. Memory manager loads canonical fields, searches safely, edits an existing
   memory via PATCH /memories/:id, preserves canonical key + history, and does
   not create duplicates.
4. Shoot Dead modal opens, can be cancelled, requires exactly "DELETE", then
   calls /auth/mark-dead and logs out.
5. Handoff updated; clean checkpoint commit on the fix branch with SHA
   reported; branch marked READY_FOR_REVIEW only if evidence supports it.

## Constraints
- Work only on branch `fix/settings-crash-memory-navigation`. Never `main`.
- Preserve all memory invariants listed in SESSION_BOOT.md / FINDINGS.md.
- No secrets or unnecessary PII in continuity files.
- Real-device crash behavior is NOT reproducible in this sandbox (no Android
  SDK/emulator). Distinguish code-level verification from device evidence.

## Relevant Subsystem
Expo mobile app under `mobile/` (SettingsScreen, BrainNavigator,
MemoryManagementScreen) and the memory API under `backend/`
(memoryManagement.ts, memoryRepository.ts). Backend is read-only for this task.

## Status (of THIS task)
FIXES COMMITTED; VALIDATION IN PROGRESS/COMPLETE; see CURRENT_HANDOFF.md.
