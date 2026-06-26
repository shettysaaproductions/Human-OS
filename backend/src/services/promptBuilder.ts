import { Memory } from '../types/memory';

export class PromptBuilder {
  /**
   * Injects the retrieved memories into the base system prompt.
   * Format follows the XML `<user_memories>` structure defined in the design.
   */
  buildSystemPrompt(
    basePrompt: string, 
    memories: Memory[], 
    preferredName?: string, 
    companionPersonality?: string
  ): string {
    let finalPrompt = basePrompt;

    if (companionPersonality) {
      finalPrompt += `\n\nCOMPANION PERSONALITY:\n${companionPersonality}`;
    }

    if (preferredName) {
      finalPrompt += `\n\nUSER'S NAME: The user prefers to be called ${preferredName}. Address them naturally when appropriate.`;
    }

    if (!memories || memories.length === 0) {
      return finalPrompt;
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
    memoryList += '</user_memories>\n\nIMPORTANT INSTRUCTIONS REGARDING MEMORIES:\n- Only reference memories that are directly relevant to the user\'s message.\n- Do not force unrelated memories into every response.\n- Never mention a memory unless it improves the answer.\n- Never combine unrelated memories.\n- Do not explicitly state "I remember" or "according to my memory".';

    return `${finalPrompt}\n\n${memoryList}`;
  }
}

export const promptBuilder = new PromptBuilder();
