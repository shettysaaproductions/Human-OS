import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export class ReflectionAgent extends BaseAgent {
  constructor() {
    super('ReflectionAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, date } = job.payload; // date format: YYYY-MM-DD
    
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0,0,0,0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23,59,59,999);

    // 1. Fetch Context for the day
    const [ { data: history }, { data: episodic }, { data: working } ] = await Promise.all([
      supabaseAdmin.from('chat_history').select('role, content, created_at').eq('user_id', userId).gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString()).order('created_at', { ascending: true }),
      supabaseAdmin.from('episodic_memories').select('summary, emotion').eq('user_id', userId).gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString()),
      supabaseAdmin.from('working_memory').select('key, value').eq('user_id', userId).gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString())
    ]);

    if (!history || history.length === 0) {
      logger.info('No chat history for reflection', { userId, date });
      return 0; // Nothing to reflect on
    }

    // 2. Build Prompt
    let contextStr = `--- CHAT HISTORY ---\n`;
    history.forEach(h => { contextStr += `[${new Date(h.created_at).toLocaleTimeString()}] ${h.role}: ${h.content}\n`; });
    
    if (episodic && episodic.length > 0) {
      contextStr += `\n--- EPISODIC MEMORIES (Events) ---\n`;
      episodic.forEach(e => { contextStr += `- ${e.summary} (Emotion: ${e.emotion})\n`; });
    }

    if (working && working.length > 0) {
      contextStr += `\n--- WORKING MEMORY (Tasks/Context) ---\n`;
      working.forEach(w => { contextStr += `- ${w.key}: ${w.value}\n`; });
    }

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are Nova's Reflection Engine. 
Your goal is to synthesize the user's day based on their interactions, extracting the core meaning, emotional state, and progress.

Return ONLY a valid JSON object:
{
  "reflection": "A 2-3 sentence summary of what happened today, what changed, and what was discussed.",
  "importance": 1-100 (How significant was this day for the user's long-term life/goals?),
  "emotional_summary": "A 1-sentence summary of their emotional arc today.",
  "goals_progress": "Any progress made toward known goals, or 'None noted'."
}`
      },
      {
        role: 'user',
        content: `Synthesize this day (${date}):\n\n${contextStr}`
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const parsed = JSON.parse(response) as { reflection: string, importance: number, emotional_summary: string, goals_progress: string };
    
    // 3. Save Reflection
    await supabaseAdmin.from('reflections').insert({
      user_id: userId,
      summary: parsed.reflection,
      importance: parsed.importance,
      emotional_summary: parsed.emotional_summary,
      goals_progress: parsed.goals_progress
    });
    
    // 4. Update conversation_sessions
    await supabaseAdmin.from('conversation_sessions').update({ summary: parsed.reflection, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('session_date', date);

    return 1;
  }
}

export const reflectionAgent = new ReflectionAgent();
