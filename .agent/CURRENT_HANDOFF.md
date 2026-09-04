# CURRENT HANDOFF

## Last Updated
2026-09-04 — Restore @react-navigation/bottom-tabs production dependency

## Session / Agent
Agent: MonkeyCode
Task: Fix only the confirmed OTA Android bundling blocker. Do not publish an OTA.

## Current Task
FIX-OTA-BOTTOM-TABS: restore `@react-navigation/bottom-tabs` to `mobile/package.json` dependencies.

## Objective
Make `@react-navigation/bottom-tabs` resolvable for `BrainNavigator.tsx` during production OTA bundling. Do not change navigation architecture, memory, auth, Nova, backend, Settings, EAS config, or credentials. Do not publish an OTA.

## Status
FIXED locally on `main`; not pushed

## Repository State
- Current branch: `main`
- Starting HEAD: `778b6758cdd8cdf9f8ad75abac51a341fecdfec9`
- Approved application code remains `9d0052192e430d50f007e81efa632a4292dde390`
- `BrainNavigator.tsx` was not modified
- yarn.lock was already consistent and was not modified
- OTA was not published by this session

## Confirmed Findings
- Android OTA bundling failed: Unable to resolve module `@react-navigation/bottom-tabs` from `mobile/src/navigation/BrainNavigator.tsx`.
- `BrainNavigator.tsx` imports `createBottomTabNavigator` from `@react-navigation/bottom-tabs`.
- The package was previously in `devDependencies` at `^7.18.3` and was removed in `db83715`.
- `mobile/yarn.lock` already contains `@react-navigation/bottom-tabs@^7.18.3` resolved to `7.18.14`.
- Restoring the same range in `dependencies` makes package.json consistent with the existing lockfile.

## Root Cause
`@react-navigation/bottom-tabs` was missing from `mobile/package.json` dependencies, so Metro/EAS bundling could not resolve the BrainNavigator import.

## Decisions
- Restore `@react-navigation/bottom-tabs` to `dependencies` at `^7.18.3` (React Navigation 7.x / Expo 56).
- Do not change yarn.lock because it already has that range at `7.18.14`.
- Do not change `BrainNavigator.tsx`.
- Do not publish an OTA from this session.

## Implementation Completed
- Added `"@react-navigation/bottom-tabs": "^7.18.3"` to `mobile/package.json` dependencies.
- Confirmed `mobile/yarn.lock` already lists `@react-navigation/bottom-tabs@^7.18.3` version `7.18.14`.
- `git diff --check` PASS.
- Continuity validator run after this handoff update.

## Tests Added
None. Dependency-only change.

## Test Results
- yarn.lock contains `@react-navigation/bottom-tabs@^7.18.3` at `7.18.14`: PASS
- yarn.lock unchanged: PASS (already consistent)
- `git diff --check`: PASS
- Continuity validator: run after this handoff update
- `yarn install --frozen-lockfile` / `yarn tsc --noEmit`: not re-run in this stop/commit pass

## Known Failures
- This commit is local until it is pushed.
- Production OTA is still unpublished.
- Physical Android OTA receipt is still unverified.

## Unresolved Questions
None for the missing-module blocker.

## Important Invariants
- Preserve deterministic correctionTarget authority, user-turn-grounded correction values, semantic filtering, canonical-key enforcement, atomic supersession, exactly-one-CURRENT, provenance/order safety, stale-write protection, history preservation / no hard delete, and forensic/PII hygiene.
- Do not expose, create, replace, or modify credentials including EXPO_TOKEN.
- Do not publish an OTA from this session.

## DO NOT REDO
- Do not remove `@react-navigation/bottom-tabs` from production dependencies.
- Do not move it back to devDependencies.
- Do not rewrite BrainNavigator or navigation architecture for this bug.
- Do not run eas update or publish an OTA from this coding session.
- Do not modify memory, auth, Nova, backend, Settings, or EAS configuration.

## NEXT ACTION
Land this dependency-only commit on origin `main` so the production OTA workflow can bundle Android again. Do not publish OTA from a local agent session. After a successful Actions OTA, NEXT ACTION = physical Android OTA verification.

## Safe To Continue?
YES

## Checkpoint Information
CHECKPOINT_BRANCH=main
BASE_COMMIT=778b6758cdd8cdf9f8ad75abac51a341fecdfec9
CHECKPOINT_COMMIT=778b6758cdd8cdf9f8ad75abac51a341fecdfec9
APPROVED_CODE_COMMIT=9d0052192e430d50f007e81efa632a4292dde390
RELEVANT_FILES=mobile/package.json,.agent/CURRENT_HANDOFF.md
WORKING_TREE_STATE=dirty until this fix is committed
CHECKPOINT_PUSHED=no
MAIN_PUSHED=no
PRODUCTION_CHANGED=no
OTA_PUBLISHED=no
OTA_UPDATE_ID=none
OTA_BRANCH=production
OTA_CHANNEL=production
OTA_RUNTIME=1.1.0
DEVICE_VERIFIED=no
CREDENTIALS_STORED_IN_REPO=no
BOTTOM_TABS_VERSION=^7.18.3 resolved 7.18.14
