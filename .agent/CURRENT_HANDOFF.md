# CURRENT HANDOFF

## Last Updated
2026-09-12 — Human-OS / Nova Front-End Chat Experience & Lifestyle Upgrade

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Task: Front-End Chat Section UX, Multi-Selection, Input Stability & Autonomous Lifestyle Hub Upgrade.

## Confirmed Findings & Architectural Solutions
1. **Prefix Stacking Bug Fixed**:
   - Tapping quick action chips consecutively previously stacked prefixes indefinitely (`Action items & plan for: My goal is: Remind me to ...`).
   - Implemented `ALL_QUICK_PREFIXES` substitution so selecting another chip seamlessly replaces the existing prefix while preserving any custom text typed by the user.
2. **Persistent Interactive Lifestyle Hub**:
   - `LifestyleOnboardingHub` was previously inaccessible after message 1.
   - Added persistent `🌟 Lifestyles` quick chip and header button opening an interactive modal with 10 lifestyle tracks (Founder & Entrepreneur, Parenting & Family, Finance & Wealth, Mental Clarity & Calm, Fitness, Student, Work, Habits, Pet Care, Creative).
   - Allows users of any background or lifestyle to instantly trigger or customize curated high-impact prompts.
3. **Multi-Selection UI Stale Highlight Bug**:
   - FlatList `extraData` previously only evaluated `selectedMessageIds[0]`, skipping row re-renders when selecting additional messages.
   - Updated `extraData` to track `selectedMessageIds.join(',')`, making item selection highlights update instantly.
4. **Selection Edit Focus**:
   - Tapping ✏️ Edit on a selected message now calls `inputRef.current?.focus()`, opening the keyboard immediately.
5. **Date Separator Bug During Search Filter**:
   - Fixed `renderItem` to compare against adjacent messages in `displayedMessages` rather than `reversedMessages`.
6. **Pagination False Unread Badge Bump**:
   - Tracked `lastKnownNewestIdRef` so older historical messages loaded via pagination never increment the unread badge on the scroll-down FAB.
7. **Android Multiline Input Alignment**:
   - Set `textAlignVertical="top"` on `TextInput` to prevent text centering bugs on Android when typing multi-line messages.
   - Anchored clear button to `top: 10`.
8. **Image URI Dropped on Retry**:
   - Included `imageUri: msg.image_uri` in `useChatStore.retryMessage` so retried image messages retain attachments.
9. **Scroll-To-Bottom Layout Race**:
   - Wrapped `scrollToOffset` in `requestAnimationFrame` on send for reliable scrolling to bottom.

## Verification Status
- `npm run build` in `backend`: **EXIT 0** (0 errors).
- `npx tsc --noEmit` in `mobile`: **EXIT 0** (0 errors).

## NEXT ACTION
Commit changes, push to `origin main`, and trigger mobile EAS Production OTA update.
