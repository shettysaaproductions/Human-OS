# HumanOS — OTA Update History
> Last Updated: 2026-06-30

| # | OTA Group ID | Branch | Message | Platform | Date | Status |
|---|---|---|---|---|---|---|
| 1 | `46c2969e-1787-4cfd-a860-3fa0df18f1fa` | production | Restore timestamps + floating date header + multiple message sending | iOS + Android | 2026-06-30 | ✅ Live |
| 2 | `a9b98ce0-fc5b-48ca-9cb3-9e1d10682d41` | production | Remove blocking update screen - background OTA check | iOS + Android | 2026-06-30 | ✅ Live |

---

## Rollback Guide

To roll back to any previous OTA:

```bash
eas update --branch production --message "rollback: <reason>"
# Then restore files from the relevant commit and re-publish
```

The production baseline commit is `c2c0fd0`. Any rollback should be based from this commit unless a safer baseline is established.
