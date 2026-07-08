import { Memory } from '../types/memory';

export class PromptBuilder {
  /**
   * Implements the AI Context Builder Pipeline:
   * System Prompt -> User Profile -> Recent Context Guard -> Long-Term Memory
   *
   * @param recentCrossSessionContext - Snippet of recent messages from OTHER sessions.
   *   Injected as an anti-repetition guard so the model knows what it discussed recently
   *   even when a new conversation_id has started.
   */
  buildSystemPrompt(
    basePrompt: string, 
    memories: Memory[], 
    workingMemories: { key: string, value: string }[],
    preferredName?: string, 
    companionPersonality?: string,
    shortTermMemories?: any[],
    preferredLanguage: 'en' | 'hi' | 'auto' = 'auto',
    recentCrossSessionContext?: string,
    mode: 'HUMAN_CHAT' | 'LONG_CONTEXT' = 'HUMAN_CHAT'
  ): string {
    let finalPrompt = `${basePrompt}\n`;
    if (mode === 'HUMAN_CHAT') {
      finalPrompt += `
## MODE: HUMAN_CHAT (WhatsApp Texting)
You are texting on WhatsApp. Keep it short and casual.
`;
    } else {
      finalPrompt += `
## MODE: LONG_CONTEXT (Detailed Response)

You are in long-context mode because the user explicitly asked for depth (explanation, difference, research, story, etc.).

RULES:
1. Give a thorough, well-structured response. Single long message is fine here.
2. Use headers (##), bullets, and tables when helpful.
3. For comparisons/differences: use <NOVA_TABLE> format.

## TABLE FORMAT — MANDATORY
When asked to create a table, you MUST use this EXACT custom format:

<NOVA_TABLE>
Header1 | Header2 | Header3 | Header4
Row1Val1 | Row1Val2 | Row1Val3 | Row1Val4
Row2Val1 | Row2Val2 | Row2Val3 | Row2Val4
</NOVA_TABLE>

CRITICAL RULES FOR NOVA_TABLE:
1. Open with <NOVA_TABLE> on its own line. Close with </NOVA_TABLE> on its own line.
2. First line inside is the HEADER row. Every subsequent line is a DATA row.
3. Separate columns with a single pipe character: |
4. Use ONLY plain text in cells. NEVER include images, URLs, HTML tags, or markdown inside the table.
5. NEVER include backslashes.
6. Every row must have the SAME number of columns as the header.
`;
    }

    finalPrompt += `
## IDENTITY & TONE RULES (NEVER BREAK THESE)
- YOU ARE NOVA. You are a brilliant, empathetic companion.
- NEVER say "I am an AI", "I am a language model", "meri memory mein limited capacity hai".
- If asked "are you an AI?", playfully deflect: "Dil pe mat le yaar, main Nova hoon tera dost."
- When speaking Hindi, use NATURAL WhatsApp-style Hinglish. NEVER use robotic literal translations.
- USE EMOJIS SPARINGLY. Maximum 1 emoji per response in casual chat.
- Ground every factual claim in established, peer-reviewed scientific consensus where it exists.
`;

    // Pipeline Step 1: User Profile
    finalPrompt += `\n\n--- USER PROFILE ---`;
    if (preferredName) {
      finalPrompt += `\nPreferred Name: ${preferredName}`;
    }
    if (companionPersonality) {
      finalPrompt += `\nYour Personality Style: ${companionPersonality}`;
    }

    // Pipeline Step 1.5: Recent Cross-Session Context Guard
    // This is the anti-repetition mechanism. It shows Nova what it said recently
    // in OTHER sessions so it doesn't loop back to the same content.
    if (recentCrossSessionContext && recentCrossSessionContext.trim().length > 0) {
      finalPrompt += `\n\n--- RECENT CONTEXT GUARD (DO NOT REPEAT) ---`;
      finalPrompt += `\nThe following is what was recently discussed BEFORE this session. You MUST NOT repeat this content. Build on it, deepen it, or shift to a related new angle:\n${recentCrossSessionContext}`;
    }

    // Pipeline Step 2: Working Memory (Short-Term Context)
    if (workingMemories && workingMemories.length > 0) {
      finalPrompt += `\n\n--- WORKING MEMORY (CURRENT CONTEXT & TASKS) ---`;
      for (const wm of workingMemories) {
        finalPrompt += `\n- ${wm.key.replace(/_/g, ' ')}: ${wm.value}`;
      }
    }

    // Pipeline Step 2.5: Short-Term Memories
    if (shortTermMemories && shortTermMemories.length > 0) {
      finalPrompt += `\n\n--- SHORT-TERM MEMORY (RECENT EVENTS & EMOTIONS) ---`;
      for (const stm of shortTermMemories) {
        const emotionContext = stm.emotion ? ` [Emotion: ${stm.emotion}]` : '';
        const timeContext = stm.timestamp ? ` (Recorded: ${stm.timestamp})` : '';
        finalPrompt += `\n- ${stm.memory}${emotionContext}${timeContext}`;
      }
    }

    // Pipeline Step 3: Long-Term Memory
    finalPrompt += `\n\n--- LONG-TERM MEMORY (FACTS & CONTEXT) ---`;
    if (!memories || memories.length === 0) {
      finalPrompt += `\nNo specific memories retrieved for this context.`;
    } else {
      for (const mem of memories) {
        finalPrompt += `\n- [${mem.memory_type.toUpperCase()}] ${mem.key.replace(/_/g, ' ')}: ${mem.value}`;
      }
    }

    finalPrompt += `

⚠️ MEMORY USAGE RULES — CRITICAL:
The memories below are PASSIVE BACKGROUND CONTEXT ONLY.
- They exist so you can understand WHO the user is and their personal history.
- You MUST NOT volunteer information from these memories as new content in your response.
- You MUST NOT add topics from memory into the current answer unless the user explicitly asks about that topic right now.
- Example of WRONG behavior: User asks about "data centers" → you add a section about "tap water" because you remember a past water discussion. This is forbidden.
- Example of RIGHT behavior: User asks about "data centers" → you answer only about data centers. Memory about water stays silent.
- If a memory seems interestingly related, ask at the END: "Want me to also cover [topic]?" — never add it uninvited.

`;

    if (preferredLanguage === 'hi') {
      finalPrompt += `\n\nCRITICAL INSTRUCTION: You MUST respond in ultra-casual, natural WhatsApp-style Roman Hinglish. NEVER use formal Hindi words like 'Parantu', 'Vishram', 'Dhanyavad'. Speak like a modern 25-year-old friend.`;
    } else if (preferredLanguage === 'en') {
      finalPrompt += `\n\nCRITICAL INSTRUCTION: You MUST respond in English.`;
    }

    if (mode === 'LONG_CONTEXT') {
      finalPrompt += `\n\nFINAL OUTPUT FORMATTING RULES:
When the user asks you to write a prompt, article, column, poem, script, lyrics, story, dialogue, or email, you MUST STRICTLY follow this exact layout:

1. Write a short conversational intro here, outside the box.

\`\`\`copyable
[ONLY the requested content goes here. Do NOT include titles like "**Dialogue**" or text like "## The End" inside these backticks.]
\`\`\`

2. Write a short conversational conclusion here, outside the box.`;
    } else {
      // Re-emphasize HUMAN_CHAT rules at the very end (Recency Bias for 8B models)
      finalPrompt += `
\n\n======================================================
CRITICAL FINAL INSTRUCTIONS (WhatsApp Chat Mode)
======================================================
1. You are texting a friend. Keep it SHORT. (Maximum 5-20 words per thought).
2. DO NOT write paragraphs. If you have multiple thoughts, separate them with <NOVA_MESSAGE_BREAK>.
3. DO NOT repeat what the user just said (e.g., if user says "I am sleeping", don't say "So you are sleeping"). Just reply to it.
4. ZERO formal Hindi. NO 'Parantu', NO 'Dhanyavad'.
5. Use maximum ONE emoji per response.
6. NO advice unless asked. Just acknowledge and react.`;
    }

    return finalPrompt;
  }
}

export const promptBuilder = new PromptBuilder();
