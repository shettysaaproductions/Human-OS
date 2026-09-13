/**
 * voiceService.ts — Nova Voice Mode API Client
 *
 * Handles all communication with the backend voice endpoints:
 *   POST /api/voice/session  → get ephemeral token + session config
 *   POST /api/voice/tool     → execute a tool call
 *   POST /api/voice/end      → submit transcript for processing
 */

import { api } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceSessionConfig {
  ephemeralToken: string;
  apiKey: string;
  expireTime: string;
  model: string;
  systemInstruction: string;
  tools: any[];
  voiceConfig: {
    voiceName: string;
    languageCode: string;
  };
  sessionConfig: {
    responseModalities: string[];
    inputAudioTranscription: Record<string, unknown>;
    outputAudioTranscription: Record<string, unknown>;
  };
}

export interface AvailableVoice {
  id: string;
  label: string;
  description: string;
}

export interface TranscriptEntry {
  role: 'user' | 'nova';
  text: string;
  timestamp?: string;
}

// ── Gemini Live WebSocket URL ──────────────────────────────────────────────────
// Direct connection — mobile connects here using the ephemeral token
export const GEMINI_LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// ── Service ───────────────────────────────────────────────────────────────────

export const voiceService = {

  /**
   * Start a voice session — fetches ephemeral token and all config
   * needed for the mobile client to connect directly to Gemini Live.
   */
  async startSession(options: {
    language?: 'en' | 'hi' | 'auto';
    voiceName?: string;
  } = {}): Promise<{ session: VoiceSessionConfig; availableVoices: AvailableVoice[] }> {
    const response = await api.post('/voice/session', {
      language: options.language || 'auto',
      voice_name: options.voiceName,
    });

    return {
      session: response.data.session,
      availableVoices: response.data.available_voices || [],
    };
  },

  /**
   * Execute a tool call from the Gemini Live session.
   * Mobile receives a function_call from Gemini, forwards it here,
   * then sends the result back to the WebSocket.
   */
  async executeTool(params: {
    toolName: string;
    toolArgs: Record<string, any>;
    sessionId?: string;
  }): Promise<any> {
    const response = await api.post('/voice/tool', {
      tool_name: params.toolName,
      tool_args: params.toolArgs,
      session_id: params.sessionId,
    });
    return response.data.result;
  },

  /**
   * Signal end of session — sends transcript for background processing
   * (memory extraction, watchtower, chat history save).
   */
  async endSession(params: {
    transcript: TranscriptEntry[];
    sessionId?: string;
    durationSeconds?: number;
  }): Promise<void> {
    await api.post('/voice/end', {
      transcript: params.transcript,
      session_id: params.sessionId,
      duration_seconds: params.durationSeconds || 0,
    });
  },
};
