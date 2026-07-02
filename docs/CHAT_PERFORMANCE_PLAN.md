# CHAT PERFORMANCE PLAN

> **Status:** P1 — Next Sprint
> **Goal:** Make Nova feel instant and alive. Target < 500ms time-to-first-token through SSE streaming.

---

## Current Bottleneck Breakdown

```
Step                    Current Time
─────────────────────────────────────
DB Fetch (parallel)     35–80ms
Prompt Build            10–50ms
LLM Call (cold)         1.5–45s       ← Dominant cost
Network transfer        5–50ms
UI Render               10–30ms
─────────────────────────────────────
Total Perceived         40–60s (worst case)
```

Even after backend parallelization (Phase 1), the user still stares at a spinner for the entire LLM generation time. The only solution is **streaming**.

---

## The Fix: SSE Streaming

Instead of waiting for the complete response, stream tokens as they arrive.

```
User sends message
  ↓ (< 500ms)
"Nova is thinking..."
  ↓ (first token arrives)
"Nova is typing..."
  + first chunk renders
  ↓ (chunks arrive continuously)
Full reply rendered progressively
```

The user perceives < 1s response time even if full generation takes 8s.

---

## Phase 1: Streaming Responses (Backend + Frontend)

### Backend — `/chat/stream` endpoint

**File:** `backend/src/routes/chat.ts`

```typescript
router.post('/chat/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Parallel data fetch (already implemented)
  const [profile, history, shortMemories, longMemories] = await Promise.all([...]);

  // Build prompt
  const prompt = buildPrompt(...);

  // Stream from NVIDIA SDK
  const stream = await nvidiaClient.chat.completions.create({
    stream: true,
    messages: prompt,
    model: 'meta/llama-3.1-70b-instruct'
  });

  // Emit metrics
  const firstTokenAt = Date.now();
  let isFirst = true;

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    if (token) {
      if (isFirst) {
        res.write(`data: ${JSON.stringify({ type: 'metric', key: 'LLM_FIRST_TOKEN_MS', value: Date.now() - firstTokenAt })}\n\n`);
        isFirst = false;
      }
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: token })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
});
```

### Frontend — `chatService.ts`

Replace polling-style `sendMessage` with a streaming `streamMessage`:

```typescript
export async function streamMessage(
  content: string,
  conversationId: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (conversationId: string) => void,
  onError: (err: Error) => void
): Promise<() => void> {
  const EventSource = require('react-native-sse');
  const es = new EventSource(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: content, conversationId })
  });

  es.addEventListener('message', (e: MessageEvent) => {
    const data = JSON.parse(e.data);
    if (data.type === 'chunk') onChunk(data.content);
    if (data.type === 'done') { onDone(data.conversationId); es.close(); }
  });

  es.addEventListener('error', (e: Event) => { onError(new Error('Stream failed')); es.close(); });

  return () => es.close(); // abort function
}
```

### Frontend — `useChatStore.ts`

```typescript
sendMessage: async (content: string) => {
  // 1. Add user message immediately
  const userMsg = { id: ..., role: 'user', content, status: 'sending', timestamp: ... };
  set(s => ({ messages: [...s.messages, userMsg] }));

  // 2. Add Nova placeholder immediately
  const novaId = Date.now() + '_nova';
  set(s => ({ messages: [...s.messages, { id: novaId, role: 'assistant', content: '', status: 'streaming', timestamp: ... }], novaState: 'thinking' }));

  // 3. Stream
  const abort = await streamMessage(
    content,
    get().conversationId,
    (chunk) => {
      set(s => ({
        novaState: 'typing',
        messages: s.messages.map(m => m.id === novaId ? { ...m, content: m.content + chunk } : m)
      }));
    },
    (conversationId) => {
      set(s => ({
        novaState: 'idle',
        conversationId,
        messages: s.messages.map(m => m.id === novaId ? { ...m, status: 'sent' } : m)
      }));
    },
    (err) => {
      // Fallback to /chat
      fallbackSendMessage(content, novaId);
    }
  );
}
```

### Frontend — `ChatScreen.tsx` — Nova State UI

```tsx
{novaState === 'thinking' && (
  <View style={styles.novaStateRow}>
    <Text style={styles.novaStateText}>🧠 Nova is thinking...</Text>
  </View>
)}
{novaState === 'typing' && (
  <View style={styles.novaStateRow}>
    <Text style={styles.novaStateText}>⌨️ Nova is typing...</Text>
  </View>
)}
```

---

## Phase 2: Thinking & Typing States

### State Machine

```
novaState: 'idle' | 'thinking' | 'typing' | 'complete'
```

- **idle** → User hasn't sent a message
- **thinking** → Request sent, no token received yet (DB + prompt build phase)
- **typing** → First token received, streaming in progress
- **complete** → Stream ended, message finalized

Transitions:
1. User taps Send → `thinking`
2. First SSE token arrives → `typing`
3. SSE `done` event → `complete` → `idle` (after 2s)

### Status Messages (Dynamic)

While in `thinking` state, rotate through:
```
Recalling memories...
Reading our history...
Understanding your message...
Preparing reply...
```
Cycle every 2 seconds to give the user feedback about what Nova is doing.

---

## Phase 3: Fallback Strategy

If streaming fails (network drop, SSE error, server error):

```
streamMessage() → error
  → SSE_FALLBACK_TO_CHAT diagnostic logged
  → Call existing /chat endpoint
  → Display full response normally
  → Never crash
```

This means the existing `/chat` endpoint must remain intact and tested.

---

## Metrics to Measure

| Metric                | Measurement Point                        |
|-----------------------|------------------------------------------|
| `QUEUE_WAIT_MS`       | Time from user tap to request sent       |
| `LLM_FIRST_TOKEN_MS`  | Time from request to first SSE token     |
| `LLM_TOTAL_MS`        | Time from request to SSE `done` event    |
| `RESPONSE_RENDER_MS`  | Time from first token to full UI render  |
| `TOTAL_REQUEST_MS`    | Time from user tap to Nova `complete`    |

All metrics logged via existing `logger.ts` `logEvent()` system.

---

## Performance Targets

| Metric               | Current   | Target     |
|----------------------|-----------|------------|
| Time to first token  | 1.5–45s   | < 500ms    |
| Full response        | 3–60s     | 1–8s       |
| Perceived speed      | 40–60s    | 0.5–2s     |
| UI freeze            | Yes       | None       |

---

## Prerequisites Before Implementation

1. ✅ Stable native APK baseline (cc24f6c / stable-apk-baseline)
2. ✅ `react-native-sse` removed from production OTA (crash root cause fixed)
3. ✅ Fresh native build installed on device
4. ⬜ Canary branch created and tested before pushing to production
5. ⬜ `expo-splash-screen` dependency audit before any new OTA

---

## Implementation Order

1. Backend: `/chat/stream` SSE endpoint
2. Backend: Emit `LLM_FIRST_TOKEN_MS` and `LLM_TOTAL_MS` metrics
3. Frontend: `chatService.ts` — `streamMessage()` with fallback
4. Frontend: `useChatStore.ts` — `novaState` machine + chunk append
5. Frontend: `ChatScreen.tsx` — thinking/typing UI states
6. Frontend: Dynamic status message rotation
7. Test on canary branch
8. Deploy to production
