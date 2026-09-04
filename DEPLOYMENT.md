# Human-OS Deployment Runbook

This is the canonical deployment handoff for every AI session and developer. Do not ask the user to rediscover the mobile OTA process from scratch.

## Production architecture

- GitHub `main` is the source of truth.
- Render backend deployment is triggered by pushes to `main` through the existing Render deploy workflow.
- Android production builds use the EAS `production` channel.
- EAS Update publishes JavaScript/assets to the `production` branch/channel for compatible installed runtimes.
- Current mobile runtime policy is `appVersion`; current app version is `1.1.0`.

## One-time authentication setup

The repository must NEVER contain an Expo/EAS access token.

Configure exactly one GitHub Actions repository secret:

`EXPO_TOKEN`

Create it from the Expo account that owns this Human-OS EAS project, then add it under:

GitHub repository → Settings → Secrets and variables → Actions → Repository secrets

The workflow `.github/workflows/mobile-ota-production.yml` consumes this secret. It does not write or print the token.

If the secret is missing, the OTA workflow must fail clearly rather than asking an AI session to log in with a different Google account or changing project configuration.

## Automatic production OTA

After `EXPO_TOKEN` is configured, any push to `main` that changes `mobile/**` automatically publishes an Android production OTA.

The workflow uses:

```bash
eas update --branch production --environment production --platform android --non-interactive
```

The `--environment production` flag is required for EAS Update with SDK 55+ and ensures the production EAS environment is used.

## Manual production OTA

If a mobile change is already on `main` and the automatic workflow did not run, use GitHub Actions → **Publish Production Mobile OTA** → **Run workflow**.

Do not create a new APK merely because an OTA was not published. First fix EAS authentication/workflow configuration.

## Release order

1. Review and approve the code.
2. Merge/fast-forward approved code to `main`.
3. Confirm Render backend deployment is triggered for backend changes.
4. Let the production mobile OTA workflow publish the compatible Android update.
5. Verify the EAS update group, production branch/channel, platform, runtime version, and source commit.
6. On a physical Android production build, force-close and reopen the app to download/apply the update; if needed, repeat the close/reopen cycle once.
7. Test the changed mobile behavior on-device.

## Runtime compatibility rule

Do not publish a JavaScript OTA to an incompatible native runtime. The installed Android build and the EAS update must share the same runtime version.

If native dependencies or native app configuration change, stop and review whether a new native build and runtime-version change are required.

## Current release context

Approved Settings/memory fix currently landed on `main` at commit:

`9d0052192e430d50f007e81efa632a4292dde390`

The fix:

- changes Settings memory navigation from the nonexistent `Memories` route to the registered `Manage` route;
- aligns the memory manager with canonical backend fields;
- preserves the existing canonical memory API and `PATCH /memories/:id` edit flow;
- does not create a second memory store or replace existing memory architecture.

Real Android crash resolution remains a device-level verification item until tested on a physical compatible build.

## Security rules

- Never commit `EXPO_TOKEN`, EAS credentials, private keys, or passwords.
- Never paste a token into continuity/handoff files.
- AI sessions should read this file and the continuity handoff before asking the user for deployment information.
- If authentication is missing, report `EXPO_TOKEN` missing and stop; do not guess, fabricate, or switch accounts silently.
