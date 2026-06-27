import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { EmotionalState } from '../types/memory';

export class EmotionalAgent extends BaseAgent {
  constructor() {
    super('EmotionalAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Emotional Agent for HumanOS.
Analyze the user's message and extract their current emotional state based on their phrasing and tone.

Return ONLY a valid JSON object:
{
  "emotional_state": {
    "mood": "string (e.g., happy, anxious, tired, neutral)",
    "intensity": 1-10,
    "notes": "brief explanation"
  }
}
If there is no clear emotional state, return {"emotional_state": null}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1 
    });

    const parsed = JSON.parse(response) as { emotional_state: Omit<EmotionalState, 'id' | 'user_id' | 'created_at'> | null };
    const emotion = parsed.emotional_state;
    
    if (emotion) {
      await supabaseAdmin.from('emotional_states').insert({
        user_id: userId,
        mood: emotion.mood,
        intensity: emotion.intensity,
        notes: emotion.notes
      });
      return 1;
    }
    
    return 0;
  }
}

export const emotionalAgent = new EmotionalAgent();
