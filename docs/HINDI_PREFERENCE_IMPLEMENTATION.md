# Hindi Preference Implementation Plan

## Goal
Persistently remember and apply the user's preferred language (Hindi, English, or Auto) automatically across sessions. Include the preference in the system prompt for the AI.

## Files to Modify
1. `mobile/src/store/useSettingsStore.ts` (NEW or existing store for app settings)
2. `mobile/src/screens/SettingsScreen.tsx` (Add language selector toggle)
3. `mobile/App.tsx` (Ensure store hydration happens before or alongside AppNavigator)
4. `mobile/src/store/useChatStore.ts` (Read language preference to inject into backend calls if not handled completely by backend)
5. `backend/src/services/chatService.ts` (or equivalent backend prompt logic to read the user's language and inject `"Please respond in Hindi"` into the system prompt).

## Data Model
- **Local:** `language: 'en' | 'hi' | 'auto'` persisted in AsyncStorage (via Zustand's `persist` middleware in a dedicated settings store, NOT the chat store).
- **Remote (Optional):** Send `language` as metadata in the `chatService.sendMessage` payload or update it on the `users` table via a new endpoint `PUT /user/preferences`.

## Migration Plan
- Initial default is `'auto'` (or `'en'`).
- Existing users will experience no immediate change; they will default to `'auto'`. If the system locale is Hindi, it may adapt, otherwise English.
- No database column migrations are strictly required if we pass the language preference explicitly in each API call as a parameter.

## Rollback Plan
- Revert the system prompt injection in the backend API.
- If the app crashes due to Zustand persist errors, ship an OTA clearing the `@app_settings` key from AsyncStorage.

## Test Plan
- **Test 1:** Change language to "Hindi" in Settings. Restart app. Verify Settings still says "Hindi".
- **Test 2:** Send a message ("Hello"). Verify the AI responds in Hindi.
- **Test 3:** Change language to "English". Verify AI responds in English.
- **Test 4:** Close the app, reopen, and verify the settings are preserved and chat history remains unaffected.

## Risk Assessment
- **Risk Level:** Low
- **Concerns:** If we use `persist` in Zustand, we must ensure it doesn't conflict with other states. It's safer to isolate `language` into its own `useSettingsStore`. Modifying the LLM system prompt might slightly alter AI behavior or prompt adherence.
