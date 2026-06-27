import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { WorkingMemory } from '../types/memory';

export class WorkingMemoryAgent extends BaseAgent {
  constructor() {
    super('WorkingMemoryAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Working Memory Agent for HumanOS.
Analyze the user's message and extract ONLY short-term context, temporary states, and tasks for today.
Do NOT extract long-term facts.

Return ONLY a valid JSON object with the exact key:
{
  "working_memories": [
    {
      "key": "snake_case_identifier",
      "value": "string value",
      "expires_in_hours": number (default 24)
    }
  ]
}
If there is no short-term context, return {"working_memories": []}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1 
    });

    const parsed = JSON.parse(response) as { working_memories: (Omit<WorkingMemory, 'id' | 'user_id' | 'created_at'> & { expires_in_hours?: number })[] };
    const wms = parsed.working_memories || [];
    
    if (wms.length > 0) {
      const wmInserts = wms.map(wm => {
        const expires = new Date();
        expires.setHours(expires.getHours() + (wm.expires_in_hours || 24));
        return {
          user_id: userId,
          key: wm.key,
          value: wm.value,
          expires_at: expires.toISOString()
        };
      });
      await supabaseAdmin.from('working_memory').insert(wmInserts);
    }
    
    return wms.length;
  }
}

export const workingMemoryAgent = new WorkingMemoryAgent();
