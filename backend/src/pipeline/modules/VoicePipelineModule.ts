/**
 * VoicePipelineModule.ts — Live Voice Capability Module (Phase 1)
 *
 * Implements the standard Nova OS pipeline contract for Gemini Live bidirectional voice.
 * Connects voice tool invocations and live turns to the canonical memory model and event pipeline.
 */

import { NovaPipelineModule, NovaModuleResult, MemoryEffect } from '../NovaPipelineModule';
import { NovaInputEvent } from '../NovaEvent';
import { NovaPipelineContext } from '../NovaContext';
import { novaVoiceService } from '../../services/NovaVoiceService';
import { contextualEntityResolver } from '../ContextualEntityResolver';
import { logger } from '../../lib/logger';

export class VoicePipelineModule implements NovaPipelineModule {
  readonly name = 'VoicePipelineModule';
  readonly version = '1.0.0';
  readonly description = 'Live bidirectional voice session turn and tool execution processor';
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
    return event.type === 'INPUT_LIVE_VOICE_TURN';
  }

  async process(event: NovaInputEvent, context: NovaPipelineContext): Promise<NovaModuleResult> {
    const payload = (event as any).payload;
    const memoryEffects: MemoryEffect[] = [];

    // ── Case A: Tool Call from Gemini Live (save_memory, memory_tree_create, etc.)
    if (payload?.turnType === 'tool_call' && payload.toolName) {
      const toolName = payload.toolName;
      const toolArgs = payload.toolArgs || {};

      try {
        const result = await novaVoiceService.executeTool(context.userId, toolName, toolArgs);

        // Map voice tool call to standard memory effects
        if (toolName === 'save_memory' && toolArgs.key && toolArgs.value) {
          memoryEffects.push({
            kind: 'ATTRIBUTE',
            action: 'update',
            subjectEntityId: 'user:self',
            subjectEntityName: context.userProfile?.preferredName || 'User',
            predicate: String(toolArgs.key),
            value: String(toolArgs.value),
            provenance: event.provenance,
            confidence: 0.95,
          });
        } else if (toolName === 'memory_tree_create' && toolArgs.entity_name) {
          memoryEffects.push({
            kind: 'ENTITY',
            action: 'create',
            subjectEntityId: `entity:person_${String(toolArgs.entity_name).toLowerCase()}`,
            subjectEntityName: String(toolArgs.entity_name),
            domainKey: toolArgs.domain ? String(toolArgs.domain) : 'family',
            relationType: toolArgs.relation_type ? String(toolArgs.relation_type) : 'Friend',
            provenance: event.provenance,
            confidence: 0.95,
          });
        }

        return {
          success: true,
          output: {
            toolResults: [{ toolName, args: toolArgs, result }],
          },
          emittedEvents: [],
          memoryEffects,
        };
      } catch (toolErr: any) {
        logger.error('[VoicePipelineModule] Tool execution failure', {
          toolName,
          error: toolErr.message,
          userId: context.userId,
        });
        return {
          success: false,
          error: { code: 'VOICE_TOOL_ERROR', message: toolErr.message, recoverable: true },
          emittedEvents: [],
          memoryEffects: [],
        };
      }
    }

    // ── Case B: Live Voice Transcript Turn
    const transcript = payload?.transcript || '';
    if (transcript.trim()) {
      const resolution = contextualEntityResolver.resolveTurn(transcript, context);
      return {
        success: true,
        output: {
          replyText: `Transcribed speech: ${transcript}`,
        },
        emittedEvents: [],
        memoryEffects: resolution.memoryEffects,
        contextUpdates: {
          entityFocus: resolution.updatedFocus,
        },
      };
    }

    return {
      success: true,
      emittedEvents: [],
      memoryEffects: [],
    };
  }
}

export const voicePipelineModule = new VoicePipelineModule();
