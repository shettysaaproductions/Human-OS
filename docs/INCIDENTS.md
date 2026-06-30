# HumanOS — Incidents
> Last Updated: 2026-06-30

---

## INC-001 — Chat History Regression
**Date:** 2026-06-30
**Severity:** P0
**Duration:** ~2 hours

**Summary:**
A feature development commit introduced a change to `useChatStore.ts` that broke chat history loading. Users who reopened the app saw an empty chat.

**Root Cause:**
A commit modifying the Zustand store or hydration logic overwrote the correct `hydrateMessages` implementation.

**Resolution:**
Created branch `feature-recover-ui` from safe production baseline `c2c0fd0`. Cherry-picked individual feature commits (`95b66cd`, `89fb226`, `40a94f8`, `d1ef9c4`) to restore timestamps, floating date header, and multiple message sending without reintroducing the regression.

**OTA Published:** `46c2969e-1787-4cfd-a860-3fa0df18f1fa`

**Prevention:**
- Never cherry-pick commits that touch `hydrateMessages`, `conversationId`, or `isHydrated` without manual verification.
- Always run manual cold-start test (force-close + reopen) before OTA.

---

## INC-002 — Dev Diagnostics Visible in Production
**Date:** 2026-06-30
**Severity:** P0
**Duration:** ~1 hour

**Summary:**
The developer diagnostics overlay (debug data panel) was rendered for all production users because `developerMode` was stored in local React state and defaulted to `true`.

**Resolution:**
Moved `developerMode` to Zustand store with `false` default. Wrapped diagnostics panel in `if (developerMode)` guard.

**OTA Published:** `46c2969e-1787-4cfd-a860-3fa0df18f1fa`

---

## INC-003 — Blocking Update Screen on Startup
**Date:** 2026-06-30
**Severity:** P1
**Duration:** Chronic (present since initial OTA update feature)

**Summary:**
Every app cold start showed a loading spinner ("Checking for updates...") while awaiting `Updates.checkForUpdateAsync()`. On slow networks, this blocked the user for 1-3 seconds before they could use the app.

**Resolution:**
Removed `isCheckingUpdate` state and blocking render. OTA check runs fully in `useEffect` background without blocking `AppNavigator`.

**OTA Published:** `a9b98ce0-fc5b-48ca-9cb3-9e1d10682d41`

---

## INC-004 — Startup Chat Scroll Jump
**Date:** 2026-06-30
**Severity:** P0
**Duration:** ~2 hours

**Summary:**
When opening the app, the chat screen natively rendered from the oldest message (index 0) and then visually scrolled to the bottom (newest message), creating an unacceptable visual flash and animation.

**Root Cause:**
FlatList was relying on `scrollToEnd()` which fires asynchronously after initial layout, causing the user to see the initial top-of-list render before the scroll repositioned the viewport.

**Resolution:**
Re-engineered the FlatList to use `inverted={true}`. The data array was reversed (`[...messages].reverse()`) so the newest message sits at index 0. This allows the FlatList to natively render the newest message at the bottom of the viewport with zero scroll logic and zero top-flash.

**OTA Published:** `26732af2-6900-441f-a523-62a2163eb618`
