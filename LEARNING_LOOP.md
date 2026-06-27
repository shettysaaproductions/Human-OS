# Learning Loop Process Spec

**Mission:** Establish a strict, evidence-based process to turn dogfooding feedback into product improvements.

---

## 1. Input Sources (Collect)

Every 7 days, gather and inspect the following source files:
*   **[DAILY_DOGFOOD_LOG.md](file:///e:/project%20software/Human%20OS/DAILY_DOGFOOD_LOG.md)**: Daily developer companion experiences, ratings, and qualitative ideas.
*   **[DOGFOOD_MOMENT_TEST.md](file:///e:/project%20software/Human%20OS/DOGFOOD_MOMENT_TEST.md)**: Logs of Moment Engine reactions, delight triggers, and notification ratings.
*   **[PRODUCT_INSIGHTS.md](file:///e:/project%20software/Human%20OS/PRODUCT_INSIGHTS.md)**: Captured user behaviors, loved vs. ignored feature lists, and opportunities.
*   **[CRASH_LOGS.md](file:///e:/project%20software/Human%20OS/CRASH_LOGS.md)**: Production/staging runtime failures, database degradation metrics, and timeout warnings.

---

## 2. Review Protocol (Weekly Output)

Every 7 days, synthesize inputs to generate:
### `WEEKLY_PRODUCT_REVIEW.md`

#### Required Sections:
1.  **Most Loved Moments:** Triggers, responses, and check-ins that generated high user ratings, smiles, or conversational depth.
2.  **Most Ignored Moments:** Notifications left unopened, dismissed, or resulting in category toggles.
3.  **Bugs Discovered:** Stack traces, local database connection cache resets, and UI crashes.
4.  **Surprising User Behavior:** Unanticipated ways dogfooders interact with Nova, unintended workflows, or off-label usage.
5.  **Features Requested:** Gaps identified during daily usage (must contain quotes/rationales).
6.  **Features to Remove:** Abstractions, models, or alerts that create friction, spamminess, or bloat.
7.  **Metrics Summary:** Compilation of:
    *   DAU / Message volume.
    *   Moment open and reply rates.
    *   API Latency, database heartbeat status, and error volume.
8.  **Recommended Next Sprint:** Selected 1-3 tasks directly resolving observed issues.

---

## 3. Core Development Rule

> [!IMPORTANT]
> **No new feature enters development without evidence from real usage.**
> Architecture refactors, new frameworks, or complex LLM agents must be backed by qualitative or quantitative logs proving they resolve observed user friction or improve relationship metrics.

---

## 4. `WEEKLY_PRODUCT_REVIEW.md` Template

Use the following markdown template for weekly reviews:

```markdown
# Weekly Product Review: Week [X] (Date Range)

## 1. Qualitative Evaluation
*   **Most Loved Moments:**
    *   *Moment Type:* [e.g. GOAL_FOLLOW_UP]
    *   *Details:* [Why did it work? What did Nova say?]
*   **Most Ignored Moments:**
    *   *Moment Type:* [e.g. CHILD_MILESTONE]
    *   *Details:* [Why was it ignored? Did it feel generic?]
*   **Surprising User Behavior:**
    *   [e.g., User using Nova's goals check-in as a daily work standup log.]

## 2. Stability & Health
*   **Bugs Discovered:**
    *   [e.g., PostgREST schema cache out of sync on migration run.]
*   **Features to Remove / Simplify:**
    *   [e.g., Simplify onboarding timezone questions to prevent signup drop-off.]

## 3. Features & Optimizations Requested
*   *Request:* [Feature name]
*   *Evidence:* [Reference log entry or user quote proving pain/value]

## 4. Metrics Summary
| Metric | Value | Target | Status (PASS/FAIL) |
| :--- | :--- | :--- | :--- |
| **DAU** | | > 5 | |
| **Message Count** | | > 20/day | |
| **Moment Open Rate** | | > 70% | |
| **Moment Reply Rate** | | > 40% | |
| **Moment Disable Rate**| | < 5% | |
| **Backend Latency** | | < 800ms | |

## 5. Next Sprint Recommendations
1. [x] [Task 1 - Priority Bugfix/Cleanup]
2. [ ] [Task 2 - Evidence-backed Feature]
```
