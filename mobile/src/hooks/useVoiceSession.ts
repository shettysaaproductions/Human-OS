/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * v0.3.14 — Bulletproof rewrite. Root causes fixed:
 *
 *   BUG 1 (v0.3.13 regression — Stuck at "Connecting"):
 *     setAudioModeAsync() can hang indefinitely on Android in expo-audio@56
 *     when called in the blocking permission path. Fixed by making it
 *     fire-and-forget (non-blocking).
 *
 *   BUG 2 (v0.3.12 — No audio heard):
 *     expo-audio@56 does NOT export AudioModule from its index. Using
 *     `require('expo-audio/build/AudioModule').default` to access AudioStream
 *     for raw 16kHz mono PCM mic streaming.
 *
 *   BUG 3 (v0.3.12 — No audio heard):
 *     createRecording() does not exist in expo-audio@56. The old code
 *     fell back to null and never recorded anything.
 *
 *   BUG 4 (v0.3.13 regression — Parsing):
 *     Added Blob/async parsing that broke simple text-frame parsing.
 *     Reverted to simple JSON.parse(event.data) which worked in v0.3.12.
 *
 *   BUG 5 (all versions — Hung connections):
 *     No connection timeout. A 12-second timeout now auto-errors.
 *
 *   BUG 6 (v0.3.12 — Playback queue deadlocks):
 *     Polling player.playing in setInterval could deadlock the queue.
 *     Fixed with event-driven addListener('playbackStatusUpdate') + hard fallback.
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

// AudioModule is NOT re-exported from expo-audio index.
// Access the native module directly so we can use AudioStream.
let NativeAudioModule: any = null;
try {
  NativeAudioModule = require('expo-audio/build/AudioModule').default;
} catch {
  console.warn('[VoiceSession] expo-audio/build/AudioModule not accessible — mic streaming disabled');
}

// ── Base64 & WAV helpers ──────────────────────────────────────────────────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

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

/**
 * float32 ArrayBuffer (from AudioStream) → int16 base64.
 * Gemini Live requires audio/pcm;rate=16000 (int16 little-endian).
 */
function float32ToInt16Base64(buffer: ArrayBuffer): string {
  const float32 = new Float32Array(buffer);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return uint8ToBase64(new Uint8Array(int16.buffer));
}

/**
 * Gemini sends 24kHz int16 PCM. Prepend a WAV header so createAudioPlayer
 * can decode it via ExoPlayer (Android) or AVAudioPlayer (iOS).
 */
