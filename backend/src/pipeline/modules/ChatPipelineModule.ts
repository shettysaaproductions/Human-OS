/**
 * ChatPipelineModule.ts — Standard Chat Capability Module (Phase 1)
 *
 * Exposes the standard Nova OS pipeline contract:
 * INPUT → PROCESSOR → OUTPUT → EVENTS EMITTED → MEMORY EFFECT → DEPENDENCIES → PERMISSIONS
 */

import { NovaPipelineModule, NovaModuleResult } from '../NovaPipelineModule';
import { NovaInputEvent } from '../NovaEvent';
import { NovaPipelineContext } from '../NovaContext';
import { contextualEntityResolver } from '../ContextualEntityResolver';
import { complete } from '../../lib/nvidia';
import { sanitizeReply, NOVA_EMPTY_REPLY } from '../../services/NovaBrainService';
import { logger } from '../../lib/logger';

export class ChatPipelineModule implements NovaPipelineModule {
  readonly name = 'ChatPipelineModule';
  readonly version = '1.0.0';
  readonly description = 'Conversational chat processor for text and voice-transcribed messages';
  readonly dependencies = ['MemoryReconciliationModule'];
  readonly requirements: {
    permissions?: string[];
    platformSupport?: ('server' | 'android' | 'ios')[];
    requiresAuth?: boolean;
  } = {
    requiresAuth: true,
    platformSupport: ['server', 'android', 'ios'],
  };

  canHandle(event: NovaInputEvent): boolean {
    return event.type === 'INPUT_TEXT' || event.type === 'INPUT_VOICE_NOTE';
  }

  async process(event: NovaInputEvent, context: NovaPipelineContext): Promise<NovaModuleResult> {
    const rawText = (event as any).payload?.rawText || '';
    if (!rawText.trim()) {
      return {
        success: true,
        output: { replyText: NOVA_EMPTY_REPLY },
        emittedEvents: [],
        memoryEffects: [],
      };
    }

    // 1. Contextual Entity & Reference Resolution
    const resolution = contextualEntityResolver.resolveTurn(rawText, context);

    // 2. Synthesize prompt with preserved entity context
    const isEnglish = context.userProfile?.language === 'en' || !/\b(hai|ho|kya|yaar|nahi)\b/i.test(rawText);
    const activeSubjectDesc = resolution.primarySubjectId !== 'user:self'
      ? `\nCurrent Conversation Subject: ${resolution.primarySubjectName} (${resolution.primarySubjectId})`
      : '';

    const systemPrompt = `You are Nova, an empathetic, warm personal AI companion.
Text like a friend on WhatsApp: natural, concise, zero robotic formalities.
${activeSubjectDesc}
Respond directly to what the user said.`;

    let reply = '';
    try {
      reply = await complete('USER_FAST', [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawText }
      ], { maxTokens: 512, temperature: 0.75 });
    } catch (err: any) {
      logger.warn('[ChatPipelineModule] LLM call fallback', { error: err.message });
      reply = isEnglish
        ? "Hmm... give me a moment to think, I'll text you right back in a bit."
        : "Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.";
    }

    const cleanReply = sanitizeReply(reply) || (isEnglish ? "I'm right here with you." : "Main yahin hoon yaar.");

    return {
      success: true,
      output: {
        replyText: cleanReply,
      },
      emittedEvents: [],
      memoryEffects: resolution.memoryEffects,
      contextUpdates: {
        entityFocus: resolution.updatedFocus,
      },
    };
  }
}

export const chatPipelineModule = new ChatPipelineModule();
