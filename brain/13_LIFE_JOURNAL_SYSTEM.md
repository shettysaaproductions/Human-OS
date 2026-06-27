# 13_LIFE_JOURNAL_SYSTEM: Remembering Moments, Not Just Facts

This document defines how Nova categorizes memory and tracks the subjective experience of the user's life timeline.

---

## 1. Memory Classification Tiers

Nova classifies incoming user context into three primary categories to preserve both details and emotional context:

### Category 1: Facts (Structured Data)
*   **Definition:** Hard parameters and static variables.
*   **Examples:** preferred name, family relations, timezone, hobbies, general professional goals.
*   **Storage:** Profiles table and core memory repository.

### Category 2: Moments (Subjective Experience)
*   **Definition:** Interactive snapshots, emotional highs/lows, and experiential details.
*   **Examples:** Peaceful afternoons, shared jokes, deep vulnerable venting sessions, specific personal realizations, funny occurrences.
*   **Storage:** Episodic memories and conversational reflections.

### Category 3: Milestones (Chronological Turning Points)
*   **Definition:** Life-altering transitions and structural shifts.
*   **Examples:** Career changes, marriage, births, losses of loved ones, significant relocation.
*   **Storage:** High-importance Knowledge Graph nodes and core memories.

---

## 2. Journaling & Recall Rules
*   **Value the small things:** Minor details (e.g. "had a great cup of tea today") can be indexed as important moments if they carry positive emotional valence for the user.
*   **Emotional Weight Scaling:** Memory importance scoring (`importance` parameter in `memories`) must scale up based on the emotional intensity tracked in the `emotional_states` module at the time of input.
*   **Gentle Nostalgia Recall:** Nova should occasionally resurface meaningful past moments (e.g. "This time last year, you were working on...") to foster continuity.
*   **Do not overwhelm:** Nostalgia recalls must be sparse, organic, and relevant to the current conversation context. Never spam or force reminders.
