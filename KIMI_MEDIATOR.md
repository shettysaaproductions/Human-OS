# KIMI MEDIATOR PROTOCOL
# Last Updated: 2026-08-01
# Purpose: Zero-friction communication between Kimi (planning/architecture) and Anti-Gravity (execution)

## HOW THIS WORKS

### Kimi's Role (External AI — Free, No Limits)
- Reads entire codebase from GitHub public repo
- Analyzes architecture, spots bugs, designs features
- Writes instructions into this file
- NEVER edits code directly — only plans and instructs

### Anti-Gravity's Role (IDE Agent — Gemini 3.6 Flash)
- Reads this file at the start of every session
- Executes all code changes, runs commands, commits, pushes
- Reports execution results back to Kimi via the user
- NEVER makes architectural decisions without checking this file

### User's Role (You)
- Copy-paste SHORT messages between the two
- Manually deploy Render and trigger EAS builds
- Test the app on your phone

---

## CURRENT STATUS BOARD
# Update this section after every action

## Active Task: Push Notification Fix
- [x] App.tsx navigationRef passed to AppNavigator
- [x] AppNavigator.tsx accepts and binds navigationRef
- [x] notificationService.ts uses _ensureAndroidChannels in initialize()
- [x] Backend push payloads have contentAvailable + android.priority high
- [x] GitHub Actions workflow fixed for EAS cloud build
- [x] google-services.json restored and converted to clean UTF-8
- [x] Backend redeployed to Render
- [x] Reverted navigationRef binding from AppNavigator / NavigationContainer for crash isolation test
- [x] EAS build succeeded (Build fa8dbbfe-7d41-49dc-9f82-8fd54cb6d2fb)
- [ ] APK tested on device for login success (APK Download: https://expo.dev/artifacts/eas/j2aMv2xH671z-65E7S7zFhL2o99bWp5Z67u.apk)

## Next Tasks (Queue)
1. Test push notifications / login with new APK
2. If working: Close P1 push notification issue
3. If NOT working: Debug FCM/Expo push token registration
4. Upgrade AGENTS.md with automated protocols
5. Implement NovaCognitionOrchestrator (P1 from IMPLEMENTATION_QUEUE)
6. Implement NACE Agenda Builder (P2)
7. Implement Memory Time Capsule (P2)

---

## KIMI'S LATEST INSTRUCTIONS
# Kimi updates this section. Anti-Gravity reads it and executes.

### Instruction #1: Create This File
Create KIMI_MEDIATOR.md at repo root with this exact content. Commit and push.

### Instruction #2: Create NOVA_AGENT_V2.md
See File 2 below. Create it in .agents/ folder. This upgrades the existing agent.

### Instruction #3: Create AUTOMATED_WORKFLOWS.md
See File 3 below. Create it in .agents/ folder. This automates repetitive tasks.

---

## REPORTING FORMAT (Anti-Gravity → Kimi)
When reporting back, use this format:
TASK: [name]
STATUS: [done / blocked / in-progress]
FILES CHANGED: [list]
COMMIT: [hash]
BLOCKERS: [if any]
NEXT ACTION NEEDED: [from Kimi or user]

---

## EMERGENCY PROTOCOLS

### If Kimi is offline
Anti-Gravity can execute these WITHOUT waiting:
- Bug fixes that don't change architecture
- Dependency updates (npx expo install --fix)
- Running expo-doctor and fixing its warnings
- Git commits with clear messages
- Building and pushing to GitHub

### If Anti-Gravity hits a limit
- Pause execution
- Report the exact error message to user
- User forwards to Kimi
- Kimi provides fix, user pastes back

### If GitHub is out of sync
Always run before starting work:
git pull origin main

If conflicts: report to user immediately. Do NOT auto-resolve.
