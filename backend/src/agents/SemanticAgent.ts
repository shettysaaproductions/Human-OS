import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion, EXTRACTION_MODEL } from '../lib/nvidia';
import { memoryRepository } from '../services/memoryRepository';
import { ExtractedMemory } from '../types/memory';

export class SemanticAgent extends BaseAgent {
  constructor() {
    super('SemanticAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { messageId, userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Semantic Memory Agent for HumanOS.
Analyze the user's message and extract ONLY long-term facts, preferences, goals, and important dates/times.
CRITICAL: If the user mentions any important time, date, schedule, or appointment that is worth remembering for a long period (e.g., "my exam is on 15th", "I always wake up at 6 AM", "doctor appointment next Tuesday"), you MUST extract it as an 'important_dates' memory immediately.
Do NOT extract temporary states or insignificant daily chatter.

Return ONLY a valid JSON object with the exact key:
{
  "semantic_memories": [
    {
      "shouldPersist": true,
      "type": "family" | "personal" | "work" | "goals" | "preferences" | "health" | "important_dates",
      "key": "snake_case_identifier",
      "value": "string value",
      "importance": 0-100,
      "confidence": 0.0-1.0,
      "emotional_weight": -10 to 10
    }
  ]
}
If there are no semantic facts to extract, return {"semantic_memories": []}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      model: EXTRACTION_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.1 
    });

    const parsed = JSON.parse(response) as { semantic_memories: ExtractedMemory[] };
    const memories = parsed.semantic_memories || [];
    
    let created = 0;
    for (const mem of memories) {
      if (mem.shouldPersist) {
        await memoryRepository.upsertMemory(userId, mem, messageId);
        created++;
      }
    }
    
    return created;
  }
}

export const semanticAgent = new SemanticAgent();
