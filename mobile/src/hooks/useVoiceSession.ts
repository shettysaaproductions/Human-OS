/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * Manages the full lifecycle of a Gemini Live voice session using the correct
 * expo-audio@56 APIs:
 *
 *   INPUT (Mic → Gemini Live):
 *     - Uses AudioStream for real-time raw PCM capture (int16, 16kHz, mono)
 *     - Each buffer callback fires ~20ms of audio → sent directly to WS as base64
 *     - No file I/O, no polling, no compressed format issues
 *
 *   OUTPUT (Gemini Live → Speaker):
 *     - Gemini sends 24kHz int16 PCM chunks in base64
 *     - We prepend a 44-byte WAV RIFF header and pass as data-URI to createAudioPlayer
 *     - Players are queued and played sequentially via addListener(PLAYBACK_STATUS_UPDATE)
 *
 *   API Fixes from expo-audio@56:
 *     - requestRecordingPermissionsAsync() — top-level export (not ExpoAudio.*)
 *     - setAudioModeAsync() — top-level export, takes { allowsRecording, playsInSilentMode }
 *     - AudioStream — new native streaming API for raw PCM mic capture
 *     - createAudioPlayer(source) — creates an unmanaged AudioPlayer (usable outside hooks)
 *     - player.addListener('playbackStatusUpdate', cb) — event-driven completion detection
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  voiceService,
  VoiceSessionConfig,
  AvailableVoice,
  TranscriptEntry,
  GEMINI_LIVE_WS_URL,
} from '../services/voiceService';

// ── Dynamic imports — guard against missing native modules ───────────────────
let ExpoAudio: any = null;
try {
  ExpoAudio = require('expo-audio');
} catch {
  console.warn('[VoiceSession] expo-audio not available — voice mode disabled');
}

// ── Base64 & WAV Container Helpers ────────────────────────────────────────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const byteLen = (len * 3) >> 2;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const enc1 = B64_LOOKUP[clean.charCodeAt(i)];
    const enc2 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const enc3 = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const enc4 = B64_LOOKUP[clean.charCodeAt(i + 3)];
    bytes[p++] = (enc1 << 2) | (enc2 >> 4);
    if (i + 2 < len) bytes[p++] = ((enc2 & 15) << 4) | (enc3 >> 2);
    if (i + 3 < len) bytes[p++] = ((enc3 & 3) << 6) | enc4;
  }
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let b64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    b64 += B64_CHARS[b0 >> 2];
    b64 += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    b64 += i + 1 < len ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    b64 += i + 2 < len ? B64_CHARS[b2 & 63] : '=';
  }
  return b64;
}

/**
 * Convert a float32 ArrayBuffer (from AudioStream) to int16 PCM base64.
 * Gemini Live expects audio/pcm;rate=16000 (int16 little-endian).
 */
function float32BufferToInt16Base64(buffer: ArrayBuffer): string {
  const float32 = new Float32Array(buffer);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return uint8ToBase64(new Uint8Array(int16.buffer));
}

/**
 * If Gemini sends int16 PCM base64, convert it to float32 for AudioStream playback.
 * For createAudioPlayer we need a WAV container.
 */
