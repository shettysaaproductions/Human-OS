# GEMINI TASK: Idempotency Keys — Prevent Duplicate Messages

## Role
You are a Senior Backend Engineer for HumanOS.
Stack: Express + TypeScript + Supabase.

## Problem
If a user sends a message and the network is slow, the app may retry.
This causes the same message to be saved twice to the database.
Users see: "hi" sent twice, Nova replies twice.

## Goal
Add idempotency keys so retried messages are deduplicated at the database level.
The mobile app already sends a `clientMsgId` — this must be stored and checked.

## Step 1: Add Column To Supabase

Run in Supabase SQL Editor:

```sql
ALTER TABLE chat_history 
ADD COLUMN IF NOT EXISTS client_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_history_idempotency
  ON chat_history(user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
```

## Step 2: Update Backend chat.ts

### In POST `/` route, update the user message insert:

Find:
```typescript
qt.track('save_user_message', 'chat_history', () =>
  supabaseAdmin.from('chat_history')
    .insert({ user_id: userId, conversation_id: activeConversationId, role: 'user', content: message })
    .select('id').single()
),
```

Replace with:
```typescript
qt.track('save_user_message', 'chat_history', () =>
  supabaseAdmin.from('chat_history')
    .upsert(
      { 
        user_id: userId, 
        conversation_id: activeConversationId, 
        role: 'user', 
        content: message,
        client_message_id: client_message_id || null
      },
      { 
        onConflict: 'user_id,client_message_id',
        ignoreDuplicates: true 
      }
    )
    .select('id').single()
),
```

### Update the Zod schema at the top:

Find:
```typescript
const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
  language: z.enum(['en', 'hi', 'auto']).optional().default('auto'),
  client_message_id: z.string().optional(),
});
```

This is already there. Ensure `client_message_id` is used in the upsert above.

## Step 3: Update Mobile chatService.ts

In `mobile/src/services/chatService.ts`, update `sendMessage` to pass the clientMsgId:

```typescript
sendMessage: async (message: string, conversationId?: string, clientMsgId?: string) => {
  const payload: any = { message };
  if (conversationId) payload.conversation_id = conversationId;
  if (clientMsgId) payload.client_message_id = clientMsgId;

  const response = await api.post('/chat', payload);
  return response.data;
},
```

And `streamMessage` similarly:
```typescript
streamMessage: async (message: string, conversationId?: string, clientMsgId?: string, callbacks?: ...) => {
  const payload: any = { message };
  if (conversationId) payload.conversation_id = conversationId;
  if (clientMsgId) payload.client_message_id = clientMsgId;
  // ... rest of implementation
}
```

## Step 4: Update useChatStore.ts

In `processQueue`, pass `item.clientMsgId` to both `streamMessage` and `sendMessage`:

```typescript
await chatService.streamMessage(
  item.content,
  get().conversationId || undefined,
  item.clientMsgId, // <-- add this
  { onStart, onChunk, onDone }
);
```

## Verification
1. `npx tsc --noEmit` — no errors
2. Send a message. Open network logs. Manually call the same endpoint twice with the same `client_message_id`
3. Confirm only ONE row exists in Supabase `chat_history`

## Deploy
```bash
git add backend/src/routes/chat.ts mobile/src/services/chatService.ts mobile/src/store/useChatStore.ts
git commit -m "fix(chat): add idempotency keys to prevent duplicate messages"
git push origin feature-performance-phase1
```

Then OTA update mobile:
```bash
cd mobile
eas update --branch production --message "fix: idempotency keys prevent duplicate messages" --environment production --non-interactive
```
