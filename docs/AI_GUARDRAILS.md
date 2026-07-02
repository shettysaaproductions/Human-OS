# AI GUARDRAILS

Never:
- Force push main without approval.
- Delete migrations.
- Modify auth flow casually.
- Modify startup flow casually.
- Publish OTA with TS errors.

---

Before adding any package:

Determine:

JS-only?
or
Native dependency?

If native:

NO OTA until new binary exists.

Before publishing an OTA:
- Test all CommonJS imports (`require`) inside functions to ensure they don't evaluate to `undefined` (e.g., check if `.default` is needed).
- Verify that offline queue processors don't synchronously crash the app on startup.
- Deploy to a Canary branch before publishing to the production group.
