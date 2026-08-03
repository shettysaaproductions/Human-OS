import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionLearning } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

/**
 * NovaRealtimeLearningService — Learn from User Corrections in Real-Time
 * 
 * When a user replies to a specific Nova message with a correction (e.g., "ye galat hai",
 * "aisa mat bol", 🤦), this service:
 * 1. Detects the correction intent
 * 2. Uses LLM to analyze what went wrong
 * 3. Generates a behavioral patch
 * 4. Writes it to nova_behavioral_patches IMMEDIATELY
 * 5. Reloads patches so the running instance uses them
 * 6. Logs the correction for founder review
 */
export class NovaRealtimeLearningService {

  // Signals that indicate the user is correcting/criticizing Nova
  private static readonly CORRECTION_SIGNALS_HI = [
    'galat', 'galat hai', 'ye galat', 'aisa mat', 'aisa nahi', 'nahi yaar',
    'bhul gaye', 'yaad nai', 'yaad nahi', 'bhul gaya', 'kya bol raha',
    'kya bol rahe', 'pagal hai', 'bewakoof', 'chutiya', 'dimag nai hai',
    'samajh nahi', 'samjha nahi', 'sun nahi', 'suna nahi', 'maine bola tha',
    'maine kaha tha', 'bataya tha', 'bola tha', 'pehle bola tha',
    'tum bhul gaye', 'tune bhul', 'yaad kar', 'yaad rakho',
    'aisa mat karo', 'dobara mat', 'fir se mat', 'band karo',
    'chup', 'mat bolo', 'bakwas', 'faltu', 'bekar',
    'i told you', 'i said', 'leave that', 'not like that'
  ];

  private static readonly CORRECTION_SIGNALS_EN = [
    'wrong', 'that\'s wrong', 'not right', 'incorrect', 'no that\'s',
    'don\'t say', 'stop saying', 'you forgot', 'you missed',
    'i already told', 'i said', 'i told you', 'remember when',
    'that\'s not what', 'you\'re wrong', 'not what i meant',
    'pay attention', 'listen', 'read again', 'look again',
    'terrible', 'awful', 'bad response', 'useless'
  ];

  private static readonly CORRECTION_EMOJIS = ['🤦', '🤦‍♂️', '🤦‍♀️', '😡', '😤', '🙄', '👎', '😑'];

