# Known Issues List (Active)

This document tracks identified bugs, limitations, and workarounds.
**Last Updated: July 2026**

---

## P1 (CRITICAL — Fix Immediately)

(No active P1 issues at this time.)

---

## P2 (Moderate)

### 2. NACE Proactive Messages May Arrive as "Ghost Duplicates"
- **Symptom:** Occasionally a Nova proactive message appears twice in the chat.
- **Root Cause:** The `checkProactiveMessages()` function in `useChatStore.ts` can be triggered by both the AppState listener AND a notification tap listener simultaneously.
- **Workaround:** Both listeners call `checkProactiveMessages()` but there is an idempotency check in the outreach log. If it still occurs, add a client-side dedup using the `nova_outreach_log` ID.

### 3. OTA Updates Not Received by Test APK
- **Root Cause:** APK builds (`eas build --profile apk`) target the `production` EAS channel. Previous OTA pushes were made to the `production` branch — APK did not receive them.
- **Fix Applied:** All OTA updates must use `--branch preview` to reach the installed APK.
- **Correct Command:** `npx eas update --branch preview --message "..."`

---

## P3 (Minor / Cosmetic)

### 4. Mock Authentication in Development
- **Symptom:** Signup/Login fail locally with `Invalid API key`.
- **Workaround:** Use mock UUIDs in test drivers. Production requires valid `SUPABASE_ANON_KEY`.

### 5. PostgREST Schema Cache Desync After Migrations
- **Symptom:** API calls fail with `PGRST205` after running a new SQL migration.
- **Workaround:** In Supabase Dashboard → Project Settings → API → click "Reload schema cache". Or run: `NOTIFY pgrst, 'reload schema'`.

---

## Resolved Issues

| Issue | Resolution | Date |
|---|---|---|
| Messages getting stuck (yellow dot forever) | Fixed race condition — DB write now happens BEFORE 202 response | July 2026 |
| Nova using "Aap" (formal) | Added STRICT PRONOUN RULE to `promptBuilder.ts` final instructions | July 2026 |
| Nova echoing user's words | Added ANTI-ROBOT ECHO rule to `promptBuilder.ts` | July 2026 |
| Nova interrogating with questions every message | Added INTERROGATION rule to `promptBuilder.ts` | July 2026 |
| OTA popup never appearing | Fixed OTA branch from `production` to `preview` | July 2026 |
| `reminders.status` missing causing log spam | Applied migration `20260720000000_add_reminders_status.sql` | July 2026 |
| Time Hallucination near midnight | Addressed via better context awareness in auto upgrade | July 2026 |
| Repetition of exact phrases | Added ANTI-ROBOT REPETITION rule to `promptBuilder.ts` | July 2026 |
