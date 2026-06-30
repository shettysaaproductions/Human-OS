# Hindi Preference Results

## Files Changed
1. `mobile/src/store/useSettingsStore.ts` (NEW) - Created a persisted Zustand store to save language preference locally.
2. `mobile/src/screens/SettingsScreen.tsx` - Added a UI section for Language selection (Auto, English, Hindi).
3. `mobile/src/store/useChatStore.ts` - Reads the language preference from `useSettingsStore` and passes it to `chatService.sendMessage`.
4. `mobile/src/services/chatService.ts` - Added `language` parameter to the API payload.
5. `backend/src/routes/chat.ts` - Added `language` to `ChatSchema` and passed it into the system prompt builder.
6. `backend/src/services/promptBuilder.ts` - Injects strict rules for responding primarily in Hindi or English based on the preference.

## Migration Details
- Initial default is `'auto'`.
- Existing users will gracefully default to `'auto'` without any database schema changes required, as the state is managed entirely client-side via AsyncStorage and sent on-demand to the stateless LLM prompt.

## Risk Assessment
- **Risk Level:** VERY LOW.
- **Why:** The changes only add a new optional parameter to the prompt injection pipeline. It does not touch the existing `useChatStore.ts` hydration logic, `FlatList` configuration, chat history, or floating date headers.

## Test Plan
- Run `npx tsc --noEmit` to verify type safety.
- **Manual Verification:** Open settings, change to Hindi, restart app, send a message to verify the AI adopts the persona. Switch back to English, restart, verify English. Switch to Auto, verify default language behavior.
