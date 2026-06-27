# POST_INSTALL_VERIFICATION.md

**Purpose:** Manual test checklist to run after installing every new production APK.  
**Version:** v0.2.x  
**APK Build:** `60b2316f-5e79-4707-be43-e7401ed19269`  
**Profile:** `apk` → channel: `production`  
**Tester:** _______________  
**Device:** _______________  
**Android Version:** _______________  
**Date:** _______________

---

## How to Use

Run each check top to bottom. Mark each as:
- `[P]` **Pass** — works as expected
- `[F]` **Fail** — broken, note the symptom
- `[D]` **Degraded** — works but with issues
- `[S]` **Skipped** — could not test

---

## BLOCK 1 — Launch & Auth

| # | Check | Result | Notes |
|---|---|---|---|
| 1.1 | APK installs without error on Android | | |
| 1.2 | App opens — no white screen on launch | | |
| 1.3 | App opens — no red error screen on launch | | |
| 1.4 | Splash / loading screen appears briefly | | |
| 1.5 | Login screen renders with dark background | | |
| 1.6 | Login with email + password succeeds | | |
| 1.7 | Auth token persists (re-open app → stays logged in) | | |
| 1.8 | Signup flow works for new account | | |

---

## BLOCK 2 — Chat Screen

| # | Check | Result | Notes |
|---|---|---|---|
| 2.1 | Chat screen loads with dark `#09090B` background | | |
| 2.2 | Nova avatar visible in header (purple "N" circle) | | |
| 2.3 | "Your AI companion" subtitle visible | | |
| 2.4 | Empty state shown ("Hi, I'm Nova") on fresh account | | |
| 2.5 | Message input accepts text | | |
| 2.6 | Send button (↑) activates when text is typed | | |
| 2.7 | User message appears as purple right-aligned bubble | | |
| 2.8 | Nova reply appears as dark left-aligned bubble | | |
| 2.9 | "Nova is typing..." dots animate during response | | |
| 2.10 | ⚙️ header button navigates to Settings | | |
| 2.11 | 🧠 header button navigates to Brain Dashboard | | |
| 2.12 | Conversation persists after closing and reopening app | | |

---

## BLOCK 3 — Brain Dashboard (Native Modules)

> ⚠️ This block specifically verifies that native Skia / SVG / Reanimated modules loaded correctly.

| # | Check | Result | Notes |
|---|---|---|---|
| 3.1 | Brain Navigator opens (bottom tab bar visible) | | |
| 3.2 | Memory tab — category cards render (not blank) | | |
| 3.3 | Memory tab — search input works | | |
| 3.4 | Memory tab — memory count numbers display | | |
| 3.5 | Emotions tab — bar graph renders (Skia) | | |
| 3.6 | Emotions tab — weekly / monthly toggle works | | |
| 3.7 | Goals tab — progress rings render | | |
| 3.8 | Goals tab — active goals list visible | | |
| 3.9 | Timeline tab — events list renders | | |
| 3.10 | Graph tab — knowledge graph nodes render (d3 + Skia) | | |
| 3.11 | Memories tab — memory management list loads | | |
| 3.12 | Founder tab — stats cards render with pull-to-refresh | | |
| 3.13 | Beta tab — 5-tab observatory opens | | |
| 3.14 | Beta tab → Retention — DAU bars render | | |
| 3.15 | No "Invariant Violation: Native module cannot be null" errors | | |

---

## BLOCK 4 — Settings Screen

| # | Check | Result | Notes |
|---|---|---|---|
| 4.1 | Settings screen opens from ⚙️ | | |
| 4.2 | All 6 sections visible (Notifications, Privacy, Data, Feedback, About, Developer Mode) | | |
| 4.3 | Toggle switches respond to tap | | |
| 4.4 | Developer Mode toggle reveals Diagnostics + Founder links | | |
| 4.5 | "Export My Data" triggers API call and shows result | | |
| 4.6 | "Send Feedback" navigates to Feedback screen | | |
| 4.7 | Version number displayed correctly | | |
| 4.8 | "Delete All Data" shows confirmation alert before acting | | |

---

## BLOCK 5 — Feedback Screen

| # | Check | Result | Notes |
|---|---|---|---|
| 5.1 | Feedback screen opens | | |
| 5.2 | All 4 type buttons visible (Bug, Idea, Emotional, General) | | |
| 5.3 | Selected type highlights with correct color | | |
| 5.4 | Placeholder text changes when type is selected | | |
| 5.5 | Star rating tap selects stars | | |
| 5.6 | "Send Feedback" submits and shows thank-you alert | | |
| 5.7 | Empty message shows validation alert (does not submit) | | |
| 5.8 | Feedback appears in backend `GET /feedback` | | |

---

## BLOCK 6 — OTA Update Check

| # | Check | Result | Notes |
|---|---|---|---|
| 6.1 | Close app fully (remove from recents) | | |
| 6.2 | Reopen app | | |
| 6.3 | EAS Dashboard → Updates → `production` shows a delivery | | |
| 6.4 | No error related to OTA runtime version mismatch | | |
| 6.5 | `eas update --branch production` can deliver new JS bundle | | |

---

## BLOCK 7 — Performance & Stability

| # | Check | Result | Notes |
|---|---|---|---|
| 7.1 | App launches in under 5 seconds from cold start | | |
| 7.2 | Chat messages deliver in under 3 seconds | | |
| 7.3 | Brain Dashboard tabs switch without lag | | |
| 7.4 | Scroll in memory list is smooth (60fps) | | |
| 7.5 | Pull-to-refresh completes on all dashboard screens | | |
| 7.6 | App does not crash after 10 minutes of use | | |
| 7.7 | Memory usage stays below 300MB (Android Dev Tools) | | |
| 7.8 | No ANR (App Not Responding) dialogs | | |

---

## BLOCK 8 — Error Resilience

| # | Check | Result | Notes |
|---|---|---|---|
| 8.1 | Turn on airplane mode → app shows offline banner or graceful state | | |
| 8.2 | Turn airplane mode off → app recovers without restart | | |
| 8.3 | Force a network error → retry button appears on failed message | | |
| 8.4 | Artificial slow network → skeleton loaders appear on Brain screens | | |

---

## Pass Criteria

| Threshold | Meaning |
|---|---|
| All BLOCK 1 + BLOCK 2 pass | App is functional for beta users |
| All BLOCK 3 pass | Native modules loaded correctly — Expo Go issue resolved |
| All BLOCK 5 pass | Feedback pipeline working |
| BLOCK 6.3 passes | OTA updates will work without a new APK |
| Total score ≥ 90% | **Ready for Beta Users** |

---

## Quick Verdict

After completing all blocks, use this template:

```
Total checks: 37
Passed: ___
Failed: ___
Degraded: ___
Score: ____%

Ready for beta users: YES / NO / CONDITIONAL

Blocker bugs (must fix before beta):
1. ___
2. ___

Known issues (non-blocking):
1. ___
```
