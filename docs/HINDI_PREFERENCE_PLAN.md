# Hindi Preference Plan

## Goal
Ensure the application persistently remembers and applies the user's preference for Hindi language across sessions.

## Data Model
- Add a `languagePreference` field to the user profile schema (e.g., `enum: ['en', 'hi']`).
- Default value: `'en'`.

## Storage Location
- **Local:** Store the preference in `AsyncStorage` (or MMKV) using a key like `@app_language_preference` to allow immediate UI localization on startup before network calls complete.
- **Remote:** Sync the preference to the backend user profile database (e.g., PostgreSQL `users` table) to maintain consistency across multiple devices.

## Migration Strategy
- Add the new column to the backend database schema.
- Upon next app launch, if a local preference exists but isn't synced, push it to the backend. If no local preference exists, default to English (or infer from device locale) and prompt the user if they'd prefer Hindi.

## Fallback Behavior
- If network sync fails, rely on the local `AsyncStorage` value.
- If no local value exists, fall back to the device's system language setting (if Hindi is detected, use it; otherwise default to English).
