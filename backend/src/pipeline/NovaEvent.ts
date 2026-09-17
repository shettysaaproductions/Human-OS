/**
 * NovaEvent.ts — Canonical Event Model for Nova OS (Phase 1 Foundation)
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ONE BRAIN: All meaningful inputs (Chat, Voice, Memory, Goals, Reminders, Galaxy,
 *    Autonomous Proactive Pulses) enter the system as typed NovaEvents.
 * 2. FACT / EVENT / ENTITY DISTINCTION: Discriminated classification distinguishing:
 *    ENTITY, ATTRIBUTE, RELATIONSHIP, EVENT, OBSERVATION, INFERENCE, UNKNOWN.
 * 3. PROVENANCE + CONFIDENCE: Every event and extracted knowledge unit retains:
 *    source, timestamp, evidence/provenance, confidence, and acquisitionMode
 *    (user_stated, observed, derived, inferred).
 */

import crypto from 'crypto';

/**
 * Fundamental ontological classification for knowledge and understanding.
 * Prevents words, verbs, or temporal dates from turning into phantom bubbles.
 */
export type FactOrEntityKind =
  | 'ENTITY'        // Discrete subject with identity (Person, Pet, Organization, Place, Venture)
  | 'ATTRIBUTE'     // Property or state describing an entity (occupation, city, birth_date)
  | 'RELATIONSHIP'  // Directed semantic link between entities (father_of, married_to, works_for)
  | 'EVENT'         // Temporal occurrence with time, date, and actions (meeting, flight, celebration)
  | 'OBSERVATION'   // Raw sensor, voice tone, typing cadence, or platform signal
  | 'INFERENCE'     // Derived hypothesis or machine-generated deduction
  | 'UNKNOWN';      // Unclassified candidate staged for clarification

/**
 * Acquisition mode: how knowledge or signal entered Nova's awareness.
 */
export type AcquisitionMode =
  | 'user_stated'   // Explicitly stated by the user in conversation or text
  | 'observed'      // Directly observed via camera, microphone tone, device sensors
  | 'derived'       // Deterministically computed from rules, timestamps, or presence
  | 'inferred';     // Deducted by LLM reasoning or proactive cognitive engines

/**
 * Strict provenance record attached to every event and memory unit.
 */
export interface NovaProvenance {
  source:
    | 'chat'
    | 'voice_note'
    | 'live_voice'
    | 'vision'
    | 'device_sensor'
    | 'system_cron'
    | 'user_explicit'
    | 'llm_inferred'
    | 'watchtower_audit';
  sourceMessageId?: string;
  sourceEventId?: string;
  timestamp: string;          // ISO-8601 UTC
  confidence: number;         // 0.0 to 1.0
  acquisitionMode: AcquisitionMode;
  evidenceText?: string;      // Verbatim utterance or raw payload that triggered this fact
}

/**
 * Universal Event Types across all Nova OS channels.
 */
export type NovaEventType =
  // User Ingress Inputs
  | 'INPUT_TEXT'               // Normal chat message
  | 'INPUT_VOICE_NOTE'         // Transcribed WhatsApp-style voice note
  | 'INPUT_LIVE_VOICE_TURN'    // Gemini Live bidirectional voice turn or tool execution
  | 'INPUT_VISION'             // Photo or camera snap shared by user
  | 'INPUT_USER_ACTION'        // Button click, pill option selected, close button tapped
  // Autonomous & Internal Triggers
  | 'TRIGGER_PROACTIVE'        // NACE consciousness pulse, left-on-read follow-up
  | 'TRIGGER_REMINDER'         // Scheduled alarm/reminder due
  | 'TRIGGER_MOMENT'           // Daily moment engine reflection
  // Device & Platform Signals
  | 'SIGNAL_PRESENCE'          // App foreground, background, screen lock, idle
  | 'SIGNAL_DEVICE_STATE'      // Battery, network, proximity, audio routing
  | 'SIGNAL_LIFECYCLE'         // App startup, shutdown, update installed
  // Memory & State Operations
  | 'MEMORY_RECONCILE'         // Reconcile, merge, or validate graph entities/facts
  | 'GOAL_MUTATION';           // Goal create, update, or resolve

/**
 * Base envelope for any event inside Nova OS.
 */
export interface NovaEventBase {
  eventId: string;
  type: NovaEventType;
  userId: string;
  conversationId?: string;
  correlationId: string;       // Traces multi-step operations across engines
  timestamp: string;           // ISO-8601 UTC
  provenance: NovaProvenance;
}

/**
 * Payload: Text or Voice-Transcribed Message.
 */
export interface InputTextPayload {
  rawText: string;
  clientMessageId?: string;
  replyToId?: string;
  replyToContent?: string;
  language?: 'en' | 'hi' | 'auto';
  isVoiceTranscribed?: boolean;
  audioDurationSec?: number;
  imageDescription?: string;
}

/**
 * Payload: Live Voice Turn or Tool Call.
 */
export interface InputLiveVoicePayload {
  sessionId: string;
  turnType: 'transcript' | 'tool_call' | 'interruption';
  transcript?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  audioBase64?: string;
}

/**
 * Payload: Vision / Camera Snap.
 */
export interface InputVisionPayload {
  imageBase64?: string;
  imageUri?: string;
  detectedObjects?: string[];
  sceneDescription?: string;
  userCaption?: string;
}

/**
 * Payload: User Action / Option Tap.
 */
