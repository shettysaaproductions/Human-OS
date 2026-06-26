import { chatCompletion } from '../lib/nvidia';
import { ExtractedMemory } from '../types/memory';
import { logger } from '../lib/logger';

export class MemoryExtractor {
  
  /**
   * Calls the NVIDIA LLM to extract memories from a user message.
   * Returns an array of ExtractedMemory. Always fails gracefully (returns []).
   */
  async extractMemories(userMessage: string): Promise<ExtractedMemory[]> {
    try {
      const response = await chatCompletion([
        {
          role: 'system',
          content: `You are the memory extraction engine for HumanOS. 
Extract key facts, preferences, goals, relationships, and biography details about the user from their message.

STRICT EXTRACTION RULES:
1. ONLY extract information that is likely to remain useful for at least several days.
2. NEVER extract greetings, jokes, temporary emotions, short-term states, or small talk.
   - Example "I'm tired today." -> do not save (shouldPersist = false)
   - Example "I'm hungry." -> do not save (shouldPersist = false)
   - Example "I have diabetes." -> save (shouldPersist = true)
3. For contradictions or updates, use the EXACT SAME "key" as the old memory so the system naturally overwrites it.
   - If they say "I love rap", key might be "music_preference". If they later say "I hate rap, I love jazz", use key "music_preference" with value "jazz". Do not create a new key.

Return ONLY a JSON array named "memories". If no memory is present, return {"memories": []}.

Fields for each memory:
- "shouldPersist": boolean (false if trivial)
- "type": "preference" | "interest" | "goal" | "biography" | "relationship" | "fact"
- "key": A short, snake_case identifier (e.g., "music_preference", "dog_name")
- "value": The actual fact (e.g., "rap", "Buster")
- "importance": Integer 1-10 (10 = life-altering, 5 = standard fact, 1 = trivial)
- "confidence": Float 0.0-1.0 (How certain are you of this fact?)`
        },
        {
          role: 'user',
          content: userMessage
        }
      ], {
        // Enforce JSON parsing
        response_format: { type: 'json_object' },
        temperature: 0.1 // Keep it deterministic
      });

      const parsed = JSON.parse(response);
      return (parsed.memories || []) as ExtractedMemory[];

    } catch (err) {
      logger.error('Failed to extract memories', { error: err instanceof Error ? err.message : String(err) });
      // Extraction failures must NEVER break chat.
      return [];
    }
  }

  /**
   * Simple heuristic to extract 2-3 searchable keywords from the user message.
   * V1 approach before we move to embeddings.
   */
  extractKeywords(userMessage: string): string[] {
    // Simple stop word filtering and tokenization
    const stopWords = new Set(['i', 'am', 'the', 'a', 'to', 'and', 'my', 'is', 'in', 'it', 'that', 'of', 'for', 'with', 'on', 'this', 'but', 'what', 'should', 'about']);
    
    // Convert to lowercase, remove punctuation, split by space
    const words = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
      
    return Array.from(new Set(words));
  }
}

export const memoryExtractor = new MemoryExtractor();
