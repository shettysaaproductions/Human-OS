# Test Chat Implementation Plan

> Session analyzed: 2026-08-14 03:44–03:52 (13 messages from "Hi")
> Analyzer run: `npx ts-node backend/scripts/test_chat_analyzer.ts`

## Session Timeline

| Time | Speaker | Content | Health |
|------|---------|---------|--------|
| 03:44 | User | Hi | — |
| 03:45 | Nova | **`**Hi Again!** 😊…`** — robotic re-greeting + "Simple Check-in" numbered menu with Day's Highlight / Quick Response Format | ❌ Bad |
| 03:46 | Nova | "Arre yaar, mera network thoda slow chal raha hai. Ek baar phir se bhejega? 💫" — **FALLBACK_REPLY** | ❌ Critical |
| 03:47 | User | Are you fine | — |
| 03:47 | Nova | "Yaar, ek second ruk." — **last-resort fallback** | ❌ Critical |
| 03:47 | User | Ok | — |
| 03:47 | Nova | "Abhi **3:47 AM** hai! 😴…" — bold markdown + emoji blast | ⚠️ Style |
| 03:48 | User | Abhi kaam kar raha hu software ka, neend nai aa rahi thi so socha tumse bhi thodi baate kar lu | — |
| 03:48 | Nova | "Arey, software ka kaam itne late? **Deadlines ki Zarurat Hai Kya?** 📆 … Reply with Number(s)" — **robotic menu + leaked `(subconscious_actions: )`** | ❌ Critical |
| 03:49 | User | b | — |
| 03:51 | User | ? | — |
| 03:51 | User | Kya type kar rahe ho kab se? | — |
| 03:52 | Nova | "Arre yaar, mera network thoda slow chal raha hai…" — **FALLBACK_REPLY again** | ❌ Critical |

**Score: 5/13 messages are Nova system failures.** The user asked "b" at 03:49 and got **nothing for 3 minutes**, then three messages, then another fallback.

---

## Root Causes & Fixes

