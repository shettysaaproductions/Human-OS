/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * Manages the full lifecycle of a Gemini Live voice session:
 *   1. Fetches session config (ephemeral token) from backend
 *   2. Opens WebSocket directly to Google Gemini Live
 *   3. Sends initial setup and waits for setupComplete from Google
 *   4. Records mic audio via expo-audio and streams non-overlapping PCM chunks
 *   5. Receives 24kHz PCM chunks, wraps them in WAV headers, and plays them via expo-audio
 *   6. Handles tool calls → dispatches to backend → sends result back
 *   7. Builds transcript and sends it to backend on session end
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

let FileSystem: any = null;
try {
  FileSystem = require('expo-file-system');
} catch {
  // Non-fatal
}

// ── Base64 & WAV Container Helper (for 24kHz PCM Playback) ───────────────────
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
 * Prepend a valid 44-byte WAV header to raw 16-bit PCM so ExoPlayer/MediaPlayer can play it.
 */
function pcmToWavBase64(pcmBase64: string, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): string {
  const pcmBytes = base64ToUint8(pcmBase64);
  const dataLen = pcmBytes.length;
  const wavBytes = new Uint8Array(44 + dataLen);
  const view = new DataView(wavBytes.buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLen, true);  // file size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // PCM subchunk size
  view.setUint16(20, 1, true);           // Audio format 1 = PCM
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
  const recorderRef = useRef<any>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const mutedRef = useRef(false);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReadPositionRef = useRef<number>(44); // skip WAV header by default

  // ── Audio Permissions ─────────────────────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    if (!ExpoAudio) {
      setErrorMessage('Voice mode requires a native build of the app. Please update via the Play Store or download the latest APK.');
      return false;
    }
    try {
      const { granted } = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMessage('Microphone permission required for voice mode');
        return false;
      }
      await ExpoAudio.setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      return true;
    } catch (err: any) {
      setErrorMessage(`Audio setup failed: ${err?.message || 'unknown error'}`);
      return false;
    }
  }, []);

  // ── Mic Recording ──────────────────────────────────────────────────────────

  const sendAudioChunk = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!recorderRef.current) return;
    if (mutedRef.current) return;
    if (!FileSystem) return;

    try {
      const uri = recorderRef.current.getURI?.() ?? null;
      if (!uri) return;

      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || typeof fileInfo.size !== 'number') return;

      // Only read new incremental PCM bytes
      if (fileInfo.size > lastReadPositionRef.current) {
        const readLen = fileInfo.size - lastReadPositionRef.current;
        const base64Chunk = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
          position: lastReadPositionRef.current,
          length: readLen,
        });

        if (base64Chunk && wsRef.current?.readyState === WebSocket.OPEN) {
          lastReadPositionRef.current = fileInfo.size;
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{
                mimeType: 'audio/pcm;rate=16000',
                data: base64Chunk,
              }],
            },
          }));
        }
      }
    } catch (_) {
      // Non-fatal best-effort
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!ExpoAudio) return;
    if (mutedRef.current) return;
    try {
      if (recorderRef.current) {
        try { recorderRef.current.stop(); } catch (_) {}
        recorderRef.current = null;
      }
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = null;
      }

      const recorder = ExpoAudio.createRecording ? ExpoAudio.createRecording() : null;
      if (!recorder) {
        console.warn('[VoiceSession] expo-audio createRecording not available');
        return;
      }

      const preset = ExpoAudio.RecordingPresets?.LOW_QUALITY ?? {
        android: {
          extension: '.wav',
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
      };

      await recorder.prepareToRecordAsync(preset);
      recorder.record();
      recorderRef.current = recorder;
      lastReadPositionRef.current = 44; // skip initial WAV container header

      // Stream incremental chunks every 250ms
      chunkIntervalRef.current = setInterval(() => {
        sendAudioChunk();
      }, 250);

    } catch (err: any) {
      console.warn('[VoiceSession] Recording start failed:', err?.message);
    }
  }, [sendAudioChunk]);

  const stopRecording = useCallback(async () => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (recorderRef.current) {
      try { recorderRef.current.stop(); } catch (_) {}
      recorderRef.current = null;
    }
  }, []);

  // ── Audio Playback Queue ───────────────────────────────────────────────────

  const playNextChunk = useCallback(async () => {
    if (!ExpoAudio) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const base64Audio = audioQueueRef.current.shift()!;
    try {
      if (ExpoAudio.createAudioPlayer) {
        // Wrap 24kHz raw PCM in a valid WAV header so Android ExoPlayer can play it
        const wavDataUri = `data:audio/wav;base64,${pcmToWavBase64(base64Audio, 24000, 1, 16)}`;
        const player = ExpoAudio.createAudioPlayer({ uri: wavDataUri });
        player.play();

        const checkDone = setInterval(() => {
          if (!player.playing) {
            clearInterval(checkDone);
            isPlayingRef.current = false;
            player.remove?.();
            playNextChunk();
          }
        }, 100);
      } else {
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
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    // 1. Google Live setup complete confirmation
    if (data.setupComplete) {
      console.log('[VoiceSession] Gemini Live setupComplete received');
      setState('listening');
      startRecording();
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

    // 3. Transcription of user speech
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

    // 5. Tool / function calls
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
  }, [playNextChunk, startRecording]);

  // ── Session Lifecycle ──────────────────────────────────────────────────────

  const startSession = useCallback(async (voiceNameOverride?: string) => {
    const voiceName = voiceNameOverride || selectedVoice;
    setErrorMessage(null);
    setState('connecting');
    setTranscript([]);
    audioQueueRef.current = [];
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
        // Send initial setup payload — recording will start upon setupComplete
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
        if (event.code !== 1000) {
          setErrorMessage(`Live connection closed (${event.code}${event.reason ? ': ' + event.reason : ''})`);
          setState('error');
        }
      };

    } catch (err: any) {
      console.error('[VoiceSession] Failed to start:', err?.message);
      setErrorMessage(err?.message || 'Failed to start voice session');
      setState('error');
    }
  }, [selectedVoice, requestAudioPermissions, handleWsMessage]);

  const endSession = useCallback(async () => {
    setState('idle');
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    await stopRecording();

    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
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
  }, [transcript, stopRecording]);

  const mute = useCallback(() => {
    mutedRef.current = true;
    setIsMuted(true);
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
  }, []);

  const unmute = useCallback(() => {
    mutedRef.current = false;
    setIsMuted(false);
    startRecording();
  }, [startRecording]);

  const selectVoice = useCallback((voiceId: string) => {
    setSelectedVoice(voiceId);
  }, []);

  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch (_) {}
      try { stopRecording(); } catch (_) {}
    };
  }, [stopRecording]);

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
