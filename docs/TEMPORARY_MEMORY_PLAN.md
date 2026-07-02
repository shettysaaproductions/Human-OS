# Temporary Memory & Session Summarization Plan

## Goal
Implement a short-term memory system and session summarization to reduce token usage and improve conversational context retrieval without bloating active memory.

## Architecture
- **Active Context Window:** Maintain only the last N messages (e.g., last 20) in the immediate prompt context.
- **Background Summarizer Service:** A backend worker (e.g., a scheduled task or triggered after a period of inactivity) that analyzes older messages outside the active window.
- **Memory Store:** Store generated summaries in a dedicated `session_summaries` table linked to the `conversation_id`.

## Token Reduction Strategy
- Pass the latest summary as a system prompt prefix, followed by only the recent N messages.
- Exclude verbose older interactions to prevent prompt length from linearly increasing over time.

## Expiration Policy
- **Active Messages:** Roll off the active context window after N messages or after 24 hours of inactivity.
- **Summaries:** Keep high-level semantic summaries indefinitely, but periodically condense older summaries (e.g., weekly roll-ups) to maintain a fixed ceiling on summary tokens.

## Retrieval Logic
- When constructing the LLM payload, first query the `session_summaries` table for the active conversation.
- Inject the summary string: `"Previous context: [Summary]"`.
- Append the raw recent messages from the database.
- Send the combined payload to the AI model.
