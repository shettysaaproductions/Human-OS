/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * Manages the full lifecycle of a Gemini Live voice session:
 *   1. Fetches session config (ephemeral token) from backend
 *   2. Opens WebSocket directly to Google Gemini Live
 *   3. Records mic audio via expo-av and sends as base64 PCM chunks
 *   4. Receives audio response chunks and plays them back
 *   5. Handles tool calls → dispatches to backend → sends result back
 *   6. Builds transcript and sends it to backend on session end
 *
 * Architecture: Mobile connects DIRECTLY to Google's Live API.
 * The backend only handles session setup and tool execution — no audio relay.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import {
  voiceService,
  VoiceSessionConfig,
  AvailableVoice,
  TranscriptEntry,
  GEMINI_LIVE_WS_URL,
} from '../services/voiceService';

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
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceSession(): UseVoiceSessionReturn {
  const [state, setState] = useState<VoiceSessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [availableVoices, setAvailableVoices] = useState<AvailableVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('Kore');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionConfigRef = useRef<VoiceSessionConfig | null>(null);
  const sessionIdRef = useRef<string>(`voice_${Date.now()}`);
  const sessionStartRef = useRef<number>(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<string[]>([]); // base64 PCM chunks to play
  const isPlayingRef = useRef(false);
  const mutedRef = useRef(false);

  // ── Audio Permissions & Mode ────────────────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setErrorMessage('Microphone permission required for voice mode');
        return false;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      return true;
    } catch (err: any) {
      setErrorMessage(`Audio setup failed: ${err.message}`);
      return false;
    }
  }, []);

  // ── Mic Recording ──────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (mutedRef.current) return;
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }

      const { recording } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.wav',
            outputFormat: Audio.AndroidOutputFormat.DEFAULT,
            audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: '.wav',
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {},
        },
        (status: any) => {
          // Send audio chunks to Gemini Live as they become available
          if (status.isRecording && status.metering !== undefined) {
            sendAudioChunk();
          }
        },
        100 // update interval ms
      );
      recordingRef.current = recording;
    } catch (err: any) {
      console.warn('[VoiceSession] Recording start failed', err.message);
    }
  }, []);

  const sendAudioChunk = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!recordingRef.current) return;
    if (mutedRef.current) return;

    try {
      const status = await recordingRef.current.getStatusAsync();
      if (!status.isRecording) return;

      // Get current URI and read as base64
      const uri = recordingRef.current.getURI();
      if (!uri) return;

      // Read the audio file as base64 and send to Gemini Live
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
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
      };
      reader.readAsDataURL(blob);
    } catch (_) {
      // Non-fatal — audio chunks are best-effort
    }
  }, []);

  // ── Audio Playback Queue ───────────────────────────────────────────────────

  const playNextChunk = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const base64Audio = audioQueueRef.current.shift()!;
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: `data:audio/pcm;base64,${base64Audio}` },
        { shouldPlay: true, rate: 1.0 }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          isPlayingRef.current = false;
          sound.unloadAsync();
          playNextChunk(); // play next in queue
        }
      });
    } catch (err: any) {
      console.warn('[VoiceSession] Playback failed', err.message);
      isPlayingRef.current = false;
      playNextChunk(); // try next chunk anyway
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
        // Text transcript of Nova's audio response
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

          // Send result back to Gemini Live
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
          console.warn('[VoiceSession] Tool execution failed', fnCall.name, err.message);
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
        if (state !== 'idle') setState('idle');
      };

    } catch (err: any) {
      console.error('[VoiceSession] Failed to start', err.message);
      setErrorMessage(err.message || 'Failed to start voice session');
      setState('error');
    }
  }, [selectedVoice, requestAudioPermissions, startRecording, handleWsMessage]);

  const endSession = useCallback(async () => {
    setState('idle');
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    // Stop recording
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }
    } catch (_) {}

    // Stop playback
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch (_) {}

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
      }).catch(err => console.warn('[VoiceSession] End session failed', err.message));
    }
  }, [transcript]);

  const mute = useCallback(() => {
    mutedRef.current = true;
    setIsMuted(true);
  }, []);

  const unmute = useCallback(() => {
    mutedRef.current = false;
    setIsMuted(false);
    startRecording(); // resume recording
  }, [startRecording]);

  const selectVoice = useCallback((voiceId: string) => {
    setSelectedVoice(voiceId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      recordingRef.current?.stopAndUnloadAsync();
      soundRef.current?.unloadAsync();
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
  };
}
