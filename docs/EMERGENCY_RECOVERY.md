# EMERGENCY RECOVERY

If app black screens:
1. Find last stable tag.
2. Republish last stable OTA.

Command:
`eas update --branch production --republish <update-id>`

If startup deadlocks:
- Verify `isHydrated`.
- Verify auth loading.

If OTA not received:
- Verify runtime.
- Verify branch.
- Verify update id.
