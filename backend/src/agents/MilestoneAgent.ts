import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { memoryRepository } from '../services/memoryRepository';
import { ExtractedMemory } from '../types/memory';

export class MilestoneAgent extends BaseAgent {
  constructor() {
    super('MilestoneAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { messageId, userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Milestone Memory Agent for HumanOS.
Analyze the user's message and extract ONLY highly critical family and life milestones.
Examples of critical milestones:
- Birth of a child ("I was blessed with a baby boy", "My son was born on 17 Feb 2026")
- Marriage ("I got married today")
- Buying a house ("We just bought our first home")
- Death in the family ("My father passed away")

For child births specifically, extract fields like child_name, child_dob, and child_gender.

Return ONLY a valid JSON object with the exact key:
{
  "milestone_memories": [
    {
      "shouldPersist": true,
      "type": "child" | "milestone" | "family",
      "key": "snake_case_identifier",
      "value": "string value",
      "importance": 100,
      "confidence": 1.0,
      "emotional_weight": 10
    }
  ]
}

If this is a birth of a child, importance MUST be 100, confidence MUST be 1.0, emotional_weight MUST be 10, and type MUST be "child" or "family".
If there are no critical life milestones to extract, return {"milestone_memories": []}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.0 
    });

    const parsed = JSON.parse(response) as { milestone_memories: ExtractedMemory[] };
    const memories = parsed.milestone_memories || [];
    
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

export const milestoneAgent = new MilestoneAgent();
