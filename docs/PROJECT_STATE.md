# PROJECT STATE

Current Version:
`v0.2.0-beta`

Current Stable Tag:
`stable-v3-recovered`

Latest OTA:
`fd1565e0-f1d4-433d-b881-e73739e86aa8`

Current Branch:
`feature-performance-phase1`

Release Status:
PRODUCTION STABLE (Beta)

Open Bugs:
- None

Current Sprint:
Play Store Preparation

Blockers:
- None

Production Risk:
LOW

## Emergency Recovery Command

If any future OTA breaks production, run:

```bash
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery to stable-v3-recovered"
```
