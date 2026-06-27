# Brain Visualization System Spec

**Mission:** Transform Human OS into a visual representation of the user's mind, making Nova feel like a living, breathing digital brain rather than a standard chatbot.

---

## 1. Visual Brain Screen Specs

### 1.1 Memory Brain (`MemoryBrainScreen.tsx`)
Exposes long-term fact caches on an interactive, zoomable 2D/3D map mapping core categories onto brain regions:
*   **Neocortex (Reasoning & Projects):** Core active tasks, workflows, and current active projects.
*   **Hippocampus (Memories & People):** Historical facts, profiles of close contacts, and relationship records.
*   **Amygdala (Lessons & Skills):** Personal principles learned, soft/hard skills acquired.
*   **Prefrontal Cortex (Goals & Wishes):** Long-term goals, aspirations, and wishes.
*   **Design & Color Codes:**
    *   `Memories`: Deep Violet (`#8B5CF6`)
    *   `Goals`: Electric Green (`#10B981`)
    *   `Wishes`: Coral Pink (`#EC4899`)
    *   `Skills`: Bright Yellow (`#F59E0B`)
    *   `People`: Neon Cyan (`#06B6D4`)
    *   `Places`: Emerald Green (`#34D399`)
    *   `Lessons`: Lavender (`#A78BFA`)
    *   `Projects`: Laser Blue (`#3B82F6`)

### 1.2 Emotional Brain (`EmotionalBrainScreen.tsx`)
A space showing mood shifts, trends, and emotional triggers:
*   **Valence Graph:** 2D interactive wave mapping valence swings (using `react-native-graph`).
*   **Emotional Heatmap:** Grid displaying daily mood intensities (similar to a GitHub contribution chart but color-graded by emotional state).
*   **Dominant Pattern Cards:** Cards summarizing primary emotional cycles (e.g. *"Calm & Focused on Tuesday mornings"*).

### 1.3 Goal Brain (`GoalBrainScreen.tsx`)
Draws active targets as a galaxy constellation:
*   **Constellations:** Interlinked stars (using `react-native-svg`), where each star represents a goal, and connections represent milestones.
*   **Progress Rings:** Concentric progress indicators (using `react-native-skia` for smooth, native rendering) showing completion status of sub-tasks.

### 1.4 Life Timeline (`LifeTimelineScreen.tsx`)
A unified scrollable chronological interface:
*   **Views:** Dual-mode (Monthly Calendar view and vertical Scroll List).
*   **Timeline Nodes:** Plotted timeline showing:
    *   *Episodic memories:* Captured facts.
    *   *Moments:* Proactive alerts that fired.
    *   *Reflections:* Daily summaries synthesized.
    *   *Milestones:* Celebrations logged.

### 1.5 Knowledge Graph Explorer (`KgExplorerScreen.tsx`)
An interactive force-directed graph (using custom Skia or SVG layouts):
*   **Nodes & Edges:** Visualizes connections between places, concepts, goals, and people.
*   **Interactions:** Double-tap to expand connections, zoom with pinch gestures, filter nodes by type, and search bar with autocomplete.

### 1.6 Founder Dashboard (`FounderDashboardScreen.tsx`)
Lightweight operational control panel:
*   **Stats Display:** Total memories created, Active users (MAU/DAU), Moments generated, Reflections consolidated, Live API billing (USD), and system server status indicators.

---

## 2. Design Language & Tokens

We adopt a premium, cybernetic design system:
*   **Theme:** Dark mode first (`#09090B` background, `#18181B` surface cards).
*   **Accents:** Vibrating neon colors with high opacity overlays.
*   **Glassmorphism:** Clear borders, high blur radius backdrops:
    *   `backgroundColor: 'rgba(255, 255, 255, 0.03)'`
    *   `borderColor: 'rgba(255, 255, 255, 0.08)'`
    *   `borderRadius: 16`
*   **Atmosphere:** Low-weight background particle animations (Skia canvas drawing floating glowing nodes).
*   **Transitions:** Shared element transitions (Reanimated 3) when drilling down from brain region to raw memory lists.

---

## 3. Libraries

We require the following mobile-native libraries:
*   **`react-native-svg`**: Renders scalable graph vector nodes, constellations, and connector edges.
*   **`react-native-skia`**: Handles high-performance GPU-accelerated drawing for particle fields, neon glow effects, and dynamic graphs.
*   **`react-native-reanimated`**: Orchestrates 60fps animations, zoom gestures, and region entry transitions.
*   **`react-native-graph`**: Renders fast, interactive cubic bezier charts for emotional valence.
*   **`react-native-gifted-charts`**: Renders stacked bar/line telemetry charts on the Founder Dashboard.

---

## 4. OTA Deployment Strategy

To ensure zero-downtime rollouts of UI adjustments:
*   Configure EAS Updates to automatically deploy all JS/Asset changes to production:
    ```bash
    eas update --branch production --message "Deploy Brain Visualization System UI updates"
    ```
*   Ensure that any new native modules (like Skia or SVG) are compiled into the native wrapper first via development builds before pushing OTA bundles to avoid mismatches.
