# HumanOS — Gemini Implementation Plans

This folder contains **ready-to-paste prompts** for Google Gemini Pro/Flash.
Each file is a self-contained implementation task.

## How To Use

1. Open Google Gemini (gemini.google.com) or your AI IDE
2. Open the relevant `.md` file below
3. Copy the **entire file** and paste it as your prompt
4. Gemini will produce code changes
5. Apply the changes, run `npx tsc --noEmit`, then push
6. Deploy with: `eas update --branch production --message "..." --environment production --non-interactive`
7. If something breaks: run the **Emergency Recovery** command at the bottom of each plan

## Plans Index (Execute In Order)

| # | File | Priority | Effort | Status |
|---|------|----------|--------|--------|
| 01 | [01_MEMORY_CAP_20_MESSAGES.md](./01_MEMORY_CAP_20_MESSAGES.md) | 🔴 P0 | 1 hour | TODO |
| 02 | [02_SPLIT_LONG_REPLIES.md](./02_SPLIT_LONG_REPLIES.md) | 🔴 P0 | 2 hours | TODO |
| 03 | [03_MEMORY_V2_SUMMARIES.md](./03_MEMORY_V2_SUMMARIES.md) | 🟠 P1 | 4 hours | TODO |
| 04 | [04_IDEMPOTENCY_KEYS.md](./04_IDEMPOTENCY_KEYS.md) | 🟠 P1 | 2 hours | TODO |
| 05 | [05_NOVA_PERSONALITY_SYSTEM.md](./05_NOVA_PERSONALITY_SYSTEM.md) | 🟡 P2 | 3 hours | TODO |
| 06 | [06_PUSH_NOTIFICATIONS.md](./06_PUSH_NOTIFICATIONS.md) | 🟡 P2 | 6 hours | TODO |
| 07 | [07_RELATIONSHIP_DASHBOARD.md](./07_RELATIONSHIP_DASHBOARD.md) | 🟢 P3 | 8 hours | TODO |

## Emergency Recovery

If any OTA breaks the app, run immediately:

```bash
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery to stable-v3-recovered"
```

## Current Production State

- **OTA Branch:** production
- **Runtime Version:** 1.0.0
- **Backend:** https://human-os-zitw.onrender.com
- **Stable Tag:** stable-v3-recovered
- **Stack:** React Native (Expo) + Express + Supabase + NVIDIA NIM