function pcmToWavBase64(pcmBase64: string, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): string {
  const pcmBytes = base64ToUint8(pcmBase64);
  const dataLen = pcmBytes.length;
  const wav = new Uint8Array(44 + dataLen);
  const v = new DataView(wav.buffer);
  v.setUint32(0,  0x52494646, false); // "RIFF"
  v.setUint32(4,  36 + dataLen, true);
  v.setUint32(8,  0x57415645, false); // "WAVE"
  v.setUint32(12, 0x666d7420, false); // "fmt "
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  v.setUint16(32, (numChannels * bitsPerSample) / 8, true);
  v.setUint16(34, bitsPerSample, true);
  v.setUint32(36, 0x64617461, false); // "data"
  v.setUint32(40, dataLen, true);
  wav.set(pcmBytes, 44);
  return uint8ToBase64(wav);
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

  const wsRef           = useRef<WebSocket | null>(null);
  const sessionIdRef    = useRef<string>(`voice_${Date.now()}`);
  const sessionStartRef = useRef<number>(0);
  const audioStreamRef  = useRef<any>(null);
  const audioQueueRef   = useRef<string[]>([]);
  const isPlayingRef    = useRef(false);
  const mutedRef        = useRef(false);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  // ── Audio Permissions ──────────────────────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    if (!ExpoAudio) {
      setErrorMessage('Voice mode requires a native build. Please install the APK.');
      return false;
    }
    try {
      // FIX BUG 1: requestRecordingPermissionsAsync is a top-level export in expo-audio@56
      const { granted } = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMessage('Microphone permission is required for voice mode');
        return false;
      }

      // FIX BUG 1: setAudioModeAsync is FIRE-AND-FORGET — never await it.
      // On some Android devices in expo-audio@56, awaiting this hangs indefinitely
      // when the audio focus changes conflict with an active media session.
      // We don't need to await it — the permission grant is sufficient to record.
      ExpoAudio.setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      }).catch((err: any) => {
        // Non-fatal — log and continue
        console.warn('[VoiceSession] setAudioModeAsync failed (non-fatal):', err?.message);
      });

      return true;
    } catch (err: any) {
      setErrorMessage(`Microphone permission error: ${err?.message || 'unknown'}`);
      return false;
    }
  }, []);

  // ── Mic Streaming (AudioStream API) ──────────────────────────────────────

  const startMicStream = useCallback(() => {
    // FIX BUG 2: AudioModule is NOT exported from expo-audio index.
    // Must require 'expo-audio/build/AudioModule' directly.
    if (!NativeAudioModule?.AudioStream) {
      console.warn('[VoiceSession] AudioStream not available — mic streaming disabled');
      return;
    }

    try {
      // Raw PCM stream at 16kHz mono float32
      // (We convert to int16 before sending to Gemini Live)
      const stream = new NativeAudioModule.AudioStream({
        sampleRate: 16000,
        channels: 1,
        encoding: 'float32',
      });

      stream.addListener('audioStreamBuffer', (buffer: any) => {
        if (mutedRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!buffer?.data) return;

        try {
          const int16b64 = float32ToInt16Base64(buffer.data as ArrayBuffer);
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: int16b64 }],
            },
          }));
        } catch (e: any) {
          console.warn('[VoiceSession] PCM encode error:', e?.message);
        }
      });

      stream.start().then(() => {
        console.log('[VoiceSession] AudioStream started successfully (16kHz mono float32→int16)');
      }).catch((err: any) => {
        console.warn('[VoiceSession] AudioStream.start() failed:', err?.message);
      });

      audioStreamRef.current = stream;
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
    if (!ExpoAudio?.createAudioPlayer) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const base64Audio = audioQueueRef.current.shift()!;
    try {
      // Wrap Gemini's 24kHz int16 PCM in a WAV container
      const wavBase64 = pcmToWavBase64(base64Audio, 24000, 1, 16);
      const player = ExpoAudio.createAudioPlayer({ uri: `data:audio/wav;base64,${wavBase64}` });

      // FIX BUG 6: Use event-driven completion detection instead of polling
      let done = false;
      const markDone = () => {
        if (done) return;
        done = true;
        isPlayingRef.current = false;
        try { sub?.remove(); } catch (_) {}
        try { player.remove?.(); } catch (_) {}
        playNextChunk();
      };

      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) markDone();
      });

      player.play();

      // Hard fallback: if events never fire, poll for completion
      const poll = setInterval(() => {
        if (!player.playing && (player.currentTime ?? 0) > 0) {
          clearInterval(poll);
          markDone();
        }
      }, 150);

      // Safety ceiling: 30s max per chunk (very generous for any audio)
      setTimeout(() => {
        clearInterval(poll);
        markDone();
      }, 30000);

    } catch (err: any) {
      console.warn('[VoiceSession] Playback error:', err?.message);
      isPlayingRef.current = false;
      playNextChunk();
    }
  }, []);

  // ── WebSocket Message Handler ──────────────────────────────────────────────

  const handleWsMessage = useCallback((event: MessageEvent) => {
    // FIX BUG 4: Use simple synchronous JSON.parse — same as v0.3.12 which worked.
    // React Native WebSocket sends text frames as plain strings.
    // No async Blob handling needed here.
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn('[VoiceSession] WS message not valid JSON, skipping');
      return;
    }
    if (!data) return;

    // 1. setupComplete — Gemini Live is ready for audio
    if (data.setupComplete !== undefined) {
      console.log('[VoiceSession] ✅ setupComplete received — transitioning to listening');
      clearConnectTimer();
      setState('listening');
      startMicStream();
      return;
    }

    // 2. Audio response chunks from Gemini
    if (data.serverContent?.modelTurn?.parts) {
      setState('speaking');
      for (const part of data.serverContent.modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          audioQueueRef.current.push(part.inlineData.data);
          playNextChunk();
        }
        if (part.text) {
          setTranscript(prev => [
            ...prev,
            { role: 'nova', text: part.text, timestamp: new Date().toISOString() },
          ]);
        }
      }
    }

    // 3. User speech transcription
    if (data.serverContent?.inputTranscription?.text) {
      const userText = data.serverContent.inputTranscription.text;
      if (userText.trim()) {
        setState('processing');
        setTranscript(prev => [
          ...prev,
          { role: 'user', text: userText, timestamp: new Date().toISOString() },
        ]);
      }
    }

    // 4. Turn complete
    if (data.serverContent?.turnComplete) {
      setState('listening');
    }

    // 5. Tool calls from Gemini Live
    if (data.toolCall?.functionCalls) {
      for (const fnCall of data.toolCall.functionCalls) {
        voiceService.executeTool({
          toolName: fnCall.name,
          toolArgs: fnCall.args || {},
          sessionId: sessionIdRef.current,
        }).then(result => {
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
        }).catch((err: any) => {
          console.warn('[VoiceSession] Tool failed:', fnCall.name, err?.message);
        });
      }
    }
  }, [clearConnectTimer, playNextChunk, startMicStream]);

  // ── Session Lifecycle ──────────────────────────────────────────────────────

  const startSession = useCallback(async (voiceNameOverride?: string) => {
    const voiceName = voiceNameOverride || selectedVoice;
    setErrorMessage(null);
    setState('connecting');
    setTranscript([]);
    audioQueueRef.current = [];
    isPlayingRef.current  = false;
    mutedRef.current      = false;
    sessionIdRef.current  = `voice_${Date.now()}`;
    sessionStartRef.current = Date.now();

    // FIX BUG 5: 12-second hard timeout — prevents infinite "Connecting to Nova..."
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      stopMicStream();
      setErrorMessage('Connection timed out — please check your internet and try again');
      setState('error');
    }, 12000);

    const hasPermission = await requestAudioPermissions();
    if (!hasPermission) {
      clearConnectTimer();
      setState('error');
      return;
    }

    try {
      console.log('[VoiceSession] Fetching session config from backend...');
      const { session, availableVoices: voices } = await voiceService.startSession({ voiceName });
      sessionIdRef.current = session.ephemeralToken ? `voice_${Date.now()}` : sessionIdRef.current;
      setAvailableVoices(voices);
      console.log('[VoiceSession] Session config received. Model:', session.model, 'Voice:', session.voiceConfig.voiceName);

      const wsUrl = `${GEMINI_LIVE_WS_URL}?key=${session.apiKey}`;
      console.log('[VoiceSession] Opening WebSocket to Gemini Live...');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[VoiceSession] WebSocket opened — sending setup frame');
        ws.send(JSON.stringify({
          setup: {
            model: session.model,
            systemInstruction: { parts: [{ text: session.systemInstruction }] },
            tools: session.tools,
            generationConfig: {
              responseModalities: session.sessionConfig.responseModalities,
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: session.voiceConfig.voiceName },
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
        console.error('[VoiceSession] WebSocket error:', err);
        clearConnectTimer();
        setErrorMessage('Connection error — please try again');
        setState('error');
      };

      ws.onclose = (event) => {
        console.log('[VoiceSession] WebSocket closed:', event.code, event.reason || '(no reason)');
        clearConnectTimer();
        stopMicStream();
        if (event.code !== 1000 && event.code !== 1005) {
          setErrorMessage(`Connection closed (${event.code})`);
          setState('error');
        }
      };

    } catch (err: any) {
      clearConnectTimer();
      console.error('[VoiceSession] startSession failed:', err?.message);
      setErrorMessage(err?.message || 'Failed to start voice session');
      setState('error');
    }
  }, [selectedVoice, requestAudioPermissions, handleWsMessage, clearConnectTimer, stopMicStream]);

  const endSession = useCallback(async () => {
    clearConnectTimer();
    setState('idle');
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);
    stopMicStream();

    if (wsRef.current) {
      try { wsRef.current.close(1000, 'user ended session'); } catch (_) {}
      wsRef.current = null;
    }

    if (transcript.length > 0) {
      voiceService.endSession({
        transcript,
        sessionId: sessionIdRef.current,
        durationSeconds: duration,
      }).catch(err => console.warn('[VoiceSession] endSession failed:', err?.message));
    }
  }, [transcript, stopMicStream, clearConnectTimer]);

  const mute = useCallback(() => {
    mutedRef.current = true;
    setIsMuted(true);
  }, []);

  const unmute = useCallback(() => {
    mutedRef.current = false;
    setIsMuted(false);
    // Restart mic stream if it died while muted
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
      clearConnectTimer();
      try { wsRef.current?.close(); } catch (_) {}
      stopMicStream();
    };
  }, [stopMicStream, clearConnectTimer]);

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
