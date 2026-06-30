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
