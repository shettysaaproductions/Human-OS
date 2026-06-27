# Post-Alpha Plan

**Mission:** Prepare Human OS for real internal users and transition from an internal alpha into a product used every day.

## Phase 1 (Tomorrow): Alpha Deployment & Verification
*   Install APK on 2-5 test devices.
*   Test core end-to-end user flows on real hardware:
    *   Signup & Login
    *   Onboarding (6 core questions)
    *   Chat Engine (sending, receiving, retry)
    *   Memory Recall (semantic retrieval accuracy)
    *   Background Processing (queue health and sync)

## Phase 2: Telemetry & Crash Reporting
*   **Create:** `CRASH_LOGS.md`
*   Implement automatic exception capture to record:
    *   Errors and unhandled exceptions
    *   Stack traces
    *   Device models
    *   App versions

## Phase 3: User Insights & Feedback
*   **Create:** `USER_FEEDBACK.md`
*   Track qualitative data from alpha testers:
    *   Identified bugs
    *   Feature requests
    *   Emotional reactions to Nova
    *   Confusing UX flows

## Phase 4: Operational Metrics Dashboard
Develop a unified dashboard to monitor system vitality:
*   Daily Active Users (DAU)
*   Total conversations processed
*   Memory object counts
*   Background queue health and processing latency
*   API usage costs (LLM tokens, infrastructure)

## Phase 5: v0.2.0-beta Roadmap Preparation
Prepare the architecture and sprint plan for the next major release.
**Key Features for Beta:**
*   **Voice Mode:** Speech-to-text and text-to-speech conversational flows.
*   **Relationship Engine:** Organic progression from stranger to companion.
*   **Reflection Engine:** Automated daily/weekly summaries and insights.
*   **Push Notifications:** Meaningful, non-intrusive re-engagement (no guilt-tripping).
*   **Admin Panel UI:** Web interface to manage models, keys, and routing rules securely.
*   **Multi-Model Consciousness Routing:** Dynamic failover and prioritization using `ModelRouterService`.
