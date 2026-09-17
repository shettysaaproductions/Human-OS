/**
 * NovaSharedContext.ts — Shared Conversational & Cognitive Context Fabric (Gate J / Phase 4 Bridge)
 *
 * ARCHITECTURAL INVARIANT:
 * Bridges cross-modal state between Chat, Voice, Tools, and Proactive systems:
 *   conversation turn → canonical entity focus change → shared context update → voice session consumes updated focus
 */

import { ContextEntity, EntityFocusState, ContextResolver } from './NovaContext';
import { logger } from '../lib/logger';
import { cognitiveEventBus } from '../lib/cognitiveEventBus';

export interface EntityFocusChangeEvent {
  userId: string;
  conversationId?: string;
  sessionId?: string;
  previousFocus: ContextEntity | null;
  newFocus: ContextEntity;
  domain?: string;
  source: 'chat' | 'voice_transcript' | 'tool_call' | 'proactive';
  timestamp: string;
}

export type FocusChangeListener = (event: EntityFocusChangeEvent) => Promise<void> | void;

export class NovaSharedContextManager {
  private static instance: NovaSharedContextManager;
  // userId -> sessionId -> listener
  private focusListeners: Map<string, Map<string, FocusChangeListener>> = new Map();
  // userId -> current EntityFocusState
  private currentFocus: Map<string, EntityFocusState> = new Map();

  static getInstance(): NovaSharedContextManager {
    if (!NovaSharedContextManager.instance) {
      NovaSharedContextManager.instance = new NovaSharedContextManager();
    }
    return NovaSharedContextManager.instance;
  }

  /**
   * Subscribe an active session (e.g. live voice WebSocket) to real-time entity focus shifts.
   */
  subscribeToFocus(userId: string, sessionId: string, listener: FocusChangeListener): () => void {
    if (!this.focusListeners.has(userId)) {
      this.focusListeners.set(userId, new Map());
    }
    this.focusListeners.get(userId)!.set(sessionId, listener);

    logger.debug('[NovaSharedContext] Subscribed session to focus changes', { userId, sessionId });

    return () => {
      this.unsubscribeFromFocus(userId, sessionId);
    };
  }

  /**
   * Unsubscribe session when closed or torn down.
   */
  unsubscribeFromFocus(userId: string, sessionId: string): void {
    const userMap = this.focusListeners.get(userId);
    if (userMap) {
      userMap.delete(sessionId);
      if (userMap.size === 0) {
        this.focusListeners.delete(userId);
      }
    }
    logger.debug('[NovaSharedContext] Unsubscribed session from focus changes', { userId, sessionId });
  }

  /**
   * Get current entity focus for a user.
   */
  getFocus(userId: string): EntityFocusState {
    return this.currentFocus.get(userId) || {
      activeEntity: null,
      activeDomain: null,
      recentEntities: [],
    };
  }

  /**
   * Shift entity focus and broadcast to all active sessions (voice proxy, chat, etc.).
   */
  async shiftFocus(
    userId: string,
    entity: ContextEntity,
    source: 'chat' | 'voice_transcript' | 'tool_call' | 'proactive',
    options?: { domain?: string; conversationId?: string; sessionId?: string }
  ): Promise<EntityFocusState> {
    const currentState = this.getFocus(userId);
    const previousFocus = currentState.activeEntity;

    const updatedState = ContextResolver.updateFocus(currentState, entity, options?.domain);
    this.currentFocus.set(userId, updatedState);

    const event: EntityFocusChangeEvent = {
      userId,
      conversationId: options?.conversationId,
      sessionId: options?.sessionId,
      previousFocus,
      newFocus: updatedState.activeEntity!,
      domain: updatedState.activeDomain || undefined,
      source,
      timestamp: new Date().toISOString(),
    };

    // Emit cognitive event for telemetry
    cognitiveEventBus.emit({
      eventType: 'entity_focus_changed',
      userId,
      timestamp: event.timestamp,
      data: {
        previousEntity: previousFocus?.name,
        newEntity: event.newFocus.name,
        entityType: event.newFocus.entityType,
        source,
      },
    });

    // Broadcast to registered listeners (e.g. live voice sessions)
    const userMap = this.focusListeners.get(userId);
    if (userMap && userMap.size > 0) {
      for (const [sId, listener] of userMap.entries()) {
        try {
          await listener(event);
        } catch (lErr: any) {
          logger.warn('[NovaSharedContext] Listener execution error', { userId, sessionId: sId, error: lErr.message });
        }
      }
    }

    return updatedState;
  }
}

export const novaSharedContext = NovaSharedContextManager.getInstance();
