import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion, EXTRACTION_MODEL } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { EpisodicMemory } from '../types/memory';

export class EpisodicAgent extends BaseAgent {
  constructor() {
    super('EpisodicAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { messageId, userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Episodic Memory Agent for HumanOS.
Analyze the user's message and extract events or experiences that just happened or were described as an event.

Return ONLY a valid JSON object with the exact key:
{
  "episodic_memories": [
    {
      "summary": "string describing the event",
      "emotion": "string (optional)",
      "emotional_valence": -10 to 10
    }
  ]
}
If there are no events to extract, return {"episodic_memories": []}.`
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

    const parsed = JSON.parse(response) as { episodic_memories: Omit<EpisodicMemory, 'id' | 'user_id' | 'created_at' | 'source_message_id'>[] };
    const eps = parsed.episodic_memories || [];
    
    if (eps.length > 0) {
      const epInserts = eps.map(ep => ({
        user_id: userId,
        summary: ep.summary,
        emotion: ep.emotion,
        emotional_valence: ep.emotional_valence,
        source_message_id: messageId
      }));
      await supabaseAdmin.from('episodic_memories').insert(epInserts);
    }
    
    return eps.length;
  }
}

export const episodicAgent = new EpisodicAgent();
