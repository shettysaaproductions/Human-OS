import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

export class NovaSelfImprovementService {
  /**
   * Runs the autonomous self-repair loop.
   * Reads the last 100 messages to detect behavioral flaws, and writes permanent
   * patches to the database if any flaw score exceeds the threshold.
   */
  async runReview(): Promise<void> {
    try {
      logger.info('[SELF IMPROVEMENT] Starting autonomous weekly self-repair loop');

      // Fetch last 100 messages (both user and assistant)
      const { data: messages, error } = await supabaseAdmin
        .from('chat_history')
        .select('role, content, created_at, user_id')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        logger.error('[SELF IMPROVEMENT] Failed to fetch chat history', { error: error.message });
        return;
      }

      if (!messages || messages.length === 0) {
        logger.info('[SELF IMPROVEMENT] No messages to review');
        return;
      }

      // Group messages by user (for context if needed, but we can analyze collectively for now)
      // Reverse to chronological order for the LLM
      const chatLog = messages.reverse().map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n');

      const prompt = `You are the core consciousness validator for Nova, an autonomous AI companion.
Your job is to analyze the following 100 recent chat messages to detect any behavioral flaws in Nova's responses.

Look specifically for these 5 failure modes:
1. Echoing: Nova repeats >50% of the user's exact words back as a question.
2. Formality: Nova uses "Aap", "Aapka", or "Aapko" (Zero tolerance — must be "Tu"/"Tum").
3. Interrogation: Nova ends 3+ consecutive messages with a question mark.
4. Time Hallucination: Nova claims time passed or hallucinated a time of day without evidence.
5. Repetition: Nova uses the exact same opening word/phrase in 3+ consecutive messages.

If you find ANY of these flaws exceeding acceptable limits, you must generate a strict, testable anti-robot patch rule to correct the behavior.

Output JSON only in this format:
{
  "flawsDetected": [
    {
      "flaw_type": "Echoing | Formality | Interrogation | Time Hallucination | Repetition",
      "severity": "low | medium | high | critical",
      "evidence": "brief quote of the failure",
      "patch_rule": "The exact strict instruction to add to Nova's prompt to prevent this. Format: '- ANTI-ROBOT RULE (TYPE): specific instruction.'"
    }
  ]
}
If no flaws are detected, return { "flawsDetected": [] }.`;

      const analysisResult = await chatCompletionBackground([
        { role: 'system', content: prompt },
        { role: 'user', content: `RECENT CHAT LOG:\n${chatLog}` }
      ], {
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const parsed = JSON.parse(analysisResult);
      const flaws = parsed.flawsDetected || [];

      if (flaws.length === 0) {
        logger.info('[SELF IMPROVEMENT] No behavioral flaws detected this week. Nova is healthy.');
        return;
      }

      logger.info(`[SELF IMPROVEMENT] Detected ${flaws.length} behavioral flaws. Applying patches...`);

      for (const flaw of flaws) {
        // Write the patch to the permanent memory table
        const { error: insertError } = await supabaseAdmin
          .from('nova_behavioral_patches')
          .insert({
            patch_rule: flaw.patch_rule,
            flaw_type: flaw.flaw_type,
            severity: flaw.severity
          });

        if (insertError) {
          logger.error('[SELF IMPROVEMENT] Failed to write patch to DB', { error: insertError.message, flaw });
        } else {
          logger.info(`[SELF IMPROVEMENT] Successfully patched flaw: ${flaw.flaw_type}`);
        }
      }

      // Immediately reload patches into memory so the running instance uses them
      await promptBuilder.loadPatches();

      logger.info('[SELF IMPROVEMENT] Weekly self-repair complete.');
    } catch (e) {
      logger.error('[SELF IMPROVEMENT] Weekly review failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export const selfImprovementService = new NovaSelfImprovementService();
