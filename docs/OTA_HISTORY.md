# OTA HISTORY

| Date | Release Version | Update ID | Branch | Status | Notes |
|------|-----------------|-----------|--------|--------|-------|
| 2026-07-01 | Fix: Messaging + Cold Start | 13d95d7f-d1f1-49b2-94cf-7c3dd6dc0f07 | production | STABLE | Fix duplicate msgs, stuck thinking, self-ping keep-alive. |
| 2026-07-01 | Phase 1 - Feel Alive | c3e9c7d1-59f8-4709-add6-f21a0d2a3645 | production | SUPERSEDED | Instant Chat Experience (SSE streaming). |
| 2026-07-01 | Emergency Recovery | 274e19f4-4540-41ab-8350-210dac324b9b | production | ROLLED BACK | Restore stable-v3-recovered production baseline. |
## [2b867ae3-30f4-423e-af2b-c63d8794336b] - 2026-06-30
- Fix language preference bug where the local mock LLM fallback ignored injected prompt instructions.
- Removed debug logs.

## [2c07bf51-fbd1-4edc-a324-26d88b3bede3] - 2026-06-30
