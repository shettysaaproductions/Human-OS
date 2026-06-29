import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletion } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';

interface ExtractedShortTermMemory {
  shouldExtract: boolean;
  memory: string; // e.g. "Watched Family Man with wife"
  category: string;
  emotion: string | null;
  emotion_score: number; // 0-10
  confidence: number; // 0.0 - 1.0
  importance: number; // 1-10
  context_tags: any;
}

export class ShortTermMemoryAgent extends BaseAgent {
  constructor() {
    super('ShortTermMemoryAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { messageId, userId, message } = job.payload;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `You are the Short-Term Memory Agent for Nova.
Extract temporary memories from the user's message.
Focus on: people mentioned, events, emotions, ongoing tasks, and concerns.
Output heavily summarized fragments. 
Bad: "User said he watched Family Man season 1 with wife on Sunday."
Good: "Watched Family Man with wife."

Assign an emotion_score from 0 to 10 based on intensity. Examples:
- "wife kept fast for me" -> 9
- "office issue" -> 5
- "good morning" -> 1

Assign an importance score from 1 to 10 (10 = very important).
Assign a category from: [relationship, family, work, health, entertainment, finance, goals, preference, task, emotion, miscellaneous].
Assign a confidence score from 0.0 to 1.0.

Return ONLY a valid JSON object with the exact key:
{
  "short_term_memories": [
    {
      "shouldExtract": true,
      "memory": "Summarized fragment",
      "category": "work",
      "emotion": "joy, frustration, etc. or null",
      "emotion_score": 5,
      "confidence": 0.8,
      "importance": 5,
      "context_tags": {"category": "task"}
    }
  ]
}
If there are no meaningful short-term memories, return {"short_term_memories": []}.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1 
    });

    const parsed = JSON.parse(response) as { short_term_memories: ExtractedShortTermMemory[] };
    const memories = parsed.short_term_memories || [];
    
    let created = 0;
    let reinforced = 0;

    for (const mem of memories) {
      if (!mem.shouldExtract || !mem.memory) continue;

      const expiresAt = mem.importance >= 8 ? null : new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

      const { data: existing } = await supabaseAdmin
        .from('short_term_memories')
        .select('id, mention_count, importance')
        .eq('user_id', userId)
        .eq('memory', mem.memory)
        .maybeSingle();

      if (existing) {
        // Reinforce
        const newCount = (existing.mention_count || 1) + 1;
        const newImportance = Math.min(10, (existing.importance || mem.importance) + 1);
        await supabaseAdmin
          .from('short_term_memories')
          .update({
            mention_count: newCount,
            importance: newImportance,
            last_mentioned_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        reinforced++;
      } else {
        // Insert new
        await supabaseAdmin
          .from('short_term_memories')
          .insert({
            user_id: userId,
            memory: mem.memory,
            category: mem.category || 'miscellaneous',
            emotion: mem.emotion,
            emotion_score: mem.emotion_score,
            confidence: mem.confidence !== undefined ? mem.confidence : 0.5,
            importance: mem.importance,
            source_message_id: messageId,
            expires_at: expiresAt,
            context_tags: mem.context_tags
          });
        created++;
      }
    }
    
    // Safety check: max 500 memories per user
    const { count: totalMemories } = await supabaseAdmin
      .from('short_term_memories')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (totalMemories && totalMemories > 500) {
      const excess = totalMemories - 500;
      // Delete oldest non-important memories
      const { data: toDelete } = await supabaseAdmin
        .from('short_term_memories')
        .select('id')
        .eq('user_id', userId)
        .lt('importance', 8)
        .order('last_mentioned_at', { ascending: true })
        .limit(excess);
        
      if (toDelete && toDelete.length > 0) {
        const ids = toDelete.map(d => d.id);
        await supabaseAdmin
          .from('short_term_memories')
          .delete()
          .in('id', ids);
      }
    }

    if (created > 0) console.log(`Memories Created: ${created}`);
    if (reinforced > 0) console.log(`Memories Reinforced: ${reinforced}`);
    
    return created + reinforced;
  }
}

export const shortTermMemoryAgent = new ShortTermMemoryAgent();
