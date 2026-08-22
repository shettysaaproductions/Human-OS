import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { backgroundActions } from '../services/BackgroundActionService';

export class SubconsciousAgent extends BaseAgent {
  constructor() {
    super('SubconsciousAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, conversationId, message, novaReply, userCountry } = job.payload;

    try {
      const systemPrompt = `You are the Subconscious Action Extractor for HumanOS.
Given a conversation exchange, output ONLY a JSON array of non-critical cognitive actions to take in the background.

AVAILABLE TOOLS (NON-CRITICAL):
1. Tool: "MomentEngine", Action: "extract" (For extracting short-term memories, emotional shifts)
   Data: { "memory": "string (the observation)" }
2. Tool: "AgendaManager", Action: "add" (For implicit goals mentioned by the user that are NOT explicit tasks)
   Data: { "task_description": "string" }
3. Tool: "NovaFollowupService", Action: "queue" (If Nova should organically check in later about this non-critical topic)
   Data: { "question": "string", "delay_hours": number }
4. Tool: "WorkingMemory", Action: "set" (For non-critical contextual facts)
   Data: { "key": "string", "value": "string" }

CRITICAL RULE: DO NOT extract "ReminderEngine" actions or explicit "create task" requests here. Critical actions are processed synchronously elsewhere. Only extract non-critical cognitive observations.

Format your output EXACTLY as a JSON array of objects.
Example:
[
  { "tool": "MomentEngine", "action": "extract", "data": { "memory": "User is feeling tired after work" } }
]
If there are no non-critical actions to take, return an empty array [].`;

      const response = await chatCompletionBackground([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `User: "${message}"\nNova: "${novaReply}"` }
      ], {
        model: 'meta/llama-3.1-8b-instruct',
        maxTokens: 500,
        temperature: 0.1,
      });

      if (!response) {
        throw new Error('LLM returned empty response for subconscious extraction');
      }

      let jsonStr = response.trim();
      const match = jsonStr.match(/\[[\s\S]*\]/);
      if (match) {
        jsonStr = match[0];
      }

      const actions = JSON.parse(jsonStr);
      if (!Array.isArray(actions)) {
        throw new Error('Extracted actions is not an array');
      }

      if (actions.length > 0) {
        await backgroundActions.processActions(
          userId,
          conversationId,
          actions,
          userCountry
        ).catch(e => {
          logger.error('[SubconsciousAgent] Unhandled failure in processActions', { error: e });
        });
      }

      return actions.length;
    } catch (error) {
      logger.error('[SubconsciousAgent] Extraction failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export const subconsciousAgent = new SubconsciousAgent();
