# GEMINI TASK: OTA Recovery System — Step-Back & Safe Deploy

## Role
You are a DevOps/Senior Engineer for HumanOS.
Stack: Expo EAS, React Native, Express on Render.

## Goal
Build a robust OTA recovery system so that:
1. Any broken OTA can be instantly rolled back in one command
2. A recovery mode exists in the app for users stuck on a broken version
3. Deploys always have a verified stable fallback

## Current Stable Baseline
- OTA Group: `fd1565e0-f1d4-433d-b881-e73739e86aa8`
- Tag: `stable-v3-recovered`
- Features: startup, timestamps, date headers, scroll fix, language settings, developer mode

## Step 1: Create Recovery Script

Create file: `scripts/emergency-recovery.sh`

```bash
#!/bin/bash
# HumanOS Emergency OTA Recovery Script
# Usage: ./scripts/emergency-recovery.sh [optional-message]

STABLE_GROUP="fd1565e0-f1d4-433d-b881-e73739e86aa8"
MESSAGE="${1:-Emergency recovery to stable baseline}"

echo "🚨 EMERGENCY RECOVERY"
echo "Rolling back to stable OTA group: $STABLE_GROUP"
echo ""

cd mobile

eas update:republish \
  --group "$STABLE_GROUP" \
  --destination-branch production \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "✅ Recovery complete. Monitor the app for 5 minutes."
echo "   Users will receive the update on next app foreground."
```

Make it executable: `chmod +x scripts/emergency-recovery.sh`

## Step 2: Create Safe Deploy Script

Create file: `scripts/safe-deploy.sh`

```bash
#!/bin/bash
# HumanOS Safe OTA Deploy
# Deploys to canary first, waits for confirmation, then promotes to production
# Usage: ./scripts/safe-deploy.sh "Your update message"

MESSAGE="${1:-OTA update}"

echo "🚀 SAFE DEPLOY: $MESSAGE"
echo ""
echo "Step 1: Deploying to CANARY..."

cd mobile

eas update \
  --branch canary \
  --message "$MESSAGE (canary)" \
  --environment production \
  --non-interactive

echo ""
echo "✅ Canary deployed."
echo ""
echo "Test the app on a canary device."
echo "Press ENTER to promote to PRODUCTION, or Ctrl+C to abort."
read

echo "Step 2: Promoting to PRODUCTION..."

# Get the latest canary update group ID
CANARY_GROUP=$(eas update:list --branch canary --json --non-interactive | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'])" 2>/dev/null || echo "")

if [ -z "$CANARY_GROUP" ]; then
  echo "⚠️  Could not auto-detect canary group. Please run manually:"
  echo "eas update:republish --group <CANARY_GROUP_ID> --destination-branch production --message \"$MESSAGE\""
else
  eas update:republish \
    --group "$CANARY_GROUP" \
    --destination-branch production \
    --message "$MESSAGE" \
    --non-interactive
  echo "✅ Production deployed!"
fi
```

## Step 3: In-App Recovery Mode Detection

In `mobile/src/store/useAuthStore.ts`, add a recovery mode flag.

If the app detects a persistent crash state (e.g., 3+ failed chat requests),
show a "Recovery Mode" screen with options:
1. Clear cache and restart
2. Contact support

This is a future enhancement — document the pattern for now.

## Step 4: Update STABLE_TAGS.md

After every successful production deploy, update `docs/STABLE_TAGS.md`:

```markdown
# STABLE TAGS

## Current Production Baseline
- OTA Group: [NEW_GROUP_ID]
- Date: [DATE]
- Features: [LIST]
- Commit: [GIT_HASH]

## Emergency Recovery (Always Current)
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery"

## History
| Date | OTA Group | Features | Status |
|------|-----------|----------|--------|
| 2026-07-01 | cdbf1cf6-... | Auth fix, Phase 1 SSE | CURRENT |
| 2026-07-01 | c3e9c7d1-... | Phase 1 Feel Alive | SUPERSEDED |
| 2026-07-01 | fd1565e0-... | stable-v3-recovered | STABLE BASELINE |
```

## Verification
1. Run `./scripts/emergency-recovery.sh "Test recovery"` — should publish to production
2. Check EAS dashboard for new group ID
3. Confirm app on device updates within 60 seconds (foreground it)

## Post-Deploy Standard Process

Every deploy should follow this pattern:
```
1. Make changes
2. npx tsc --noEmit  ← ALWAYS
3. git commit + push
4. eas update --branch canary (test first)
5. eas update:republish --group <canary_id> --destination-branch production
6. Update STABLE_TAGS.md with new OTA ID
```
