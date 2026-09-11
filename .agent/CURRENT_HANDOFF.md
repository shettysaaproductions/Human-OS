# CURRENT HANDOFF

## Last Updated
2026-09-11 — Backend Chat Section Architecture Phase 2: Standalone Image Ingress, Plan/List Preservation, Programming Code Fences, Blockquote Restorations & Hinglish Memory Expansion

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Task: Fix critical back-end bugs in the chat section: standalone photo validation crash, destructive 3+ item list nuking (workout plans, study steps, recipes, ideas), programming code block deletion, blanket `>` blockquote/inequality stripping, FALLBACK_REPLY reject leak, Hinglish concept memory amnesia, assistant quote header pollution, and emoji injection into code/tables.

## Confirmed Findings & Root Cause Analysis
1. **Standalone Photo Ingress Validation Crash (`chat.ts`):**
   - `ChatMessageSchema` enforced `message: z.string().min(1)` and `ChatSchema` required `data.message || data.messages.length > 0`.
   - Sending an image without typing text threw `400 ValidationError: Either 'message' or 'messages' must be provided`.
2. **Destructive 3+ Item List Nuking (`NovaBrainService.ts`):**
   - `sanitizeReply` contained `if (menuLineCount >= 3) text = firstSentenceMatch ? firstSentenceMatch[0] : text.split('\n')[0];`.
   - Any reply containing 3 or more numbered or bulleted items (workout plans, study revision steps, recipes, packing lists, brainstorming ideas) had everything after the first sentence deleted!
3. **Blanket Destruction of Programming Code Blocks (`chat.ts`):**
   - Line 554 replaced all ````[a-z]* ```` blocks with empty strings. Legitimate code blocks (Python, JS, SQL, Bash, HTML) for students and engineers were erased before reaching the client.
4. **Blanket Destruction of `>` Characters (`chat.ts`):**
   - Line 574 did a global `.replace(/>/g, '')`, destroying markdown blockquotes (`> Note`), mathematical inequalities (`Protein > 150g`, `Calories < 2000`, `Score > 90`), and arrows (`->`).
5. **`FALLBACK_REPLY` Rejection Bug (`chat.ts`):**
   - Line 1914 added `'Hmm... mujhe thoda sochne de'` to `REJECT_PREFIXES`, causing `FALLBACK_REPLY` to be discarded on timeout in non-async mode and leaving user messages completely unanswered.
6. **Hinglish Concept Memory Amnesia (`nlp.ts`):**
   - `extractKeywords` only extracted raw words. Natural Hinglish terms (biwi, beta, maa, naukri, kasrat) did not match English canonical database keys (`wife_birthday`, `son_name`, `mother_name`, `job`, `workout`), causing 0 search results.
7. **Assistant Messages Redundant Quoted Header UI Bug (`chat.ts`):**
   - Line 2047 set `reply_to_content: primaryMessage.substring(0, 100)` on assistant rows, forcing a quote header on every single assistant bubble.
8. **Emoji Injection into Code Blocks, Tables, and URLs (`MessageFormatter.ts`):**
   - `addEmoji` injected emojis into `?` and `!` even inside code fences, markdown tables, or URLs with query parameters.

## Implemented Fixes
1. **Standalone Photo Ingress Support (`chat.ts`):**
   - `ChatMessageSchema` and `ChatSchema` now allow optional/empty message when `image_base64` is provided. Standalone photos (workout meals, homework, pets) process cleanly.
2. **List & Plan Preservation (`NovaBrainService.ts`):**
   - Replaced destructive 3+ item truncation with specific multiple-choice quiz option stripping (`^[A-D][.)]\s+[^\n]*`), ensuring workout routines, study steps, recipes, and ideas are preserved in full.
3. **Safe Code Block Sanitization (`chat.ts`):**
   - Targeted only leaked subconscious action JSON blocks (`/```(?:json|thought|internal|action)?\s*\{[\s\S]*?"(?:subconscious_actions|action|tool)"[\s\S]*?\}(?:```|$)/gi`), preserving real programming languages.
4. **Blockquote & Inequality Preservation (`chat.ts`):**
   - Replaced blanket `>` replacement with proper HTML tag stripping (`/<[a-zA-Z\/][^>]*>/g` and `/<[a-zA-Z\/][^>]*$/g`), preserving `> Tip`, `x > 5`, and `->`.
5. **`FALLBACK_REPLY` Restoration (`chat.ts`):**
   - Removed `'Hmm... mujhe thoda sochne de'` from `REJECT_PREFIXES`, guaranteeing clean safety-net bubbles on provider timeouts.
6. **Hinglish-to-English Concept Expansion (`nlp.ts`):**
   - Added `CONCEPT_SYNONYM_EXPANSIONS` mapping terms to canonical English keys (biwi -> wife, beta -> son/child, maa -> mother, naukri -> job/work, kasrat -> workout/gym, janamdin -> birthday).
7. **Clean Assistant Reply Formatting (`chat.ts`):**
   - Set `reply_to_content: null` for normal assistant replies so quote headers are reserved for user-initiated swipe-to-replies.
8. **Code/Table Protection in `MessageFormatter.ts`:**
   - Guarded `addEmoji` to return text untouched if it contains code fences, markdown tables, or URLs.

## Verification Status
- `npm run build` in `backend`: EXIT 0 (Clean build, 0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (Clean build, 0 errors).
- `ChatIngressAndFormatting.test.ts`: 11/11 PASSED.
- `LifestyleSituationalAwareness.test.ts`: 10/10 PASSED.
- `BurstMessageComprehension.test.ts`: 9/9 PASSED.
- Total Unit Suite: 30/30 PASSED (100%).

## Standing Autonomous Directives
- **Auto Implementation Plan Proceed**: ENABLED.
- **Autonomous Push & Deployment**: ENABLED. Pushing to `origin main` automatically deploys backend to Render and triggers Mobile EAS OTA update.

## NEXT ACTION
Commit and push to `origin main`.


