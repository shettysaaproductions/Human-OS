# AUTOMATED WORKFLOWS
# These are one-command triggers that run full sequences automatically

---

## Workflow 1: "ship" — Full Deploy Pipeline
Trigger: User types "ship" or "deploy"
git pull origin main
cd backend && npm run build
cd mobile && npx expo-doctor
git add . && git commit -m "ship: [date]"
git push origin main
Report: "Shipped. Reminder: Redeploy Render manually."

---

## Workflow 2: "health" — Full System Check
Trigger: User types "health" or "checkup"
cd backend && npm run build
cd mobile && npx expo-doctor
Check Supabase connection: curl health endpoint
Check Render status: report last deploy time
Check git status: report uncommitted changes
Report full summary to user

---

## Workflow 3: "docs" — Documentation Sync
Trigger: User types "docs" or "update docs"
Regenerate FILE_TREE.md
Update NOVA_ARCHITECTURE.md implementation phasing table
Update MEMORY.md with recent changes
Update UPDATE_DIARY.md with today's date
Update LEARNING_LOOP.md if patches were applied
git add . && git commit -m "docs: sync all project documentation"
git push origin main

---

## Workflow 4: "clean" — Repo Cleanup
Trigger: User types "clean"
git status → report uncommitted changes
git stash if needed (ask user first)
Delete node_modules in both mobile and backend
Reinstall: cd mobile && yarn install && cd ../backend && npm install
Run build checks
Report: cleanup complete

---

## Workflow 5: "nova upgrade" — Full Auto Upgrade
Trigger: User types "nova upgrade"
Run Protocol B from NOVA_AGENT_V2.md
This is the COMPLETE auto-upgrade: fetch → analyze → patch → build → push → OTA
Present full summary

---

## Workflow 6: "kimi sync" — Sync with Kimi
Trigger: User types "kimi sync"
Read KIMI_MEDIATOR.md
Check for new instructions from Kimi
Execute any pending instructions
Report results back

---

## Workflow 7: "fix notif" — Push Notification Repair
Trigger: User types "fix notif" or "notifications broken"
Run Protocol E from NOVA_AGENT_V2.md
Full diagnostic and auto-fix sequence
If auto-fix fails: report detailed logs to Kimi

---

## Workflow 8: "build apk" — Build New APK
Trigger: User types "build apk"
cd mobile && npx expo-doctor
If errors: fix them first
Trigger: eas build --platform android --profile apk
OR trigger GitHub Actions workflow
Report: Build started, check EAS dashboard for progress

---

## Workflow 9: "memory" — Memory System Check
Trigger: User types "memory" or "check memory"
Query Supabase: count rows in key tables
Check: profiles, chat_history, memories, working_memory, episodic_memories
Report: DB size estimate, table counts
If approaching 500MB: flag for pruning

---

## Workflow 10: "nace" — Consciousness Status
Trigger: User types "nace" or "consciousness"
Check nova_outreach_log: last proactive message sent
Check background_jobs: pending jobs queue
Check emotional_states: latest mood entry
Report: "Nova's last outreach was [X] mins ago. Mood: [Y]. Queue: [Z] jobs."

---

## ADDING NEW WORKFLOWS
To add a workflow:
1. Define trigger phrase
2. Define exact command sequence
3. Add to this file
4. Commit and push
5. Tell Kimi so he updates his mental model
