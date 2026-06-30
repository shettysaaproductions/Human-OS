# HumanOS — Known Bugs
> Last Updated: 2026-06-30

---

## Active Bugs

| ID | Priority | Status | Description | File |
|---|---|---|---|---|
| BUG-001 | P0 | ✅ FIXED | Chat startup scroll jump — user saw first message first, then animation to bottom | ChatScreen.tsx |
| BUG-002 | P0 | ✅ FIXED | Dev diagnostics overlay visible to all production users | ChatScreen.tsx |
| BUG-003 | P1 | ✅ FIXED | Blocking "Checking for updates..." screen blocked app startup for 1-3 seconds | App.tsx |
| BUG-004 | P2 | 🔴 OPEN | Unbounded message history in memory — risk for long-term users | useChatStore.ts |
| BUG-005 | P2 | 🔴 OPEN | renderItem closes over `messages` array — all cells re-render on new message | ChatScreen.tsx |
| BUG-006 | P2 | 🔴 OPEN | Date separator computation inside renderItem — expensive for large histories | ChatScreen.tsx |
| BUG-007 | P2 | 🔴 OPEN | Telemetry `trackEvent` fires individually per event, no batching | ChatScreen.tsx |

---

## Resolved Bugs

| ID | Resolution | OTA |
|---|---|---|
| BUG-001 | Non-animated scrollToEnd on first content size change + overlay render gate | 46c2969e |
| BUG-002 | Moved developerMode to Zustand store; wrapped diagnostics in guard | 46c2969e |
| BUG-003 | Removed blocking state; OTA check runs fully in background | a9b98ce0 |
