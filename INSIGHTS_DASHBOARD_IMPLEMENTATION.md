# Visual Insights Dashboard Implementation Spec

**Mission:** Expose Nova's underlying cognitive state, emotional logs, personal goals progress, and AI usage metrics through a beautiful visual analytics dashboard in the mobile application.

---

## 1. Backend Analytics Endpoints

The backend will expose five analytics routes under `/analytics` (mounted with `authenticateUser` middleware):

### 1.1 `GET /analytics/memories`
Returns breakdown of memory distribution by type and historical creation trend.
*   **SQL Query:**
    ```sql
    -- Memory counts by type
    SELECT memory_type, count(id) as count 
    FROM public.memories 
    WHERE user_id = $1 AND is_archived = false
    GROUP BY memory_type;
    ```

### 1.2 `GET /analytics/emotions`
Returns mood distribution and average emotional intensity trend over the last 14 days.
*   **SQL Query:**
    ```sql
    -- 14-day mood tracking
    SELECT mood, avg(intensity) as avg_intensity, count(id) as occurrences
    FROM public.emotional_states
    WHERE user_id = $1 AND created_at >= now() - INTERVAL '14 days'
    GROUP BY mood;
    ```

### 1.3 `GET /analytics/goals`
Returns goal progress nodes, checklist items, and milestones.
*   **SQL Query:**
    ```sql
    -- Fetch active goals & attributes
    SELECT id, name, attributes, created_at, updated_at
    FROM public.kg_nodes
    WHERE user_id = $1 AND entity_type = 'goal';
    ```

### 1.4 `GET /analytics/timeline`
Returns chronological timeline of significant episodic memories.
*   **SQL Query:**
    ```sql
    -- Episodic memory chronological timeline
    SELECT id, summary, emotion, emotional_valence, created_at
    FROM public.episodic_memories
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 30;
    ```

### 1.5 `GET /analytics/usage`
Returns AI token consumption, provider details, and query tracker latency stats.
*   **SQL Query:**
    ```sql
    -- Fetch aggregate user token execution logs (simulated or from agent_metrics)
    SELECT agent_name, sum(tokens_used) as total_tokens, avg(execution_time_ms) as avg_latency
    FROM public.agent_metrics
    WHERE created_at >= now() - INTERVAL '7 days'
    GROUP BY agent_name;
    ```

---

## 2. Mobile Client Experience (React Native)

All screens will support **dark mode** (dynamic color themes using React Native `useColorScheme()`), **lazy loading** (via React `Suspense` and `React.lazy`), and an **offline cache** (using `expo-secure-store` or async storage).

### 2.1 Screen Layouts

1.  **Memory Dashboard (`MemoryDashboard.tsx`):**
    *   *Visuals:* Pie chart showing distribution of memories (`preferences`, `goals`, `family`, `personal`, etc.).
    *   *Interactions:* Search bar to filter keywords; list of raw memories under each slice.
2.  **Emotional Dashboard (`EmotionalDashboard.tsx`):**
    *   *Visuals:* 14-day line chart displaying mood valence swings (from positive to negative valence).
    *   *Interactions:* Toggle to filter by intensities; export emotional diary.
3.  **Goal Dashboard (`GoalDashboard.tsx`):**
    *   *Visuals:* Bar chart tracking milestone completion percentages (computed from target goal attributes).
    *   *Interactions:* Add milestone, edit goal checklist.
4.  **Life Timeline (`LifeTimeline.tsx`):**
    *   *Visuals:* Chronological vertical timeline list with indicators colored by emotional valence (green for positive, red for negative).
    *   *Interactions:* Search bar, date range picker.
5.  **AI Usage Dashboard (`AIUsageDashboard.tsx`):**
    *   *Visuals:* Stacked bar chart showing NVIDIA Llama token usage vs. fallback / degraded mode invocations.
    *   *Interactions:* Toggle developer raw telemetry log views.

---

## 3. Developer Mode Panel

An extra developer menu will expose live diagnostic tools:
*   **Raw Memory Inspector:** Direct JSON dump of profile's `memories` table.
*   **Emotional States Feed:** Raw chronological mood logging events.
*   **Telemetry Monitor:** Display `moments_generated`, `moments_opened`, and `moments_dismissed` metrics.
*   **Background Jobs Console:** List active or failed background queue workers (`background_jobs`, `failed_jobs`).

---

## 4. EAS Over-The-Air (OTA) Updates

We utilize `expo-updates` to push fast bug fixes and UI updates to user devices without requiring a full App Store review.

### 4.1 `app.json` Configuration
Add the following blocks to configure over-the-air updates:
```json
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/YOUR-PROJECT-UUID",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 30000
    },
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

### 4.2 Deployment Automation Scripts
Add automation commands to `mobile/package.json` for publishing updates:
*   **Production Update:** `eas update --branch production --message "OTA Update"`
*   **Preview Update:** `eas update --branch preview --message "Preview Update"`

Commands mapping:
*   `npm run update:production` -> `eas update --branch production`
*   `npm run update:preview` -> `eas update --branch preview`