  /**
   * Analyzes whether a user message that replies to a Nova message is a correction.
   * If so, generates and applies a behavioral patch in real-time.
   * 
   * This should be called as a BACKGROUND (non-blocking) task from the chat route.
   */
  async analyzeCorrection(
    userId: string,
    userMessage: string,
    originalNovaMessage: string
  ): Promise<void> {
    try {
      // Step 1: Quick local check — is this likely a correction?
      if (!this._isLikelyCorrection(userMessage)) {
        return; // Not a correction, skip LLM call entirely
      }

      logger.info('[REALTIME LEARNING] Correction signal detected, analyzing...', {
        userId,
        userMessage: userMessage.substring(0, 100),
        originalNovaMessage: originalNovaMessage.substring(0, 100)
      });

      // Step 2: Use LLM to deeply analyze the correction and generate a patch
      const analysisPrompt = `You are the self-improvement engine for Nova, an AI companion.

A user REPLIED to one of Nova's messages with what appears to be a correction or criticism.

NOVA'S ORIGINAL MESSAGE:
"${originalNovaMessage}"

USER'S REPLY (CORRECTION):
"${userMessage}"

Analyze this exchange carefully:

1. Is the user actually correcting Nova's behavior? (Yes/No)
2. If yes, what exact behavioral flaw did Nova exhibit? Categorize it:
   - Memory Failure: Nova forgot something the user told her before
   - Context Amnesia: Nova forgot something said in this same conversation
   - Fabrication: Nova made up facts, events, meanings, or abbreviations
   - Time Hallucination: Nova got the time/day wrong
   - Formality: Nova used formal Hindi (Aap/Dhanyavad)
   - Echoing: Nova parroted the user's words back
   - Interrogation: Nova asked too many questions
   - Romantic Hallucination: Nova crossed relationship boundaries
   - Schedule Ignorance: Nova didn't use known schedule data
   - Self-Narration: Nova announced her capabilities instead of acting
   - Other: Describe the flaw
3. Generate a specific, strict anti-robot patch rule to prevent this exact mistake.

Output JSON only:
{
  "isCorrection": boolean,
  "flawType": "string",
  "severity": "low | medium | high | critical",
  "evidence": "Brief quote of the failure",
  "patchRule": "ANTI-ROBOT RULE (TYPE): Specific instruction to prevent this. Keep under 200 chars.",
  "explanation": "What Nova did wrong and why the patch fixes it (1 sentence)"
}

If this is NOT a correction (just normal conversation), return:
{ "isCorrection": false }`;

      const result = await chatCompletionLearning([
        { role: 'system', content: analysisPrompt },
        { role: 'user', content: 'Analyze the above correction and generate a patch.' }
      ], {
        response_format: { type: 'json_object' },
        temperature: 0.1,
        maxTokens: 512
      });

      let cleanResult = result.trim();
      if (cleanResult.startsWith('```json')) cleanResult = cleanResult.replace(/^```json/, '').replace(/```$/, '').trim();
      else if (cleanResult.startsWith('```')) cleanResult = cleanResult.replace(/^```/, '').replace(/```$/, '').trim();
      
      const parsed = JSON.parse(cleanResult);

      if (!parsed.isCorrection) {
        logger.info('[REALTIME LEARNING] LLM determined this is not a correction. Skipping.');
        return;
      }

      // Step 3: Check for duplicate patches (don't write the same rule twice)
      const { data: existingPatches } = await supabaseAdmin
        .from('nova_behavioral_patches')
        .select('patch_rule')
        .eq('is_active', true);

      const isDuplicate = (existingPatches || []).some(p => {
        const existingLower = p.patch_rule.toLowerCase();
        const newLower = parsed.patchRule.toLowerCase();
        // Check for high overlap
        return existingLower === newLower ||
          existingLower.includes(newLower.substring(0, 50)) ||
          newLower.includes(existingLower.substring(0, 50));
      });

      if (isDuplicate) {
        logger.info('[REALTIME LEARNING] Similar patch already exists. Logging correction only.');
      } else {
        // Step 4: Write the patch to the permanent behavioral patches table
        const { error: insertError } = await supabaseAdmin
          .from('nova_behavioral_patches')
          .insert({
            patch_rule: parsed.patchRule,
            flaw_type: parsed.flawType,
            severity: parsed.severity,
            source_log: `User Correction:\nNova: ${originalNovaMessage}\nUser: ${userMessage}`,
            is_active: true
          });

        if (insertError) {
          logger.error('[REALTIME LEARNING] Failed to insert patch', { error: insertError.message });
        } else {
          logger.info('[REALTIME LEARNING] Successfully injected real-time patch!');
          // Reload patches in memory
          await promptBuilder.loadPatches();
        }
      }

      // Step 5: INJECT APOLOGY FLAG! 
      // We must immediately insert an active flag into working_memory so Nova apologizes in her next message.
      await supabaseAdmin.from('working_memory').upsert({
        user_id: userId,
        key: 'correction_apology_required',
        value: `The user just corrected you for: ${parsed.flawType}. You MUST explicitly acknowledge this mistake in your very next message. CRITICAL: Evaluate the seriousness of the user and context. If they are serious/stressed, apologize sincerely and concisely so they can stay productive. If they are casual, apologize playfully (e.g. 'Oh shit my bad 😂'). Match their energy perfectly.`,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // Expires in 5 minutes
      }, { onConflict: 'user_id,key' });
      logger.info('[REALTIME LEARNING] Injected apology_required flag into working_memory');

      // Step 6: Log the correction for founder review (always, even if patch is duplicate)
      // Note: nova_corrections_log schema: id, user_id, original_nova_message, user_correction,
      //        detected_flaw_type, generated_patch, patch_applied, created_at
      await supabaseAdmin.from('nova_corrections_log').insert({
        user_id: userId,
        original_nova_message: originalNovaMessage.substring(0, 2000),
        user_correction: userMessage.substring(0, 2000),
        detected_flaw_type: parsed.flawType,
        generated_patch: parsed.patchRule,
        patch_applied: !isDuplicate
      });

      logger.info('[REALTIME LEARNING] Correction logged to audit trail.', {
        userId,
        flawType: parsed.flawType,
        patchApplied: !isDuplicate
      });

    } catch (err) {
      // This is a non-critical background task — never crash the chat flow
      logger.error('[REALTIME LEARNING] Analysis failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Fast local heuristic to detect if a message is likely a correction.
   * This saves LLM calls by filtering out obvious non-corrections.
   */
  private _isLikelyCorrection(message: string): boolean {
    const lower = message.toLowerCase().trim();

    // Check correction emojis
    for (const emoji of NovaRealtimeLearningService.CORRECTION_EMOJIS) {
      if (message.includes(emoji)) return true;
    }

    // Check Hindi correction signals
    for (const signal of NovaRealtimeLearningService.CORRECTION_SIGNALS_HI) {
      if (lower.includes(signal)) return true;
    }

    // Check English correction signals
    for (const signal of NovaRealtimeLearningService.CORRECTION_SIGNALS_EN) {
      if (lower.includes(signal)) return true;
    }

    return false;
  }
}

export const novaRealtimeLearning = new NovaRealtimeLearningService();
