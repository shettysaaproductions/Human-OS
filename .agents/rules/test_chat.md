---
description: Custom workflow for analyzing test chats
---
# Test Chat Protocol

## Trigger
When the user explicitly says `test chat` (or provides a screenshot and mentions `test chat`), you MUST enter the Test Chat Protocol.

## Objective
The goal is to analyze the most recent conversational loop (starting from the last time the user said "hi") to identify any deviations from Human-OS architecture, anti-robot rules, formatting guidelines, or timing logic.

## Execution Sequence

### Step 1: Fetch Chat Context
Run the following command in the terminal to pull the exact chat history starting from the most recent "hi":
```bash
npx ts-node backend/scripts/test_chat_analyzer.ts
```
Read the output carefully. It contains the exact timestamps, read receipts, text contents, and backend subconscious tool emissions (meta).

### Step 2: Cross-Examine the 7 Engines
For the fetched messages, analyze the pipeline against the 7 engines:
1. **NovaBrain**: Did it output valid XML? Are there raw `<reply>` tags leaking to the user?
2. **Prompt Builder (Anti-Robot Rules)**: 
   - Did Nova use bold markdown (`**text**`)? (She shouldn't, she's a friend).
   - Did Nova use bullet points or numbered lists? (She shouldn't).
   - Did Nova pitch her capabilities or say "I am an AI"? (Strictly forbidden).
   - Did Nova start multiple messages with the exact same greeting? (Repetition flaw).
3. **Situational Awareness**: Did Nova correctly perceive the time of day and the user's presence/offline status?
4. **Reminder Engine**: If a reminder was asked for, did Nova actually emit the `ReminderEngine` action? Did it have the right `is_auto` flag if it was proactive? 
5. **Quality Gate**: Did the quality gate trigger? (e.g. appending "Wait, tell me what time though?").
6. **Moment Engine / Reflection**: Were there any background extraction actions triggered correctly?
7. **NACE (Consciousness)**: Were there any double-texts? Were they timed appropriately?

### Step 3: Frontend / Screenshot Analysis (If applicable)
If the user provided an image alongside the `test chat` trigger:
- Use your vision capabilities to cross-reference the UI rendering with the database output.
- Check for styling bugs, markdown rendering issues, or invisible bubbles.

### Step 4: Output Implementation Plan
Create an `implementation_plan.md` artifact.
- Identify the exact root cause of any bugs found.
- Propose the exact file paths and code changes needed to fix them.
- Wait for user approval before modifying code.

> **CRITICAL RULE**: The test chat protocol NEVER fails to fetch the history. If the script fails, fix the script first. The goal of this protocol is to aggressively find bugs and improve the application.
