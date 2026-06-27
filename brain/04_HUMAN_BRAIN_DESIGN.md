# 04_HUMAN_BRAIN_DESIGN: Interaction and Flow

## 1. Information Flow
Every incoming user message triggers a multi-stage cognitive flow:
```
[User Message] ──> [Consciousness Orchestrator]
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
     [Memory]        [Emotion]       [Growth]  (Retrieve Context)
         │               │               │
         └───────────────┼───────────────┘
                         ▼
          [Reasoning] / [Creativity]           (Synthesize Response)
                         │
                         ▼
             [Action] (HTTP Send & Queues)     (Execute Response)
```

## 2. Attention and Priority
- **Foreground Loop:** The Consciousness orchestrator reads inputs and generates a prompt response within 2 seconds using lightweight LLM layers.
- **Background Loop:** Deeper indexing, memory consolidation (moving items from working memory to episodic memory), and Knowledge Graph enrichment run asynchronously in the background (`QueueService`) to preserve interactive speed.
