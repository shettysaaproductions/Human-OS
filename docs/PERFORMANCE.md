# Performance Audit

## 1. App Startup Time
- **Issue:** Hydration of messages blocks immediate interactivity; wait for SQLite/backend sync.
- **Impact:** High (1-3 seconds blank list/spinner on cold start).
- **Proposed Fix:** Implement skeleton loading state during `isHydrated === false`. Preload last 50 messages from AsyncStorage synchronously before fetching full history from backend.
- **Priority:** P1

## 2. Unnecessary Rerenders
- **Issue:** `messages.length` in dependency arrays for `renderItem` and `useEffect`s. `setStickyDate` triggers parent re-render frequently.
- **Impact:** Moderate (React overhead on every message sent/received).
- **Proposed Fix:** Use ref for `messages` in `renderItem` closure or rely solely on `item` props. Add bailout condition to `setStickyDate`.
- **Priority:** P1

## 3. FlatList Optimizations
- **Issue:** `maxToRenderPerBatch` and `initialNumToRender` are default. Date separator is computed inside `renderItem` dynamically.
- **Impact:** High (Dropping frames during fast scrolling).
- **Proposed Fix:** Set `initialNumToRender={15}`, `maxToRenderPerBatch={5}`. Pre-compute date separators in the state/store.
- **Priority:** P1

## 4. AsyncStorage Size
- **Issue:** Storing full conversation history in JSON string.
- **Impact:** Low right now, but will degrade serialization time as chat history grows >10,000 messages.
- **Proposed Fix:** Cap AsyncStorage storage to the most recent 500 messages. Older history remains on the backend.
- **Priority:** P2

## 5. Image Loading
- **Issue:** Avatar and UI elements do not use aggressively cached image libraries.
- **Impact:** Low (currently text-based or minimal SVG).
- **Proposed Fix:** Introduce `expo-image` if complex image assets or user uploads are added.
- **Priority:** P3

## 6. Network Calls
- **Issue:** Telemetry (`trackEvent`) fires individual unbatched POST requests.
- **Impact:** Low (but wastes radio wakeups).
- **Proposed Fix:** Batch telemetry events client-side and flush every 10 seconds or on backgrounding.
- **Priority:** P2

## 7. Bundle Size
- **Issue:** Unused packages or large dependencies might be bundled.
- **Impact:** Moderate (slower initial download).
- **Proposed Fix:** Audit `package.json`. Use `react-native-bundle-visualizer` to remove bloat.
- **Priority:** P2