function pcmToWavBase64(pcmBase64: string, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): string {
  const pcmBytes = base64ToUint8(pcmBase64);
  const dataLen = pcmBytes.length;
  const wavBytes = new Uint8Array(44 + dataLen);
  const view = new DataView(wavBytes.buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLen, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLen, true);
  wavBytes.set(pcmBytes, 44);

  return uint8ToBase64(wavBytes);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface UseVoiceSessionReturn {
  state: VoiceSessionState;
  transcript: TranscriptEntry[];
  availableVoices: AvailableVoice[];
  selectedVoice: string;
  errorMessage: string | null;
  startSession: (voiceName?: string) => Promise<void>;
  endSession: () => Promise<void>;
  mute: () => void;
  unmute: () => void;
  isMuted: boolean;
  selectVoice: (voiceId: string) => void;
  isNativeAvailable: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceSession(): UseVoiceSessionReturn {
  const [state, setState] = useState<VoiceSessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [availableVoices, setAvailableVoices] = useState<AvailableVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('Kore');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isNativeAvailable = ExpoAudio !== null;

  const wsRef = useRef<WebSocket | null>(null);
  const sessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const sessionIdRef = useRef<string>(`voice_${Date.now()}`);
  const sessionStartRef = useRef<number>(0);

  // Audio stream (mic → Gemini)
  const audioStreamRef = useRef<any>(null);

  // Playback queue
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const mutedRef = useRef(false);

  // ── Audio Permissions & Mode Setup ───────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    if (!ExpoAudio) {
      setErrorMessage('Voice mode requires a native build. Please install the APK from the Play Store.');
      return false;
    }
    try {
      // Use the correct expo-audio@56 top-level export
      const { granted } = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMessage('Microphone permission required for voice mode');
        return false;
      }

      // Set audio mode using expo-audio@56 API
      await ExpoAudio.setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: false,
      });

      return true;
    } catch (err: any) {
      setErrorMessage(`Audio setup failed: ${err?.message || 'unknown error'}`);
      return false;
    }
  }, []);

  // ── Mic Streaming (AudioStream API) ──────────────────────────────────────

  const startMicStream = useCallback(() => {
    if (!ExpoAudio?.AudioModule) {
      console.warn('[VoiceSession] AudioModule not available for streaming');
      return;
    }
    try {
      // Create a raw PCM audio stream at 16kHz mono int16 (Gemini Live requirement)
      const stream = new ExpoAudio.AudioModule.AudioStream({
        sampleRate: 16000,
        channels: 1,
        encoding: 'float32', // capture float32, we'll convert to int16 for Gemini
      });

      stream.addListener('audioStreamBuffer', (buffer: any) => {
        if (mutedRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!buffer?.data) return;

        try {
          // Convert float32 PCM → int16 base64 for Gemini Live
          const base64Chunk = float32BufferToInt16Base64(buffer.data);
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{
                mimeType: 'audio/pcm;rate=16000',
                data: base64Chunk,
              }],
            },
          }));
        } catch (e: any) {
          console.warn('[VoiceSession] Stream buffer encode error:', e?.message);
        }
      });

      stream.start().catch((err: any) => {
        console.warn('[VoiceSession] AudioStream start failed:', err?.message);
      });

      audioStreamRef.current = stream;
      console.log('[VoiceSession] AudioStream started (16kHz, mono, float32→int16)');
    } catch (err: any) {
      console.warn('[VoiceSession] AudioStream creation failed:', err?.message);
    }
  }, []);

  const stopMicStream = useCallback(() => {
    if (audioStreamRef.current) {
      try { audioStreamRef.current.stop(); } catch (_) {}
      audioStreamRef.current = null;
    }
  }, []);

  // ── Audio Playback Queue ──────────────────────────────────────────────────

  const playNextChunk = useCallback(async () => {
    if (!ExpoAudio) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const base64Audio = audioQueueRef.current.shift()!;
    try {
      if (ExpoAudio.createAudioPlayer) {
        // Wrap Gemini's 24kHz int16 PCM in a WAV container so ExoPlayer can decode it
        const wavBase64 = pcmToWavBase64(base64Audio, 24000, 1, 16);
        const wavDataUri = `data:audio/wav;base64,${wavBase64}`;
        const player = ExpoAudio.createAudioPlayer({ uri: wavDataUri });

        // Use event listener to detect completion — more reliable than polling .playing
        const subscription = player.addListener('playbackStatusUpdate', (status: any) => {
          // didJustFinish fires once when playback completes
          if (status.didJustFinish || (!status.isLoaded && !status.isBuffering)) {
            subscription?.remove();
            isPlayingRef.current = false;
            try { player.remove?.(); } catch (_) {}
            // Play next chunk in queue
            playNextChunk();
          }
        });

        player.play();

        // Fallback: if status events never fire (some Android configs), poll duration
        const fallbackCheck = setTimeout(async () => {
          if (isPlayingRef.current) {
            try {
              if (!player.playing) {
                subscription?.remove();
                isPlayingRef.current = false;
                try { player.remove?.(); } catch (_) {}
                playNextChunk();
              }
            } catch (_) {}
          }
        }, 10000); // 10s hard fallback

        // Also detect playback start so we can clear fallback when we know it's playing
        const startCheck = setInterval(() => {
          if (player.playing || player.currentTime > 0) {
            clearInterval(startCheck);
            // Clear the hard fallback — rely on events from now on
            clearTimeout(fallbackCheck);
          }
        }, 100);

        // Safety: if player never started at all (load error), clear after 3s
        setTimeout(() => {
          clearInterval(startCheck);
        }, 3000);

      } else {
        // expo-audio not available for playback
        isPlayingRef.current = false;
      }
    } catch (err: any) {
      console.warn('[VoiceSession] Playback failed:', err?.message);
      isPlayingRef.current = false;
      playNextChunk();
    }
  }, []);

  // ── WebSocket Message Handler ──────────────────────────────────────────────

  const handleWsMessage = useCallback(async (event: MessageEvent) => {
    let data: any;
    try {
      // Handle both string and Blob payloads (React Native WS sends Blob)
      let rawStr = event.data;
      if (rawStr && typeof rawStr.text === 'function') {
        rawStr = await rawStr.text();
      }
      data = JSON.parse(rawStr);
    } catch {
      return;
    }

    // 1. Google Live setup complete confirmation
    if (data.setupComplete) {
      console.log('[VoiceSession] Gemini Live setupComplete received — starting mic stream');
      setState('listening');
      startMicStream();
      return;
    }

    // 2. Audio response chunk from Gemini Live
    if (data.serverContent?.modelTurn?.parts) {
      setState('speaking');
      for (const part of data.serverContent.modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          audioQueueRef.current.push(part.inlineData.data);
          playNextChunk();
        }
        if (part.text) {
          setTranscript(prev => [...prev, { role: 'nova', text: part.text, timestamp: new Date().toISOString() }]);
        }
      }
    }

    // 3. Transcription of user speech (inputTranscription)
    if (data.serverContent?.inputTranscription?.text) {
      const userText = data.serverContent.inputTranscription.text;
      if (userText.trim()) {
        setState('processing');
        setTranscript(prev => [...prev, { role: 'user', text: userText, timestamp: new Date().toISOString() }]);
      }
    }

    // 4. Turn complete — return to listening
    if (data.serverContent?.turnComplete) {
      setState('listening');
    }

    // 5. Tool / function calls from Gemini Live
    if (data.toolCall?.functionCalls) {
      for (const fnCall of data.toolCall.functionCalls) {
        try {
          const result = await voiceService.executeTool({
            toolName: fnCall.name,
            toolArgs: fnCall.args || {},
            sessionId: sessionIdRef.current,
          });

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              toolResponse: {
                functionResponses: [{
                  id: fnCall.id,
                  name: fnCall.name,
                  response: { output: result },
                }],
              },
            }));
          }
        } catch (err: any) {
          console.warn('[VoiceSession] Tool execution failed:', fnCall.name, err?.message);
        }
      }
    }
  }, [playNextChunk, startMicStream]);

  // ── Session Lifecycle ──────────────────────────────────────────────────────

  const startSession = useCallback(async (voiceNameOverride?: string) => {
    const voiceName = voiceNameOverride || selectedVoice;
    setErrorMessage(null);
    setState('connecting');
    setTranscript([]);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    sessionIdRef.current = `voice_${Date.now()}`;
    sessionStartRef.current = Date.now();

    const hasPermission = await requestAudioPermissions();
    if (!hasPermission) {
      setState('error');
      return;
    }

    try {
      const { session, availableVoices: voices } = await voiceService.startSession({ voiceName });
      sessionConfigRef.current = session;
      setAvailableVoices(voices);

      const wsUrl = `${GEMINI_LIVE_WS_URL}?key=${session.apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[VoiceSession] WebSocket opened, sending setup...');
        ws.send(JSON.stringify({
          setup: {
            model: session.model,
            systemInstruction: {
              parts: [{ text: session.systemInstruction }],
            },
            tools: session.tools,
            generationConfig: {
              responseModalities: session.sessionConfig.responseModalities,
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: session.voiceConfig.voiceName,
                  },
                },
              },
            },
            inputAudioTranscription: session.sessionConfig.inputAudioTranscription,
            outputAudioTranscription: session.sessionConfig.outputAudioTranscription,
          },
        }));
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (err) => {
        console.error('[VoiceSession] WebSocket error', err);
        setErrorMessage('Connection error — please try again');
        setState('error');
      };

      ws.onclose = (event) => {
        console.log('[VoiceSession] WebSocket closed', event.code, event.reason);
        stopMicStream();
        if (event.code !== 1000 && event.code !== 1005) {
          setErrorMessage(`Live connection closed (${event.code}${event.reason ? ': ' + event.reason : ''})`);
          setState('error');
        }
      };

    } catch (err: any) {
      console.error('[VoiceSession] Failed to start:', err?.message);
      setErrorMessage(err?.message || 'Failed to start voice session');
      setState('error');
    }
  }, [selectedVoice, requestAudioPermissions, handleWsMessage, stopMicStream]);

  const endSession = useCallback(async () => {
    setState('idle');
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    stopMicStream();

    if (wsRef.current) {
      try { wsRef.current.close(1000, 'user ended session'); } catch (_) {}
      wsRef.current = null;
    }

    const currentTranscript = transcript;
    if (currentTranscript.length > 0) {
      voiceService.endSession({
        transcript: currentTranscript,
        sessionId: sessionIdRef.current,
        durationSeconds: duration,
      }).catch(err => console.warn('[VoiceSession] End session failed:', err?.message));
    }
  }, [transcript, stopMicStream]);

  const mute = useCallback(() => {
    mutedRef.current = true;
    setIsMuted(true);
    // Don't stop the stream — just gate the sends via mutedRef
  }, []);

  const unmute = useCallback(() => {
    mutedRef.current = false;
    setIsMuted(false);
    // If stream isn't running (e.g. was stopped), restart it
    if (!audioStreamRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      startMicStream();
    }
  }, [startMicStream]);

  const selectVoice = useCallback((voiceId: string) => {
    setSelectedVoice(voiceId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch (_) {}
      stopMicStream();
    };
  }, [stopMicStream]);

  return {
    state,
    transcript,
    availableVoices,
    selectedVoice,
    errorMessage,
    startSession,
    endSession,
    mute,
    unmute,
    isMuted,
    selectVoice,
    isNativeAvailable,
  };
}
