# Performance Investigation: Phase 1

## 1. Unnecessary Rerenders
- **Issue:** The `ChatScreen` and its `FlatList` items re-render excessively.
- **Root Cause:** The `messages` array is included in the dependency array for `renderItem` (via `useCallback`). This invalidates the memoization of all existing message cells every time a new message is appended. Additionally, `stickyDate` state updates on scroll trigger re-renders even when the date string hasn't changed.
- **Estimated Impact:** High (UI thread frame drops during typing or when receiving messages).
- **Difficulty:** Easy
- **Recommended Fix:** Extract item properties directly from the `item` argument in `renderItem` instead of closing over the `messages` array. Add bailout conditions to scroll handlers to only `setStickyDate` if the value has actually mutated.

## 2. Duplicate API Calls
- **Issue:** Analytics events (`trackEvent`) and redundant health checks fire individually.
- **Root Cause:** No debouncing or batching logic exists for outgoing telemetry endpoints or background sync events in the `useEffect` hooks.
- **Estimated Impact:** Low/Medium (Wastes battery and network resources; potential rate-limiting).
- **Difficulty:** Medium
- **Recommended Fix:** Implement a centralized event queue for telemetry that flushes every 10 seconds or when the app is backgrounded. 

## 3. Heavy AsyncStorage Reads
- **Issue:** Reading and writing stringified JSON objects for state persistence blocks the JS thread.
- **Root Cause:** Parsing large chunks of cached data (if stored monolithically) via `AsyncStorage.getItem` is blocking.
- **Estimated Impact:** Medium (Slight jank on startup when hydrating non-Zustand states).
- **Difficulty:** Medium
- **Recommended Fix:** Migrate to a faster key-value store like MMKV, or paginate/chunk the data stored in AsyncStorage to avoid massive `JSON.parse()` blocks.

## 4. FlatList Bottlenecks
- **Issue:** Slow initial paint and scroll performance with long message histories.
- **Root Cause:** Lack of aggressive `FlatList` optimization props. The date separator is also being computed inline on every render within `renderItem`.
- **Estimated Impact:** High (Directly affects perceived user performance).
- **Difficulty:** Easy
- **Recommended Fix:** Provide `initialNumToRender={15}`, `maxToRenderPerBatch={5}`, and `windowSize={10}`. Precompute date separators outside the render function.

## 5. Large Persisted State
- **Issue:** Unbounded chat history growth in memory and persistence.
- **Root Cause:** `hydrateMessages` loads the entire conversation into Zustand. Memory consumption grows linearly with the user's conversation length.
- **Estimated Impact:** Medium/High (Long-term alpha users will experience crashes or severe memory bloat).
- **Difficulty:** Hard
- **Recommended Fix:** Cap the in-memory `messages` array to the last 200 items. Implement bidirectional pagination to fetch older messages only when the user scrolls up.
