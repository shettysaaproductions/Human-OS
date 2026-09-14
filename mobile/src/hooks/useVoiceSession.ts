/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * Manages the full lifecycle of a Gemini Live voice session:
 *   1. Fetches session config (ephemeral token) from backend
 *   2. Opens WebSocket directly to Google Gemini Live
 *   3. Records mic audio via expo-audio and sends as base64 PCM chunks
 *   4. Receives audio response chunks and plays them back
 *   5. Handles tool calls → dispatches to backend → sends result back
 *   6. Builds transcript and sends it to backend on session end
 *
 * Architecture: Mobile connects DIRECTLY to Google's Live API.
 * The backend only handles session setup and tool execution — no audio relay.
 *
 * Uses expo-audio (SDK 56 successor to expo-av) with the new hook-based API.
 * This avoids the expo-av native crash that occurred with the old library.
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
// expo-audio requires native compilation. If it's missing from the build, we
// degrade gracefully instead of crashing the entire app.
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
  // Non-fatal — audio sending will be skipped
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

  // Whether native audio modules are available in this build
  const isNativeAvailable = ExpoAudio !== null;

  const wsRef = useRef<WebSocket | null>(null);
  const sessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const sessionIdRef = useRef<string>(`voice_${Date.now()}`);
  const sessionStartRef = useRef<number>(0);
  const recorderRef = useRef<any>(null);   // expo-audio AudioRecorder instance
  const audioQueueRef = useRef<string[]>([]); // base64 PCM chunks to play
  const isPlayingRef = useRef(false);
  const mutedRef = useRef(false);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Audio Permissions ─────────────────────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    if (!ExpoAudio) {
      setErrorMessage('Voice mode requires a native build of the app. Please update via the Play Store or download the latest APK.');
      return false;
    }
    try {
      // expo-audio uses requestRecordingPermissionsAsync
      const { granted } = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMessage('Microphone permission required for voice mode');
        return false;
      }
      // Set audio mode — expo-audio uses setAudioModeAsync at the module level
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

  const startRecording = useCallback(async () => {
    if (!ExpoAudio) return;
    if (mutedRef.current) return;
    try {
      // Stop any existing recorder
      if (recorderRef.current) {
        try { recorderRef.current.stop(); } catch (_) {}
        recorderRef.current = null;
      }
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = null;
      }

      // expo-audio hook-based API: create recorder with custom config
      const recorder = ExpoAudio.createRecording ? ExpoAudio.createRecording() : null;
      if (!recorder) {
        console.warn('[VoiceSession] expo-audio createRecording not available');
        return;
      }

      // Use LOW_QUALITY preset for lower latency PCM-compatible audio
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

      // Send audio chunks every 250ms (instead of relying on expo-av status callback)
      chunkIntervalRef.current = setInterval(() => {
        sendAudioChunk();
      }, 250);

    } catch (err: any) {
      console.warn('[VoiceSession] Recording start failed:', err?.message);
    }
  }, []);

  const sendAudioChunk = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!recorderRef.current) return;
    if (mutedRef.current) return;
    if (!FileSystem) return;

    try {
      const uri = recorderRef.current.getURI?.() ?? null;
      if (!uri) return;

      // Use expo-file-system for base64 encoding (FileReader doesn't exist in RN)
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });

      if (base64 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64,
              mimeType: 'audio/wav;rate=16000',
            },
          },
        }));
      }
    } catch (_) {
      // Non-fatal — audio chunks are best-effort
    }
  }, []);

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
      // expo-audio uses useAudioPlayer hook, but for imperative playback
      // we use the createAudioPlayer function
      if (ExpoAudio.createAudioPlayer) {
        const player = ExpoAudio.createAudioPlayer(
          { uri: `data:audio/pcm;base64,${base64Audio}` }
        );
        player.play();
        // Poll for completion
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

    // Audio response chunk from Gemini Live
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

    // Transcription of user's speech
    if (data.serverContent?.inputTranscription?.text) {
      const userText = data.serverContent.inputTranscription.text;
      if (userText.trim()) {
        setState('processing');
        setTranscript(prev => [...prev, { role: 'user', text: userText, timestamp: new Date().toISOString() }]);
      }
    }

    // Model turn complete — go back to listening
    if (data.serverContent?.turnComplete) {
      setState('listening');
    }

    // Tool / function call from Gemini
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
  }, [playNextChunk]);

  // ── Session Lifecycle ──────────────────────────────────────────────────────

  const startSession = useCallback(async (voiceNameOverride?: string) => {
    const voiceName = voiceNameOverride || selectedVoice;
    setErrorMessage(null);
    setState('connecting');
    setTranscript([]);
    audioQueueRef.current = [];
    sessionIdRef.current = `voice_${Date.now()}`;
    sessionStartRef.current = Date.now();

    // Request mic permissions
    const hasPermission = await requestAudioPermissions();
    if (!hasPermission) {
      setState('error');
      return;
    }

    try {
      // 1. Get session config + ephemeral token from backend
      const { session, availableVoices: voices } = await voiceService.startSession({ voiceName });
      sessionConfigRef.current = session;
      setAvailableVoices(voices);

      // 2. Open WebSocket directly to Google Gemini Live
      const wsUrl = `${GEMINI_LIVE_WS_URL}?key=${session.apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // 3. Send setup message with Nova's full system prompt + tools
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

        setState('listening');
        // 4. Start mic recording
        startRecording();
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (err) => {
        console.error('[VoiceSession] WebSocket error', err);
        setErrorMessage('Connection error — please try again');
        setState('error');
      };

      ws.onclose = (event) => {
        console.log('[VoiceSession] WebSocket closed', event.code, event.reason);
      };

    } catch (err: any) {
      console.error('[VoiceSession] Failed to start:', err?.message);
      setErrorMessage(err?.message || 'Failed to start voice session');
      setState('error');
    }
  }, [selectedVoice, requestAudioPermissions, startRecording, handleWsMessage]);

  const endSession = useCallback(async () => {
    setState('idle');
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    // Stop recording
    await stopRecording();

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Send transcript to backend for processing
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch (_) {}
      try { stopRecording(); } catch (_) {}
    };
  }, []);

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
