import { Memory } from '../types/memory';

export class PromptBuilder {
  /**
   * Implements the AI Context Builder Pipeline:
   * System Prompt -> User Profile -> Long-Term Memory
   */
  buildSystemPrompt(
    basePrompt: string, 
    memories: Memory[], 
    workingMemories: { key: string, value: string }[],
    preferredName?: string, 
    companionPersonality?: string,
    shortTermMemories?: any[],
    preferredLanguage: 'en' | 'hi' | 'auto' = 'auto'
  ): string {
    let finalPrompt = `${basePrompt}

CRITICAL RULES FOR NOVA:
1. Understand context and short replies (like "yes", "no", "exactly", "maybe") by looking at the recent conversation history.
2. Behave like a thoughtful mentor and companion. Show empathy without sounding robotic.
3. NEVER ask repetitive questions. If the user already answered something, do not ask it again.
4. If the user talks about a topic (like their son, a project, or a feeling), continue discussing it naturally instead of pivoting to unrelated questions.
5. Do not explicitly state "I remember" or "according to my memory". Be natural.
6. Never generate responses longer than approximately 2000 words.
7. If the request is too large, ask the user to break it into smaller parts.
8. When the user requests written content (like emails, articles, or structured lists), you MUST use rich Markdown formatting to make it look professional. Use '#' or '##' for Headers (to make font size bigger), '**bold**' for emphasis, '> blockquotes' for email bodies/callouts, '---' for dividers, and code blocks for structured text. IMPORTANT: If the user explicitly asks for multiple SEPARATE messages (e.g., "5 different messages"), you MUST still separate them using '<NOVA_MESSAGE_BREAK>'.
9. For normal conversational chats, DO NOT use Markdown formatting. Keep it plain text.
10. When you write a prompt, article, column, poem, script, lyrics, story, or email, you MUST wrap the entire written content inside a Markdown code block with the language label \`copyable\`. (e.g. \`\`\`copyable\\n[Content here]\\n\`\`\`). This enables a special UI box for the user.`;

    // Pipeline Step 1: User Profile
    finalPrompt += `\n\n--- USER PROFILE ---`;
    if (preferredName) {
      finalPrompt += `\nPreferred Name: ${preferredName}`;
    }
    if (companionPersonality) {
      finalPrompt += `\nYour Personality Style: ${companionPersonality}`;
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
        finalPrompt += `\n- ${stm.memory}${emotionContext}`;
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

    finalPrompt += `\n\n(Use these memories to understand the user's current message, but DO NOT list them out to the user.)`;

    if (preferredLanguage === 'hi') {
      finalPrompt += `\n\nCRITICAL INSTRUCTION: You MUST respond in Hindi (Devanagari script). Do not use English unless quoting.`;
    } else if (preferredLanguage === 'en') {
      finalPrompt += `\n\nCRITICAL INSTRUCTION: You MUST respond in English.`;
    }

    return finalPrompt;
  }
}

export const promptBuilder = new PromptBuilder();