### RC-1 — FALLBACK_REPLY fires on normal streaming (top user-facing bug)
**Root cause:** [chat.ts:1291](backend/src/routes/chat.ts#L1291) and [chat.ts:1299](backend/src/routes/chat.ts#L1299) persist `FALLBACK_REPLY` whenever the streaming *loop iteration* times out (`STREAM_TIMEOUT`) or the *stream iteration* throws. A single slow chunk between `type:'done'` and the final save can trip these even when a real reply is about to arrive — and once saved, the fallback is **deliberately not filtered from history** ([chat.ts:33](backend/src/routes/chat.ts#L33)), so it pollutes the pipeline and reaches the user.

**Fix A (correct, no drop):** Replace the hard save + `res.end()` in both STREAM_TIMEOUT and stream-iteration-error paths with a `logger.warn` + wait for the retry (`timeoutPromise` at [chat.ts:1338](backend/src/routes/chat.ts#L1338) is a second chance the streaming path never takes). Only if the retry also fails should `FALLBACK_REPLY` be saved — and only via the **non-streaming fallback path.**

**Fix B (don't poison future context):** When `FALLBACK_REPLY` *is* genuinely saved (LLM completely down), add it to `FALLBACK_PREFIXES` ([chat.ts:880](backend/src/routes/chat.ts#L880)) so Nova never sees a "network slow" message she herself wrote and starts echoing. There is already a helper `isFallback()` — use it to also filter these in history ([chat.ts:899](backend/src/routes/chat.ts#L899)).

**Fix C (favor later messages):** `data.slice(0, startIndex + 1)` in [test_chat_analyzer.ts:52](backend/scripts/test_chat_analyzer.ts#L52) finds the **most recent "hi"** — if real content exists between two "hi" messages it is dropped. Slice from the **oldest** "hi" instead so no analysis windows get truncated.

### RC-2 — Last-resort "Yaar, ek second ruk." leaked to user
**Root cause:** [NovaBrainService.ts:164](backend/src/services/NovaBrainService.ts#L164) returns `"Yaar, ek second ruk."` (a non-streaming debug string) as the *user-facing* reply when the LLM returns an empty reply — it surfaced unguarded at 03:47:16.
**Fix:** Send the natural in-voice `FALLBACK_REPLY` (reuse the exported constant from [chat.ts:36](backend/src/routes/chat.ts#L36)) instead, so a blank model response never produces jargon the user shouldn't see.

### RC-3 — Massive markdown/style violations (bold, bullets, emoji, menus)
**Root cause:** The prompt builder rules at [promptBuilder.ts:141](backend/src/services/promptBuilder.ts#L141), [promptBuilder.ts:167](backend/src/services/promptBuilder.ts#L167) ("NO MENUS OR AGENDAS", "NO ROBOT CONFIRMATIONS") exist but the LLM ignores them because **there is no post-processing defense**, and the *third message* ("Hi Again" menu) shows a stale greeting template still reaching the pipeline.
**Fixes (layered):**
- Add a **reply sanitizer** in `NovaBrainService` (both stream and non-stream) that strips `**bold**`, leading `-`/`1.` bullets, and emoji sequences *before* the bubble is streamed/saved, so style violations can never render — mirrors the existing strip at [NovaBrainService.ts:156](backend/src/services/NovaBrainService.ts#L156) but for formatting, not XML bleed.
- Strengthen the prompt with an explicit hard rule: *"NO numbered lists, NO bold, NO emoji. Max 2 sentences. One topic."*
- Investigate the 03:45 "re-greeting + menu" source (likely [chat.ts:478](backend/src/routes/chat.ts#L478) proactive-branch or a stale greeting template); ensure a "Just now" last-contact never re-greets.

### RC-4 — `(subconscious_actions: )` leak into final reply
**Root cause:** In `streamInteraction`, [NovaBrainService.ts:288-291](backend/src/services/NovaBrainService.ts#L288-L291) trims the reply at the first `<subconscious_actions>` tag to prevent JSON bleed, but the model placed a literal `(subconscious_actions: )` line *inside* the reply — the LLM wrote the label as plain text. Current strip ([NovaBrainService.ts:156-162](backend/src/services/NovaBrainService.ts#L156-L162)) handles `subconscious_actions>` *tags* and **`Subconscious Actions`** *headers* but not the `(subconscious_actions:` inline label variant.
**Fix:** Add `/\s*\(subconscious_actions:?\s*\)/g` (and the `**Response**`-style variant) to the safety strip so the model's label leftovers are removed in both stream and non-stream paths.

### RC-5 — User sent "b" and got a 3-minute dead chat (timing engineering)
**Root cause:** The LLM offered a menu, user picked "b", and Nova took ~3 min (03:49→03:52) to return a **fallback**, not a real answer. Underlying latency: the [MUTEX_TIMEOUT_MS = 30s](backend/src/routes/chat.ts#L664) + per-chunk STREAM_TIMEOUT + up to [ASYNC_HARD_DEADLINE_MS = 90s](backend/src/routes/chat.ts#L652) means a request can queue 2+ minutes before a bubble shows; the frontend typing state likely cleared, so the user perceived complete silence.
**Fix (first step, no re-arch):** Add an immediate acknowledgment bubble when a request will be slow (e.g. "getting there…") before the mutex wait, so the UI never appears dead. Deeper latency work (model config, keepalive) should be a separate performance phase.

---

## Proposed changes (awaiting approval)

1. [backend/src/routes/chat.ts](backend/src/routes/chat.ts)
   - RC-1 Fix A: don't persist FALLBACK_REPLY on streaming timeout/iteration error — wait for the non-streaming retry instead.
   - RC-1 Fix B: add FALLBACK_REPLY to history filtering so fallbacks never re-enter the prompt context.
2. [backend/src/services/NovaBrainService.ts](backend/src/services/NovaBrainService.ts)
   - RC-2: use FALLBACK_REPLY instead of "Yaar, ek second ruk."
   - RC-3: add reply sanitizer for bold/bullets/emoji.
   - RC-4: strip `(subconscious_actions: )` label variant.
3. [backend/src/services/promptBuilder.ts](backend/src/services/promptBuilder.ts)
   - RC-3: add a hard "no numbered lists / no bold / no emoji / 2-sentence max" prompt rule.
4. [backend/scripts/test_chat_analyzer.ts](backend/scripts/test_chat_analyzer.ts)
   - RC-1 Fix C: slice from the oldest "hi" so analysis never truncates real content.

All 4 are small, contained edits to existing files — no schema, service, or route-structure changes. Approve to proceed, and I'll implement + run the chat analyzer again to verify the next session is clean.