# App Startup Flow Analysis

## 1. App Launch
- **Action:** OS starts the React Native process. JavaScript bundle is parsed and executed.
- **Components:** `App.tsx` initializes `<SafeAreaProvider>`, `<ThemeProvider>`, and `<AppNavigator>`.
- **Background Processes:** `Updates.checkForUpdateAsync()` runs in the background.

## 2. Auth Hydrate
- **Action:** `AppNavigator` checks authentication state.
- **Process:** Reads token from `SecureStore` / `AsyncStorage` (or backend).
- **Blocking:** User is blocked at the Splash Screen or a loading view until auth state is resolved.
- **Outcome:** Routes to `AuthNavigator` if unauthenticated, or `MainNavigator` if authenticated.

## 3. Chat Hydrate
- **Action:** User enters `ChatScreen`.
- **Process:** 
  1. `isHydrated` is false initially.
  2. Renders `<ActivityIndicator>`.
  3. `useEffect` in `ChatScreen` or `useChatStore` triggers `hydrateMessages()`.
  4. Makes network call to backend API to fetch chat history.
  5. Updates Zustand store with `messages`.
- **Blocking:** The Chat UI is blocked from rendering messages while fetching from the backend.

## 4. First Render
- **Action:** `messages` array is populated.
- **Process:**
  1. `<FlatList>` receives `messages` and computes layout.
  2. `inverted={true}` displays the latest messages at the bottom.
  3. Initial scroll position is set (no animation needed).
  4. Cells (via `renderItem`) render avatars, text bubbles, and timestamps.
- **Outcome:** The user can now view and interact with the chat interface.
