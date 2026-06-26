import { Memory } from '../types/memory';

export class PromptBuilder {
  /**
   * Injects the retrieved memories into the base system prompt.
   * Format follows the XML `<user_memories>` structure defined in the design.
   */
  buildSystemPrompt(basePrompt: string, memories: Memory[]): string {
    if (!memories || memories.length === 0) {
      return basePrompt;
    }

    let memoryList = '<user_memories>\n';
    for (const mem of memories) {
      // Build natural language sentences based on type and value
      if (mem.memory_type === 'preference' || mem.memory_type === 'interest') {
        memoryList += `- The user's preferred ${mem.key.replace(/_/g, ' ')} is ${mem.value}.\n`;
      } else if (mem.memory_type === 'goal') {
        memoryList += `- The user's goal is ${mem.value}.\n`;
      } else if (mem.memory_type === 'relationship') {
        memoryList += `- The user has a relationship where ${mem.key.replace(/_/g, ' ')} is ${mem.value}.\n`;
      } else {
        memoryList += `- Fact (${mem.key.replace(/_/g, ' ')}): ${mem.value}.\n`;
      }
    }
    memoryList += '</user_memories>\n\nIMPORTANT: You have access to the user\'s memories above. Use them naturally to personalize your response and show that you remember them. Do not explicitly state "I remember" or "according to my memory".';

    return `${basePrompt}\n\n${memoryList}`;
  }
}

export const promptBuilder = new PromptBuilder();
