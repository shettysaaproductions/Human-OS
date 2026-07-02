# GEMINI TASK: Split Long AI Replies Into Multiple Messages

## Role
You are a Senior Mobile Engineer for HumanOS — a Personal AI Operating System.
Stack: React Native (Expo) + Zustand + TypeScript. No native modules allowed.

## Problem
When Nova gives a long answer (e.g. 5 paragraphs), it renders as one giant text bubble.
This looks bad and is hard to read. WhatsApp-style apps split content naturally.

## Goal
When Nova's reply exceeds 280 characters AND contains paragraph breaks (`\n\n`),
split it into multiple sequential message bubbles, each appearing 400ms apart.

## Files To Edit

### 1. `mobile/src/store/useChatStore.ts`

In the `onDone` callback of `processQueue`, after the reply is complete,
add this splitting logic:

```typescript
onDone: (data) => {
  set((s) => {
    // Get the completed nova message
    const novaMsgFull = s.messages.find(m => m.id === novaMsgId);
    const fullContent = novaMsgFull?.content || '';

    // Split into bubbles if long enough
    const shouldSplit = fullContent.length > 280 && fullContent.includes('\n\n');
    
    if (!shouldSplit) {
      // No split needed — just mark as sent
      const updated = s.messages
        .map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m)
        .map(m => m.id === novaMsgId ? { ...m, status: 'sent' as const } : m);
      return { messages: updated, novaState: 'complete', isProcessing: false };
    }

    // Split on paragraph breaks, filter empty parts
    const parts = fullContent.split('\n\n').map(p => p.trim()).filter(Boolean);

    // Replace the single nova message with just the first part
    // Remaining parts will be added after a delay (see below)
    const updated = s.messages
      .map(m => m.id === item.id ? { ...m, status: 'sent' as const } : m)
      .map(m => m.id === novaMsgId ? { ...m, content: parts[0], status: 'sent' as const } : m);

    return { messages: updated, novaState: 'typing', isProcessing: false };
  });

  // Append remaining parts with a 400ms delay between each
  const novaMsgFull = get().messages.find(m => m.id === novaMsgId);
  const fullContent = novaMsgFull?.content || '';
  const parts = fullContent.split('\n\n').map(p => p.trim()).filter(Boolean);

  if (parts.length > 1) {
    parts.slice(1).forEach((part, index) => {
      setTimeout(() => {
        const partId = `${novaMsgId}_part${index + 2}`;
        set((s) => ({
          messages: [...s.messages, {
            id: partId,
            role: 'assistant' as const,
            content: part,
            status: 'sent' as const,
            timestamp: new Date().toISOString()
          }],
          novaState: index === parts.length - 2 ? 'complete' : 'typing'
        }));
      }, (index + 1) * 400);
    });
  }
}
```

**IMPORTANT NOTE**: The above logic has a timing issue since `onDone` receives
the already-streamed full content via the state. The correct implementation:

1. In `onDone`, read the current `novaMsgId` message content from state
2. Split it
3. Update the first part in place
4. Add remaining parts with setTimeout delays

### 2. No backend changes needed.

## Verification Steps
1. Send Nova a message: "Tell me 5 tips for better sleep, one per paragraph"
2. Nova's reply should appear as multiple bubbles, appearing one by one
3. Run `npx tsc --noEmit` — no errors

## Deploy After Completing
```bash
cd mobile
git add src/store/useChatStore.ts
git commit -m "feat(chat): split long Nova replies into multiple message bubbles"
git push origin feature-performance-phase1

eas update --branch production --message "feat: split long replies into bubbles" --environment production --non-interactive
```

## Emergency Rollback OTA
```bash
eas update:republish --group fd1565e0-f1d4-433d-b881-e73739e86aa8 --destination-branch production --message "Emergency recovery"
```
