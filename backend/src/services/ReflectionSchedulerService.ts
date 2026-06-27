import { supabaseAdmin } from '../lib/supabase';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';

/**
 * ReflectionSchedulerService
 *
 * Daily: Summarizes memories, emotions, goals for each user.
 * Weekly: Generates macro trends, achievements, insights.
 * Stores results in the 'reflections' table.
 */
export class ReflectionSchedulerService {
  /**
   * Run the daily reflection for a specific user.
   * Summarizes recent memories, emotions, and goals.
   */
  async runDailyReflection(userId: string): Promise<void> {
    logger.info('Running daily reflection', { userId });
    try {
      // 1. Fetch recent memories
      const { data: memories } = await supabaseAdmin
        .from('memories')
        .select('key, value, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(20);

      // 2. Fetch recent emotional states
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data: emotions } = await supabaseAdmin
        .from('emotional_states')
        .select('mood, intensity, notes, created_at')
        .eq('user_id', userId)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false });

      // 3. Fetch active goals
      const { data: goals } = await supabaseAdmin
        .from('kg_nodes')
        .select('name, attributes')
        .eq('user_id', userId)
        .eq('entity_type', 'goal');

      if ((!memories || memories.length === 0) && (!emotions || emotions.length === 0)) {
        logger.debug('No data to reflect on for user', { userId });
        return;
      }

      // 4. Check idempotency — only one daily reflection per user per day
      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabaseAdmin
        .from('reflections')
        .select('id')
        .eq('user_id', userId)
        .eq('reflection_type', 'daily')
        .gte('created_at', `${today}T00:00:00Z`)
        .maybeSingle();

      if (existing) {
        logger.debug('Daily reflection already exists for today', { userId });
        return;
      }

      // 5. Build LLM prompt
      const memorySummary = (memories || [])
        .map(m => `[${m.memory_type}] ${m.key}: ${m.value}`)
        .join('\n');
      const emotionSummary = (emotions || [])
        .map(e => `${e.mood} (${e.intensity}/10) - ${new Date(e.created_at).toLocaleDateString()}`)
        .join('\n');
      const goalSummary = (goals || [])
        .map(g => g.name)
        .join(', ');

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        {
          role: 'system',
          content: `You are Nova, a thoughtful AI companion. Generate a warm, insightful daily reflection summary for the user based on their memories, emotions, and goals. Be concise (2-3 sentences). Focus on patterns and growth. Do not invent facts. Respond in JSON: { "summary": "...", "key_takeaways": ["..."] }`
        },
        {
          role: 'user',
          content: `Recent memories:\n${memorySummary}\n\nRecent emotions:\n${emotionSummary}\n\nActive goals: ${goalSummary || 'none'}`
        }
      ];

      const raw = await chatCompletion(messages, { response_format: { type: 'json_object' }, maxTokens: 512 });

      let summary = 'Daily reflection completed.';
      let keyTakeaways: string[] = [];

      try {
        const parsed = JSON.parse(raw);
        summary = parsed.summary || summary;
        keyTakeaways = parsed.key_takeaways || [];
      } catch {
        summary = raw.trim().slice(0, 500);
      }

      // 6. Store reflection
      await supabaseAdmin.from('reflections').insert({
        user_id: userId,
        reflection_type: 'daily',
        summary,
        key_takeaways: keyTakeaways,
      });

      logger.info('Daily reflection stored', { userId });
    } catch (err) {
      logger.error('Failed daily reflection', { userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Run the weekly reflection for a specific user.
   * Generates macro trends, achievements, and insights.
   */
  async runWeeklyReflection(userId: string): Promise<void> {
    logger.info('Running weekly reflection', { userId });
    try {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      // Fetch the last 7 daily reflections as input
      const { data: dailyReflections } = await supabaseAdmin
        .from('reflections')
        .select('summary, key_takeaways, created_at')
        .eq('user_id', userId)
        .eq('reflection_type', 'daily')
        .gte('created_at', oneWeekAgo.toISOString())
        .order('created_at', { ascending: true });

      // Check idempotency
      const weekStart = oneWeekAgo.toISOString().split('T')[0];
      const { data: existing } = await supabaseAdmin
        .from('reflections')
        .select('id')
        .eq('user_id', userId)
        .eq('reflection_type', 'weekly')
        .gte('created_at', `${weekStart}T00:00:00Z`)
        .maybeSingle();

      if (existing) {
        logger.debug('Weekly reflection already exists for this week', { userId });
        return;
      }

      if (!dailyReflections || dailyReflections.length === 0) {
        logger.debug('No daily reflections to aggregate', { userId });
        return;
      }

      const dailySummaries = dailyReflections
        .map(r => `- ${r.summary}`)
        .join('\n');

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        {
          role: 'system',
          content: `You are Nova. Based on a user's daily reflections from the past week, generate a thoughtful weekly summary with macro trends, achievements, and forward-looking insights. Respond in JSON: { "summary": "...", "key_takeaways": ["trend1", "achievement1", "insight1"] }`
        },
        {
          role: 'user',
          content: `Daily reflections from the past week:\n${dailySummaries}`
        }
      ];

      const raw = await chatCompletion(messages, { response_format: { type: 'json_object' }, maxTokens: 768 });

      let summary = 'Weekly reflection completed.';
      let keyTakeaways: string[] = [];

      try {
        const parsed = JSON.parse(raw);
        summary = parsed.summary || summary;
        keyTakeaways = parsed.key_takeaways || [];
      } catch {
        summary = raw.trim().slice(0, 800);
      }

      await supabaseAdmin.from('reflections').insert({
        user_id: userId,
        reflection_type: 'weekly',
        summary,
        key_takeaways: keyTakeaways,
      });

      logger.info('Weekly reflection stored', { userId });
    } catch (err) {
      logger.error('Failed weekly reflection', { userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Runs daily reflections for all onboarded users.
   */
  async runDailyForAllUsers(): Promise<number> {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('onboarding_completed', true);

    let processed = 0;
    for (const profile of profiles || []) {
      await this.runDailyReflection(profile.id);
      processed++;
    }
    return processed;
  }

  /**
   * Runs weekly reflections for all onboarded users (call on Sundays).
   */
  async runWeeklyForAllUsers(): Promise<number> {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('onboarding_completed', true);

    let processed = 0;
    for (const profile of profiles || []) {
      await this.runWeeklyReflection(profile.id);
      processed++;
    }
    return processed;
  }
}

export const reflectionScheduler = new ReflectionSchedulerService();
