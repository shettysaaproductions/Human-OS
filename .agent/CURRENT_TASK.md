# CURRENT TASK

## Task ID
BACKEND-CHAT-IMPACT-PHASE2-COMPANION-INTELLIGENCE

## Objective
Fix critical, high-impact backend chat bugs: standalone photo validation crash, destructive 3+ item list nuking (workout plans, study steps, recipes, ideas), programming code block deletion, blanket `>` blockquote/inequality stripping, FALLBACK_REPLY reject leak, Hinglish concept memory amnesia, assistant quote header pollution, and emoji injection into code/tables.

## Scope
- Keep `main` as the production source of truth.
- Update `ChatMessageSchema` and `ChatSchema` in `chat.ts` to allow standalone images without text without throwing validation errors.
- Refine code block sanitizer in `chat.ts` to strip leaked subconscious tool JSON while preserving genuine programming language code blocks (Python, JS, SQL, Bash, HTML).
- Fix line sanitizer in `chat.ts` to preserve markdown blockquotes (`>`) and mathematical inequalities (`>`).
- Remove `FALLBACK_REPLY` from `REJECT_PREFIXES` in `chat.ts` so timeouts result in clean user bubbles rather than orphaned turns.
- Expand `extractKeywords` in `nlp.ts` with `CONCEPT_SYNONYM_EXPANSIONS` so Hinglish relationship/activity terms (biwi, beta, maa, naukri, kasrat) map to canonical English database memory keys.
- Prevent assistant messages in `chat.ts` from cluttering history with repeated quote headers.
- Protect code blocks, tables, and URLs in `MessageFormatter.ts` from emoji injection.
- Pass all verification gates: `cd backend && npm run build` (exit 0), `cd mobile && npx tsc --noEmit` (exit 0), and 30/30 unit tests passing.

## Approved Code
All changes pass `cd backend && npm run build` (code 0), `cd mobile && npx tsc --noEmit` (code 0), and all unit tests (code 0).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.


