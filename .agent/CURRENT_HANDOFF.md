# CURRENT HANDOFF

## Last Updated
2026-09-13 — v0.3.8-beta: Google Maps Neural Navigation, Progressive LOD Labels, Zoom Gestures & Lifestyle Intelligence

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Task: COMPLETE — Hardened mobile 2D/3D neural galaxy, fixed zoom lock, implemented map-style LOD labels, Google Maps department navigation, and upgraded companion lifestyle intelligence:

1. **2D & 3D Neural Galaxy Zoom Lock Root Cause & Fix**:
   - **Root Cause**: `hasUserInteractedRef.current` was never set to `true` during gestures or zoom button taps. The 5-second background sync poll (`fetchGraph(true)`) checked `if (!hasUserInteractedRef.current)` and continuously forced `scale.value = fitScale` (0.17), killing user zoom.
   - **Gesture Conflicts**: `panGesture` lacked `.maxPointers(1)`, causing simultaneous conflict with `pinchGesture` on 2-finger touches.
   - **Fix**: Added `markInteracted` callback invoked on `pinchGesture.onBegin`, `panGesture.onBegin`, `twoFingerPanGesture.onBegin`, `rotationGesture.onBegin`, and zoom buttons. Constrained `panGesture` to `maxPointers(1)`. Guarded `fetchGraph` auto-fit so it only runs on initial mount (`!isBackground && nodes.length === 0`).

2. **Progressive Semantic Level of Detail (LOD) Labels**:
   - Implemented dynamic label visibility based on camera zoom scale:
     - `scale < 0.28`: Only main department trunks (`hierarchyLevel === 1`) and `user-core` display labels.
     - `0.28 <= scale < 0.48`: Entity branches (`hierarchyLevel === 2`) emerge.
     - `scale >= 0.48`: All micro-branches and leaf attribute stems become visible.
     - Selected nodes and 1-hop connected neighbors always display labels at any zoom level.
   - Leader lines and nameplates cleanly toggle with `showLabel`.

3. **Google Maps Fly-To Department Navigation**:
   - Fixed camera jump where `handleFocusDept` previously used screen deltas from old zoom to animate to new zoom, throwing nodes 600px offscreen.
   - Implemented `navigateToNode(node, targetScale)` using exact inverse projection math for both 2D and 3D perspectives.
   - Department chips now smoothly fly the camera right onto the hub at 0.62 zoom with cubic easing.
   - Tapping "✨ All Galaxy" resets filters and smoothly glides back to full panoramic view.

4. **Companion Lifestyle Intelligence & Action Routing**:
   - Added `FESTIVAL_SIGNALS` (Ganpati, Diwali, Eid, Navratri, Pooja, fasting, rituals).
   - Added `SOLITARY_SIGNALS` (home alone, akela hu, quiet me-time companioning).
   - Added `FAMILY_CARE_SIGNALS` (parents, child caregiving, family dinner).
   - Routed `extractCriticalAction` in `NovaBrainService.ts` through `cognitiveRouter.complete('ACTION_INTELLIGENCE', ...)` with Gemini 3.8 Flash failover.

## OTA Deployment & Notification Protocol
- **Version**: `v0.3.8-beta`
- **Changelog**: Updated index 0 of `mobile/src/config/updateHistory.json`.
- **Pre-flight**: `mobile/npx tsc --noEmit` (exit 0), `backend/npm run build` (exit 0).
- **EAS Update Group ID**: `bdf355a0-a2c8-46ac-8711-346e37b53ab7`
- **Android Update ID**: `01a09bef-e4a5-7744-89dd-425e2266bbfd`
- **iOS Update ID**: `01a09bef-e4a5-710c-87b4-96193dc6d678`
- **Broadcast Push Notification**: Successfully dispatched to all registered user devices via `broadcast_update_push.ts`.

## NEXT ACTION
Commit and push changes to `origin main` (triggers automatic Render backend build & deploy).
