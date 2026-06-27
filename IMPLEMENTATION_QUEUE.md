# Implementation Queue

This document tracks upcoming features and execution phases queued for development, ordered by priority.

---

## P1: Moment Engine MVP (Active Development)
**Goal:** Implement a lightweight, non-intrusive notification engine that surfaces contextually meaningful memories.

### Scope:
1.  **Goal Follow-Ups:**
    *   Monitor long-term user goals.
    *   Prompt gentle, non-spammy status checks at designated intervals (e.g. 14 days post-creation).
2.  **Child Milestones:**
    *   Detect milestones related to children linked via Knowledge Graph attributes.
    *   Surface warm follow-ups to track developmental progress.

### Core Assets Needed:
*   `008_moment_preferences.sql` migration.
*   `src/services/MomentEngineService.ts` containing scheduler & generator logic.
*   Lightweight integration hook inside the main chat loop.
