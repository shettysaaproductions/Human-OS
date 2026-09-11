# CURRENT TASK

## Task ID
FRONTEND-CHAT-IMPACT-PHASE3-COMPANION-INTELLIGENCE

## Objective
Fix critical high-impact frontend chat bugs and enhance lifestyle companion user experience: markdown blockquote preservation (`>`), pending image queue hydration, image-only placeholder cleanup, clean single-line quoted reply previews, quick chip typing presence, inverted lifestyle onboarding touch conflicts, image attachment zoom preview with larger touch targets, dynamic theme styling for LiveThinkingIndicator, and toast timer deduplication.

## Scope
- Keep `main` as the production source of truth.
- Update `ChatScreen.tsx` to preserve `>` in markdown blockquotes, math inequalities, and transition arrows.
- Add `cleanPreviewText` helper to strip raw markdown syntax from swipe-to-reply headers and reply preview banners.
- Suppress redundant `📷 [Photo]` text bubbles when image attachments are present.
- Enrich image attachment thumbnail preview with tap-to-zoom modal and enlarged dismiss touch target.
- Trigger `presenceService.onTypingStart()` on quick action lifestyle chip taps.
- Enable `nestedScrollEnabled={true}` and `keyboardShouldPersistTaps="handled"` on `LifestyleOnboardingHub`.
- Integrate `useTheme()` in `LiveThinkingIndicator.tsx` for Light and Dark theme readability.
- Fix pending queue hydration in `useChatStore.ts` so `image_uri` and `image_base64` are preserved across app restarts.
- Pass all verification gates: `cd mobile && npx tsc --noEmit` (exit 0), `cd backend && npm run build` (exit 0), and 30/30 unit tests passing.

## Approved Code
All changes pass `cd mobile && npx tsc --noEmit` (code 0), `cd backend && npm run build` (code 0), and all unit tests (code 0).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
