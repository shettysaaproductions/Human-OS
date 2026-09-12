# CURRENT TASK

## Task ID
FRONTEND-CHAT-UX-LIFESTYLE-RELIABILITY-UPGRADE

## Objective
Identify and resolve high-impact front-end bugs and loopholes in the chat section to maximize responsiveness, productivity, and lifestyle adaptation for diverse user personas:
1. **Prefix Stacking Bug Fixed**: Replaced repetitive prefix concatenation with smart prefix substitution (`ALL_QUICK_PREFIXES`) in `ChatScreen.tsx`.
2. **Persistent Lifestyle Hub Modal**: Built interactive modal accessible anytime via quick chip (`🌟 Lifestyles`) or header button with 10 lifestyle tracks:
   - Founder & Entrepreneur
   - Family & Parenting
   - Finance & Wealth
   - Mental Clarity & Calm
   - Work & Productivity
   - Student & Learning
   - Fitness & Health
   - Habits & Routine
   - Pet Parent
   - Creative & Ideas
3. **Multi-Selection UI Stale Highlight Bug**: Updated FlatList `extraData` to `${displayedMessages.length}_${selectedMessageIds.join(',')}_${isTyping ? '1' : '0'}` ensuring instant row highlight when toggling multiple selections.
4. **Selection Bar Edit Focus**: Added immediate `inputRef.current?.focus()` on edit action.
5. **Date Separator Bug During Search Filter**: Updated `renderItem` to calculate dates using `displayedMessages` instead of `reversedMessages`.
6. **Pagination False Unread Badge Bump**: Tracked newest message ID so prepending older messages via `loadOlderMessages()` never triggers the scroll-down FAB unread badge.
7. **Android Multiline Input Vertical Centering**: Configured `textAlignVertical="top"` on multiline `TextInput` and anchored clear button to `top: 10`.
8. **Image URI Dropped on Retry**: Passed `imageUri: msg.image_uri` in `retryMessage` in `useChatStore.ts`.
9. **Scroll-To-Bottom Layout Race**: Wrapped `scrollToOffset` in `requestAnimationFrame` on send.

## Scope
- `mobile/src/screens/ChatScreen.tsx`
- `mobile/src/store/useChatStore.ts`

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
