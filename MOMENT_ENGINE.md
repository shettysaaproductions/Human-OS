# Moment Engine Design Spec

**Mission:** Design a lightweight, non-intrusive engine to surface contextual, meaningful, and emotionally resonant "magical moments" for the user.

---

## 1. System Components

### 1.1 `MomentType` Enum
Defines the distinct categories of emotional triggers handled by the engine:
```typescript
export enum MomentType {
  CHILD_MILESTONE = 'CHILD_MILESTONE',
  GOAL_FOLLOW_UP = 'GOAL_FOLLOW_UP',
  ACHIEVEMENT_CELEBRATION = 'ACHIEVEMENT_CELEBRATION',
  NATURAL_MEMORY_RECALL = 'NATURAL_MEMORY_RECALL'
}
```

### 1.2 User Preferences Table
A configuration layout storing user preferences for each moment type. Users have full sovereignty and can disable any category at will:
```sql
CREATE TABLE IF NOT EXISTS user_moment_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enable_child_milestones BOOLEAN DEFAULT true,
  enable_goal_follow_ups BOOLEAN DEFAULT true,
  enable_achievement_celebrations BOOLEAN DEFAULT true,
  enable_natural_memory_recall BOOLEAN DEFAULT true,
  max_notifications_per_week INT DEFAULT 2,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 1.3 `MomentScheduler` Service
Handles the timing, pacing, and selection of candidate moments.
*   **Job Frequency:** Runs daily as a low-priority background process.
*   **Pacing Safeguard:** Ensures total notifications surfaced do not exceed the user's set limit (default: 2 per week).
*   **Logic Flow:**
    1.  Query active users.
    2.  Check `user_moment_preferences`.
    3.  Inspect notification dispatch counters for the current week.
    4.  If within limits, query candidate memories and evaluate if triggers are satisfied.

### 1.4 `MomentGenerator` Service
Inspects database tables (`memories`, `episodic_memories`, `emotional_states`) to construct the payload for the moment.
*   **Child Milestones:** Finds knowledge graph relationships for children (`PARENT_OF`) and flags if a milestone update interval has elapsed.
*   **Goal Follow-Ups:** Scrapes active `HAS_GOAL` memories and checks if the elapsed time matches standard check-in intervals (e.g. 2 weeks, 1 month).
*   **Achievement Celebrations:** Looks for recent episodic events flagged with high positive valence that haven't been acknowledged.
*   **Natural Memory Recall:** Uses vector search to pull highly similar historical episodic events related to the current chat context.

### 1.5 Notification Hooks
Integrates into the runtime notifications layer:
```typescript
interface MomentNotification {
  userId: string;
  momentType: MomentType;
  title: string;
  body: string;
  sourceMemoryId?: string;
  createdAt: Date;
}
```

---

## 2. Guardrails & Rules
> [!IMPORTANT]
> *   **Never interrupt aggressively:** Surface moments during active user sessions (e.g., as part of the greeting) or as quiet daily summaries rather than disruptive, unprompted alerts.
> *   **Never over-notify:** Absolute cap of 2 notifications per week to protect conversational boundaries.
> *   **Never invent memories:** Prompts must rely strictly on database records. Hallucinated or speculative past events are strictly prohibited.
