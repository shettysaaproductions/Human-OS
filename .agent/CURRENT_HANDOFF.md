# CURRENT HANDOFF

## Last Updated
2026-09-04 — Production OTA automation and Settings/memory release handoff

## Session / Agent
Agent: ChatGPT-assisted repository maintenance with MonkeyCode as the single active coding agent.
Task: Publish/verify the approved Settings + existing memory-manager mobile fix through production EAS OTA and make deployment continuity durable across future AI/account/quota sessions.

## Status
READY_FOR_REVIEW

## Repository State
- Production branch: `main`.
- Approved code fix landed at `9d0052192e430d50f007e81efa632a4292dde390`.
- Follow-up deployment automation/docs commits were added after the approved code fix.
- Latest main includes `.github/workflows/mobile-ota-production.yml`, `DEPLOYMENT.md`, updated OTA scripts, and current continuity task/handoff.
- Main is production-sensitive. Do not rewrite/reset it.

## Confirmed Findings
- `SettingsScreen.tsx` previously navigated to `Brain -> Memories`, but `BrainNavigator.tsx` registers `Manage` for `MemoryManagementScreen`; the invalid route was a confirmed client bug.
- `MemoryManagementScreen.tsx` previously expected legacy snake_case fields while the canonical `/memories` API returns camelCase fields such as `canonicalKey`, `label`, `memoryType`, `isArchived`, `createdAt`, and `updatedAt`.
- The existing memory architecture is canonical and server-authoritative. Editing uses `PATCH /memories/:id`; no second memory store was introduced.
- Backend memory tests reported 35/35 PASS for canonical authority, edit/supersession, archive/unarchive, forget/not-hard-delete, and exactly-one-CURRENT protections.
- Mobile TypeScript validation reported PASS.
- Real Android crash behavior was not verifiable in the previous MonkeyCode environment because Android SDK/emulator/adb/Java and runtime crash logs were unavailable. Physical-device verification remains required.

## Production OTA Configuration
- Android production EAS channel: `production`.
- EAS Update branch: `production`.
- Runtime policy: `appVersion`.
- Current app version/runtime target: `1.1.0`.
- Production EAS environment: `production`.
- Canonical command:
  `eas update --branch production --environment production --platform android --non-interactive`
- The `--environment production` flag is required for EAS Update on SDK 55+.
- `mobile/package.json` production update script now includes the production environment.

## Durable Deployment Automation
- `.github/workflows/mobile-ota-production.yml` publishes Android production OTA on `main` mobile changes and supports manual `workflow_dispatch`.
- The workflow requires the GitHub Actions repository secret `EXPO_TOKEN`.
- The token is intentionally NOT stored in Git, continuity files, or documentation.
- `DEPLOYMENT.md` is the canonical deployment runbook and tells future AI sessions exactly what to do without rediscovery.
- If `EXPO_TOKEN` is missing, the workflow must fail clearly. Do not ask for or commit a token in repository files and do not silently switch accounts.

## Current OTA Blocker
The first OTA attempt through MonkeyCode failed before publication because EAS was not authenticated and `EXPO_TOKEN` was absent. No update ID was created by that attempt.

## Important Release Note
The approved fix is already on `main`. Do not make another application-code change just to publish the OTA. Once the GitHub Actions `EXPO_TOKEN` secret is configured, use the existing production OTA workflow. If the workflow is not triggered by a later mobile commit, run it manually from GitHub Actions.

## Memory Invariants
Preserve all existing memory invariants: canonical-key authority, deterministic correctionTarget authority, user-turn-grounded correction values, semantic filtering, canonical-key enforcement, atomic supersession, exactly one CURRENT, provenance/order safety, stale-write protection, history preservation, no hard delete, and PII/forensic hygiene.

## DO NOT REDO
- Do not re-investigate the already-confirmed Settings route mismatch unless device evidence shows a different failure.
- Do not redesign memory or create a parallel memory store.
- Do not use MonkeyCode for broad repository exploration for this release.
- Do not rebuild the native APK unless the installed build is runtime-incompatible or native code/configuration changed.
- Do not put EXPO_TOKEN or any credential in Git.
- Do not switch Google/Expo accounts silently.
- Do not claim the Android crash is fixed until the physical device has received the OTA and the Settings destinations have been tested.

## NEXT ACTION
1. Configure the one-time GitHub Actions repository secret `EXPO_TOKEN` for the Expo account that owns the Human-OS EAS project.
2. Run `.github/workflows/mobile-ota-production.yml` manually once for the current release if the prior workflow attempts were blocked by the missing secret.
3. Confirm the workflow reports a successful Android EAS update on branch/channel `production`, runtime `1.1.0`, and record the exact update group ID and source commit.
4. On a compatible physical Android production build, force-close and reopen the app up to two times so Expo Updates can download/apply the update.
5. Test all relevant Settings destinations, especially Manage Nova's memories and the Shoot Dead modal.
6. In Memory Management, load/search/edit an existing memory, reopen the screen, and verify persistence without duplication.
7. Record device results here. If a hard crash remains, capture Android/Metro/Logcat evidence before any further code change.

## Safe To Continue?
YES — deployment/verification only.

## Checkpoint Information
APPROVED_CODE_COMMIT=9d0052192e430d50f007e81efa632a4292dde390
LATEST_DEPLOYMENT_DOC_COMMIT=39f0d0950fdff7964cdce8a1406c0dd065d2ae2e
LATEST_OTA_SCRIPT_COMMIT=db837150b9fd7b854c0ab2a06270726f5c61c3f0
CURRENT_TASK=PROD-OTA-MEMORY-SETTINGS
OTA_PUBLISHED=no
OTA_UPDATE_ID=none
OTA_BRANCH=production
OTA_CHANNEL=production
OTA_RUNTIME=1.1.0
DEVICE_VERIFIED=no
PRODUCTION_CHANGED=yes
CREDENTIALS_STORED_IN_REPO=no
