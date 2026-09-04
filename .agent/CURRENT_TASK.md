# CURRENT TASK

## Task ID
PROD-OTA-MEMORY-SETTINGS

## Objective
Publish and verify the approved Human-OS Settings/memory mobile fix through the existing production EAS OTA path, with durable deployment instructions so future AI sessions and account/quota switches do not need to rediscover the process.

## Scope
- Keep `main` as the production source of truth.
- Publish Android JavaScript/assets to the EAS `production` branch/channel.
- Preserve the existing Expo/EAS runtime configuration and canonical memory architecture.
- Maintain a repository-level deployment runbook and automated GitHub Actions OTA workflow.
- Verify the update on a compatible physical Android production build after publication.

## Non-Goals
- Do not create a new memory system/store.
- Do not modify unrelated auth, reminders, language, rate-limit, Nova-engine, or backend behavior.
- Do not rebuild the native APK unless runtime incompatibility or a native change makes an OTA impossible.
- Do not store Expo/EAS credentials in Git.
- Do not silently switch Expo/Google accounts to work around authentication.

## Approved Code
Current approved mobile fix is on `main` at or after:
`9d0052192e430d50f007e81efa632a4292dde390`

The fix changes the invalid Settings `Brain -> Memories` navigation to the registered `Brain -> Manage` route and aligns the memory manager with the canonical backend API while preserving `PATCH /memories/:id` editing.

## OTA Configuration
- Android production channel: `production`
- EAS Update branch: `production`
- Runtime policy: `appVersion`
- Current app version/runtime target: `1.1.0`
- Production EAS environment: `production`
- Canonical manual command:
  `eas update --branch production --environment production --platform android`
- Canonical workflow: `.github/workflows/mobile-ota-production.yml`
- Canonical deployment instructions: `DEPLOYMENT.md`

## Authentication Rule
GitHub Actions requires a repository secret named `EXPO_TOKEN`. The token must never be committed to the repository or written into continuity files. If it is missing, the workflow must stop with a clear error. Future AI sessions must read `DEPLOYMENT.md` instead of asking the user to rediscover the deployment procedure.

## Acceptance Criteria
1. `main` contains the approved mobile fix.
2. Production OTA is published successfully to EAS `production` for Android runtime `1.1.0`.
3. The published update reports the correct source commit.
4. Physical Android production build receives and applies the update.
5. Settings memory management opens without the invalid-route crash.
6. Existing memories load and search safely.
7. Editing an existing memory persists through the canonical `PATCH /memories/:id` flow without creating a duplicate.
8. Archive/forget behavior remains history-preserving.
9. No native build is created unless required by runtime compatibility.
10. Handoff records the exact update ID, runtime, branch/channel, source commit, test result, and next action.

## Continuity
Every new AI session must read `SESSION_BOOT.md`, `.agent/CURRENT_HANDOFF.md`, this file, and `DEPLOYMENT.md` before performing deployment work. Use `CONTINUE HUMAN-OS` and continue only from `## NEXT ACTION`.
