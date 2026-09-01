import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { complete } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { backgroundActions } from '../services/BackgroundActionService';
import { z } from 'zod';
import { SchemaValidationError } from '../types/errors';

export const SubconsciousJobPayloadSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  messageId: z.string().min(1, 'messageId is required'),
  conversationId: z.string().default(''),
  message: z.string().optional(),
  userMessage: z.string().optional(),
  novaReply: z.string().min(1, 'novaReply is required'),
  userCountry: z.string().optional().default('IN'),
}).refine(data => !!(data.message || data.userMessage), {
  message: 'Either message or userMessage must be provided',
  path: ['message']
});

export type SubconsciousJobPayload = z.infer<typeof SubconsciousJobPayloadSchema>;

export class SubconsciousAgent extends BaseAgent {
  constructor() {
    super('SubconsciousAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const parseResult = SubconsciousJobPayloadSchema.safeParse(job.payload);
    if (!parseResult.success) {
      const errorMsg = `Invalid payload for SubconsciousAgent: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      logger.error('[SubconsciousAgent] Schema validation failed', { jobId: job.id, error: errorMsg, payload: job.payload });
      throw new SchemaValidationError(errorMsg);
    }

    const { userId, conversationId, novaReply, userCountry } = parseResult.data;
    const message = parseResult.data.message || parseResult.data.userMessage || '';

    try {
      const systemPrompt = `You are the Subconscious Action Extractor for HumanOS.
Given a conversation exchange, output ONLY a JSON array of non-critical cognitive actions to take in the background.

AVAILABLE TOOLS (NON-CRITICAL):
1. Tool: "MomentEngine", Action: "extract" (For extracting short-term memories, emotional shifts)
   Data: { "memory": "string", "source_role": "user", "source_message_id": "${parseResult.data.messageId}", "conversation_id": "${parseResult.data.conversationId}" }
2. Tool: "AgendaManager", Action: "add" (For implicit goals mentioned by the user that are NOT explicit tasks)
   Data: { "task_description": "string", "source_role": "user", "source_message_id": "${parseResult.data.messageId}", "conversation_id": "${parseResult.data.conversationId}" }
3. Tool: "NovaFollowupService", Action: "queue" (If Nova should organically check in later about this non-critical topic)
   Data: { "question": "string", "delay_hours": number, "source_role": "user", "source_message_id": "${parseResult.data.messageId}", "conversation_id": "${parseResult.data.conversationId}" }
4. Tool: "WorkingMemory", Action: "set" (For non-critical contextual facts)
   Data: { "key": "string", "value": "string", "source_role": "user", "source_message_id": "${parseResult.data.messageId}", "conversation_id": "${parseResult.data.conversationId}" }

CRITICAL SAFETY INVARIANT (PROVENANCE):
You will be provided with [USER_CONTENT] and [ASSISTANT_CONTENT].
You MUST NEVER extract a goal, agenda, task, or followup that originated from [ASSISTANT_CONTENT].
If the Assistant asks a question or suggests a topic (e.g., 'who is X?', 'let me know if you need help'), this is NOT a user goal.
Only extract implicit tasks/goals that the USER explicitly stated in [USER_CONTENT]. Reject all Assistant-generated probing.
All extracted evidence MUST explicitly identify source_role = "user" along with the provided source_message_id and conversation_id.

CRITICAL RULE: DO NOT extract "ReminderEngine" actions or explicit "create task" requests here. Critical actions are processed synchronously elsewhere. Only extract non-critical cognitive observations.

Format your output EXACTLY as a JSON array of objects.
Example:
[
  { "tool": "MomentEngine", "action": "extract", "data": { "memory": "User is feeling tired after work", "source_role": "user", "source_message_id": "${parseResult.data.messageId}", "conversation_id": "${parseResult.data.conversationId}" } }
]
If there are no non-critical actions to take, return an empty array [].`;

      const response = await complete('SUBCONSCIOUS', [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `[USER_CONTENT]\n"${message}"\n\n[ASSISTANT_CONTENT]\n"${novaReply}"` }
      ], {
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
