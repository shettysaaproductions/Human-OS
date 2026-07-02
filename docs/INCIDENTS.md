# INCIDENTS

## Open/Active Incidents
*None*

## Resolved Incidents
- **P0 - Broken SSE OTA Rollback (2026-07-01)**: The app reverted to the ancient embedded binary after an SSE OTA deployment. `react-native-sse` is a pure JS dependency with no native code, but `chatService.ts` used `const EventSource = require('react-native-sse').default;` which evaluated to `undefined` because the library exports using `module.exports = EventSource;`. During app initialization, the offline queue was processed by calling `streamMessage()`, which executed `new EventSource(...)`, throwing a fatal `TypeError: EventSource is not a constructor`. This synchronous crash during app startup triggered `expo-updates` to mark the OTA bundle as failed, forcing an automatic rollback to the embedded binary. Resolution: emergency rollback to known-stable OTA.
- **Startup scroll jump**: Fixed in previous session (2026-06-30). Chat startup scroll behaviors resolved.
