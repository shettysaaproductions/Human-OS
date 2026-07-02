# GEMINI TASK: Cap Chat History to Last 20 Messages

## Role
You are a Senior Backend Engineer for HumanOS — a Personal AI Operating System.
Nova is the AI companion. The backend is Express + TypeScript + Supabase.

## Problem
The backend currently sends ALL chat history to the LLM on every message.
A user with 600+ messages sends 600 messages to NVIDIA NIM every single time.
This causes 40-60 second response times and will break completely at scale.

## Task
Modify the backend chat route to send only the last 20 messages to the LLM.

## File To Edit
`backend/src/routes/chat.ts`

## Current Code (find this section)
```typescript
// 2. Chat history (prior to this message)
qt.track('get_chat_history', 'chat_history', () =>
  supabaseAdmin.from('chat_history')
    .select('role, content')
    .eq('user_id', userId)
    .eq('conversation_id', activeConversationId)
    .order('created_at', { ascending: false })
    .limit(20)
),
```

## What To Change
The `.limit(20)` is already there but the query orders DESC and then reverses.
Verify this is working correctly. Additionally, limit the GLOBAL history across ALL conversations (not just current one) to last 20 messages.

Also update the `/chat/stream` route with the same limit.

## Required Changes

### Change 1: In the POST `/` route
Replace the history query to get the last 20 messages globally (not per-conversation):
```typescript
// 2. Chat history — last 20 messages only (Memory V2 cap)
qt.track('get_chat_history', 'chat_history', () =>
  supabaseAdmin.from('chat_history')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
),
```

### Change 2: In the POST `/stream` route
Apply the same 20-message cap.

### Change 3: Add a log
After loading history, add:
```typescript
logger.info('[MemoryV2] History capped', { 
  messagesSent: recentMessages.length, 
  maxAllowed: 20 
});
```

## Verification
1. Run: `npx tsc --noEmit` in the `backend/` directory
2. No TypeScript errors should appear
3. Test: send a message as a user with 100+ messages in history
4. Confirm the log shows `messagesSent: 20`

## Deploy After Completing
```bash
cd backend
git add src/routes/chat.ts
git commit -m "fix(chat): cap history to 20 messages for LLM context (Memory V2)"
git push origin feature-performance-phase1
```

Then deploy backend to Render (push to main triggers auto-deploy).

## Emergency Rollback
If this breaks chat:
```bash
git revert HEAD
git push origin feature-performance-phase1
```
