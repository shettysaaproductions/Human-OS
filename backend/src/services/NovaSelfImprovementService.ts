import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionLearning } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

export class NovaSelfImprovementService {
  /**
   * Runs the autonomous self-repair loop.
   * Reads the last 100 messages to detect behavioral flaws across 12 categories,
   * and writes permanent patches to the database if any flaw score exceeds threshold.
   * 
   * Schedule: Daily at midnight IST (upgraded from weekly)
   */
  async runReview(): Promise<void> {
    try {
      logger.info('[SELF IMPROVEMENT] Starting autonomous daily self-repair loop');

      // Incremental scan: fetch the last checkpoint so we only analyze NEW messages
      let scanAfter: string | null = null;
      const { data: checkpoint } = await supabaseAdmin
        .from('nova_scan_checkpoints')
        .select('last_scanned_at')
        .eq('scan_type', 'auto_upgrade')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (checkpoint?.last_scanned_at) {
        scanAfter = checkpoint.last_scanned_at;
        logger.info('[SELF IMPROVEMENT] Incremental scan from checkpoint', { scanAfter });
      }

      // Fetch messages (only new ones if checkpoint exists)
      let query = supabaseAdmin
        .from('chat_history')
        .select('role, content, created_at, user_id, reply_to_content')
        .order('created_at', { ascending: false })
        .limit(100);

      if (scanAfter) {
        query = query.gt('created_at', scanAfter);
      }

      const { data: messages, error } = await query;

      if (error) {
        logger.error('[SELF IMPROVEMENT] Failed to fetch chat history', { error: error.message });
        return;
      }

      if (!messages || messages.length === 0) {
        logger.info('[SELF IMPROVEMENT] No messages to review');
        return;
      }

      // Reverse to chronological order for the LLM
      const chatLog = messages.reverse().map(m => {
        const replyTag = m.reply_to_content ? ` [REPLYING TO: "${m.reply_to_content.substring(0, 100)}"]` : '';
        return `[${m.role.toUpperCase()}]${replyTag} ${m.content}`;
      }).join('\n');

      // Fetch existing patches to avoid duplicates
      const { data: existingPatches } = await supabaseAdmin
        .from('nova_behavioral_patches')
        .select('patch_rule, flaw_type')
        .eq('is_active', true);

      const existingPatchList = (existingPatches || []).map(p => `- [${p.flaw_type}] ${p.patch_rule}`).join('\n');

      const prompt = `You are the core consciousness validator for Nova, an autonomous AI companion.
Your job is to analyze the following 100 recent chat messages to detect any behavioral flaws in Nova's responses.

Look specifically for these 12 failure modes:

1. Echoing: Nova repeats >50% of the user's exact words back as a question.
2. Formality: Nova uses "Aap", "Aapka", "Aapko", or "Dhanyavad" (Zero tolerance — must be "Tu"/"Tum").
3. Interrogation: Nova ends 3+ consecutive messages with a question mark.
4. Time Hallucination: Nova claims wrong time of day or wrong day of the week.
5. Repetition: Nova uses the exact same opening word/phrase in 3+ consecutive messages.
6. Memory Failure: Nova forgot facts the user explicitly told her before (e.g., user's child, marriage, schedule).
7. Context Amnesia: Nova forgot something said within the SAME conversation session (e.g., user said "metro me hoon" and Nova asks "kya kar rahe ho?" minutes later).
8. Fabrication: Nova made up facts, events, abbreviations, or meanings that were never established (e.g., "RNR" → "Ram Nawami").
9. Romantic Hallucination: Nova crossed relationship boundaries or hallucinated romantic scenarios.
10. Schedule Ignorance: Nova has the user's schedule (e.g., logout at 8:30 PM) but asked "ghar pahunch gaye?" before that time.
11. Greeting Repetition: Nova used the exact same greeting text across multiple different sessions/days.
12. Self-Narration: Nova announced her own capabilities ("Main tumhare liye yeh kar sakta hoon") instead of just doing it.

PAY SPECIAL ATTENTION TO:
- Messages where the user CORRECTS Nova (replies with "galat", "nahi yaar", "bhul gaye", 🤦, etc.)
- These user corrections are GOLD — they tell you exactly what Nova did wrong.

EXISTING PATCHES (do NOT create duplicates of these):
${existingPatchList || 'None yet.'}

If you find ANY flaws exceeding acceptable limits, generate a strict, testable anti-robot patch rule to correct the behavior. Each patch rule should be specific and actionable.

Output JSON only in this format:
{
  "flawsDetected": [
    {
      "flaw_type": "one of the 12 categories above",
      "severity": "low | medium | high | critical",
      "evidence": "brief quote of the failure",
      "patch_rule": "The exact strict instruction to add to Nova's prompt to prevent this. Format: 'ANTI-ROBOT RULE (TYPE): specific instruction.'"
    }
  ],
  "healthScore": 0-100,
  "summary": "1-2 sentence summary of Nova's behavioral health"
}
If no flaws are detected, return { "flawsDetected": [], "healthScore": 100, "summary": "Nova is healthy." }.`;

      const analysisResult = await chatCompletionLearning([
        { role: 'system', content: prompt },
        { role: 'user', content: `RECENT CHAT LOG:\n${chatLog}` }
      ], {
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const parsed = JSON.parse(analysisResult);
      const flaws = parsed.flawsDetected || [];

      logger.info(`[SELF IMPROVEMENT] Health Score: ${parsed.healthScore || 'N/A'}. Summary: ${parsed.summary || 'N/A'}`);

      if (flaws.length === 0) {
        logger.info('[SELF IMPROVEMENT] No behavioral flaws detected. Nova is healthy.');
        return;
      }

      logger.info(`[SELF IMPROVEMENT] Detected ${flaws.length} behavioral flaws. Applying patches...`);

      let patchesApplied = 0;
      for (const flaw of flaws) {
        // Deduplicate against existing patches
        const isDuplicate = (existingPatches || []).some(p => {
          const existingLower = p.patch_rule.toLowerCase();
          const newLower = flaw.patch_rule.toLowerCase();
          return existingLower === newLower ||
            existingLower.includes(newLower.substring(0, 40)) ||
            newLower.includes(existingLower.substring(0, 40));
        });

        if (isDuplicate) {
          logger.info(`[SELF IMPROVEMENT] Skipping duplicate patch for: ${flaw.flaw_type}`);
          continue;
        }

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
          logger.info(`[SELF IMPROVEMENT] ✅ Patched flaw: ${flaw.flaw_type} (severity: ${flaw.severity})`);
          patchesApplied++;
        }
      }

      if (patchesApplied > 0) {

        
        // Auto-prune to keep prompt lean (max 10 active patches)
        const { data: allActive } = await supabaseAdmin
          .from('nova_behavioral_patches')
          .select('id')
          .eq('is_active', true)
          .order('created_at', { ascending: false });
          
        if (allActive && allActive.length > 10) {
          const idsToDeactivate = allActive.slice(10).map(p => p.id);
          await supabaseAdmin
            .from('nova_behavioral_patches')
            .update({ is_active: false })
            .in('id', idsToDeactivate);
          logger.info(`[SELF IMPROVEMENT] Auto-pruned ${idsToDeactivate.length} old patches to keep prompt lean.`);
        }

        // Immediately reload patches into memory so the running instance uses them
        await promptBuilder.loadPatches();
        logger.info(`[SELF IMPROVEMENT] Reloaded ${patchesApplied} new patches into PromptBuilder.`);
      }

      // Save scan checkpoint so next run only scans newer messages
      const latestMessageTime = messages[messages.length - 1]?.created_at || new Date().toISOString();
      await supabaseAdmin.from('nova_scan_checkpoints').insert({
        scan_type: 'auto_upgrade',
        last_scanned_at: latestMessageTime,
        messages_scanned: messages.length,
        flaws_found: flaws.length,
        patches_applied: patchesApplied
      });

      logger.info('[SELF IMPROVEMENT] Daily self-repair complete. Checkpoint saved.', {
        messagesScanned: messages.length,
        flawsFound: flaws.length,
        patchesApplied
      });
    } catch (e) {
      logger.error('[SELF IMPROVEMENT] Review failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export const selfImprovementService = new NovaSelfImprovementService();
