# HumanOS — Current Baseline
> Last Updated: 2026-06-30

## Production Branch: `feature-recover-ui`
## Production Baseline Commit: `c2c0fd0`

---

## Active OTA Updates (Production)

| OTA Group ID | Message | Date |
|---|---|---|
| a9b98ce0-fc5b-48ca-9cb3-9e1d10682d41 | Remove blocking update screen - background OTA check | 2026-06-30 |
| 46c2969e-1787-4cfd-a860-3fa0df18f1fa | Restore timestamps + floating date header + multiple message sending | 2026-06-30 |

---

## Feature Status

| Feature | Status |
|---|---|
| Chat with Nova (AI) | ✅ Working |
| Chat history (backend sync) | ✅ Working |
| Pagination (older messages) | ✅ Working |
| Timestamps on messages | ✅ Working |
| Floating date separator | ✅ Working |
| Multiple message queuing | ✅ Working |
| Startup scroll jump fix | ✅ Fixed |
| Developer diagnostics overlay | ✅ Dev-mode only |
| OTA update (background, non-blocking) | ✅ Working |
| Changelog popup | ✅ Working |
| Dark/Light theme | ✅ Working |
| Settings screen | ✅ Working |
| Onboarding flow | ✅ Working |
| Auth (login/signup) | ✅ Working |

---

## Known Good State
- No blocking update screen on startup.
- Chat opens directly to latest message.
- Old history visible after force-close and reopen.
- Developer diagnostics only visible when `developerMode = true` in Settings.
