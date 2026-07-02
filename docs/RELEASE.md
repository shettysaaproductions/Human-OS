# RELEASES

Current Stable:
`stable-v3-recovered`

Play Store Candidate:
`v0.2.0-beta`

Known Bugs:
- None

Blocked By:
- Privacy Policy
- Crash DSN

## Emergency Recovery Command

If any future OTA breaks production:

```bash
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery to stable-v3-recovered"
```