export interface InputUserActionPayload {
  actionName: string;
  targetId?: string;
  selectedOption?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Payload: Presence & Device Signals.
 */
export interface SignalPresencePayload {
  status: 'online' | 'away' | 'offline' | 'typing';
  isAppForeground: boolean;
  isScreenLocked: boolean;
  networkType?: 'wifi' | 'cellular' | 'none';
  batteryLevel?: number;
  isCharging?: boolean;
}

/**
 * Payload: Proactive / Autonomous Trigger.
 */
export interface TriggerProactivePayload {
  triggerReason: 'silence_nudge' | 'left_on_read' | 'curiosity_blueprint' | 'reflection_moment' | 'time_capsule';
  urgency: 'low' | 'medium' | 'high';
  suggestedTopic?: string;
  targetEntityId?: string;
}

/**
 * Discriminated union of all Input Events entering the unified pipeline.
 */
export type NovaInputEvent =
  | (NovaEventBase & { type: 'INPUT_TEXT'; payload: InputTextPayload })
  | (NovaEventBase & { type: 'INPUT_VOICE_NOTE'; payload: InputTextPayload })
  | (NovaEventBase & { type: 'INPUT_LIVE_VOICE_TURN'; payload: InputLiveVoicePayload })
  | (NovaEventBase & { type: 'INPUT_VISION'; payload: InputVisionPayload })
  | (NovaEventBase & { type: 'INPUT_USER_ACTION'; payload: InputUserActionPayload })
  | (NovaEventBase & { type: 'SIGNAL_PRESENCE'; payload: SignalPresencePayload })
  | (NovaEventBase & { type: 'TRIGGER_PROACTIVE'; payload: TriggerProactivePayload })
  | (NovaEventBase & { type: 'MEMORY_RECONCILE'; payload: { memoryEffects: unknown[] } });

/**
 * Event Factory Helpers.
 */
export class NovaEventFactory {
  static createInputText(params: {
    userId: string;
    conversationId?: string;
    rawText: string;
    clientMessageId?: string;
    replyToId?: string;
    replyToContent?: string;
    language?: 'en' | 'hi' | 'auto';
    isVoiceNote?: boolean;
    audioDurationSec?: number;
    imageDescription?: string;
    correlationId?: string;
  }): NovaInputEvent {
    const now = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;
    const correlationId = params.correlationId || params.clientMessageId || `corr_${crypto.randomUUID()}`;

    return {
      eventId,
      type: params.isVoiceNote ? 'INPUT_VOICE_NOTE' : 'INPUT_TEXT',
      userId: params.userId,
      conversationId: params.conversationId,
      correlationId,
      timestamp: now,
      provenance: {
        source: params.isVoiceNote ? 'voice_note' : 'chat',
        sourceMessageId: params.clientMessageId,
        sourceEventId: eventId,
        timestamp: now,
        confidence: 1.0,
        acquisitionMode: 'user_stated',
        evidenceText: params.rawText,
      },
      payload: {
        rawText: params.rawText,
        clientMessageId: params.clientMessageId,
        replyToId: params.replyToId,
        replyToContent: params.replyToContent,
        language: params.language,
        isVoiceTranscribed: params.isVoiceNote,
        audioDurationSec: params.audioDurationSec,
        imageDescription: params.imageDescription,
      },
    };
  }

  static createLiveVoiceTurn(params: {
    userId: string;
    sessionId: string;
    turnType: 'transcript' | 'tool_call' | 'interruption';
    transcript?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    correlationId?: string;
  }): NovaInputEvent {
    const now = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;

    return {
      eventId,
      type: 'INPUT_LIVE_VOICE_TURN',
      userId: params.userId,
      correlationId: params.correlationId || `live_${crypto.randomUUID()}`,
      timestamp: now,
      provenance: {
        source: 'live_voice',
        sourceEventId: eventId,
        timestamp: now,
        confidence: 0.95,
        acquisitionMode: 'user_stated',
        evidenceText: params.transcript || (params.toolName ? `Tool: ${params.toolName}` : undefined),
      },
      payload: {
        sessionId: params.sessionId,
        turnType: params.turnType,
        transcript: params.transcript,
        toolName: params.toolName,
        toolArgs: params.toolArgs,
      },
    };
  }

  static createProactiveTrigger(params: {
    userId: string;
    reason: TriggerProactivePayload['triggerReason'];
    urgency?: TriggerProactivePayload['urgency'];
    suggestedTopic?: string;
    targetEntityId?: string;
    correlationId?: string;
  }): NovaInputEvent {
    const now = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;

    return {
      eventId,
      type: 'TRIGGER_PROACTIVE',
      userId: params.userId,
      correlationId: params.correlationId || `pro_${crypto.randomUUID()}`,
      timestamp: now,
      provenance: {
        source: 'system_cron',
        sourceEventId: eventId,
        timestamp: now,
        confidence: 0.85,
        acquisitionMode: 'inferred',
      },
      payload: {
        triggerReason: params.reason,
        urgency: params.urgency || 'medium',
        suggestedTopic: params.suggestedTopic,
        targetEntityId: params.targetEntityId,
      },
    };
  }

  static createPresenceSignal(params: {
    userId: string;
    status: 'online' | 'away' | 'offline' | 'typing';
    isAppForeground: boolean;
    isScreenLocked?: boolean;
    networkType?: 'wifi' | 'cellular' | 'none';
  }): NovaInputEvent {
    const now = new Date().toISOString();
    const eventId = `evt_${crypto.randomUUID()}`;

    return {
      eventId,
      type: 'SIGNAL_PRESENCE',
      userId: params.userId,
      correlationId: `sig_${crypto.randomUUID()}`,
      timestamp: now,
      provenance: {
        source: 'device_sensor',
        sourceEventId: eventId,
        timestamp: now,
        confidence: 1.0,
        acquisitionMode: 'observed',
      },
      payload: {
        status: params.status,
        isAppForeground: params.isAppForeground,
        isScreenLocked: params.isScreenLocked ?? false,
        networkType: params.networkType,
      },
    };
  }
}
