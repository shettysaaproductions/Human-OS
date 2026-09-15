/**
 * useVoiceSession.ts — Nova Voice Mode WebSocket + Audio Hook
 *
 * v0.3.15 — Root-cause fix: File-based WAV playback + correct AudioModule access
 *
 *   FIX 1 (v0.3.14 regression — No audio from speaker):
 *     createAudioPlayer({ uri: 'data:audio/wav;base64,...' }) fails silently on
 *     Android. ExoPlayer cannot infer the MIME type from a 'data:' URI scheme
 *     and the ProgressiveMediaSource creation throws internally without logging.
 *     FIXED: Write each WAV chunk to a temp file via expo-file-system, then
 *     play from the file:// URI which ExoPlayer handles reliably.
 *
 *   FIX 2 (AudioStream access — OTA reliability):
 *     AudioModule IS re-exported from expo-audio (ExpoAudio.js line 565:
 *     `export { AudioModule }`). Using ExpoAudio.AudioModule.AudioStream
 *     is more reliable in OTA bundle resolution than the internal build path.
 *
 *   FIX 3 (Audio routing — Android speaker vs earpiece):
 *     setAudioModeAsync({ allowsRecording: true }) without interruptionMode
 *     can route audio through the earpiece on Android. Adding
 *     interruptionMode: 'doNotMix' grants speaker focus alongside recording.
 *
 *   FIX 4 (Polling fallback race condition):
 *     Old condition: !player.playing && currentTime > 0 — but for short audio
 *     chunks, currentTime resets to 0 when playback ends, so the poll
 *     never fires. New: poll checks isLoaded && !playing after warmup ticks.
 *
 *   Previous fixes (v0.3.12–14) preserved:
 *   - setAudioModeAsync fire-and-forget (no await on Android)
 *   - 12-second connection timeout
 *   - Simple synchronous JSON.parse for WS messages
 *   - Event-driven didJustFinish queue drain
 */

import { useState, useRef, useCallback, useEffect } from 'react';
// Use legacy subpath — works in all existing APKs regardless of expo-file-system version
import {
  writeAsStringAsync,
  deleteAsync,
  cacheDirectory,
  EncodingType,
} from 'expo-file-system/legacy';
import {
  voiceService,
  AvailableVoice,
  TranscriptEntry,
} from '../services/voiceService';
import { useAuthStore } from '../store/useAuthStore';

// ── Dynamic imports — guard against missing native modules ───────────────────
let ExpoAudio: any = null;
try {
  ExpoAudio = require('expo-audio');
} catch {
  console.warn('[VoiceSession] expo-audio not available — voice mode disabled');
}

// FIX 2: AudioModule IS re-exported from expo-audio (ExpoAudio.js:565).
// ExpoAudio.AudioModule is the native module; .AudioStream is the constructor.
let NativeAudioModule: any = null;
try {
  NativeAudioModule = ExpoAudio?.AudioModule ?? null;
  if (NativeAudioModule?.AudioStream) {
    console.log('[VoiceSession] AudioModule.AudioStream available ✓');
  } else {
    // Fallback to internal build path if AudioModule is not on the index
    NativeAudioModule = require('expo-audio/build/AudioModule').default;
    console.log('[VoiceSession] AudioModule loaded via build path fallback');
  }
} catch (e: any) {
  console.warn('[VoiceSession] AudioModule not accessible — mic streaming disabled:', e?.message);
}

// Global chunk counter for unique temp file names (survives re-renders)
let _chunkCounter = 0;

// ── Backend proxy WebSocket URL ───────────────────────────────────────────────
// Converts EXPO_PUBLIC_API_URL (https://...) → backend voice proxy WebSocket URL
function getBackendVoiceWsUrl(accessToken: string, voiceName: string): string {
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://human-os.onrender.com')
    .replace(/\/$/, '')
    .replace(/\/api$/, '');           // strip /api suffix if present
  const wsUrl = apiUrl
    .replace(/^https:\/\//, 'wss://') // https → wss
    .replace(/^http:\/\//, 'ws://');  // http → ws (local dev)
  return `${wsUrl}/voice/ws?token=${encodeURIComponent(accessToken)}&voice=${encodeURIComponent(voiceName)}`;
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
 * Gemini sends 24kHz int16 PCM. Prepend a WAV header so ExoPlayer/AVPlayer
 * can decode it. Returns base64-encoded WAV for writeAsStringAsync.
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
  prefetchSession: () => void; // call this when voice screen opens
  prefetchState: 'idle' | 'loading' | 'ready' | 'error';
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

  // ── Session Prefetch ───────────────────────────────────────────────────────
  // Call prefetchSession() when the voice screen opens so the backend
  // is already warm and session config is cached when user taps mic.
  const cachedSessionRef    = useRef<any>(null);
  const cachedVoicesRef     = useRef<AvailableVoice[]>([]);
  const [prefetchState, setPrefetchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const prefetchInProgressRef = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const prefetchSession = useCallback(() => {
    // Prefetch is now just a Render warm-up ping.
    // The actual session is built by the backend proxy on WebSocket connect.
    if (prefetchInProgressRef.current) return;
    prefetchInProgressRef.current = true;
    setPrefetchState('loading');
    console.log('[VoiceSession] Warming up backend server...');

    const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://human-os.onrender.com')
      .replace(/\/$/, '');
    const healthUrl = apiUrl.endsWith('/api')
      ? apiUrl.replace(/\/api$/, '/health')
      : `${apiUrl}/health`;

    fetch(healthUrl, { method: 'GET' })
      .then(() => {
        setPrefetchState('ready');
        prefetchInProgressRef.current = false;
        console.log('[VoiceSession] Backend warm-up complete ✓');
      })
      .catch((err: any) => {
        // Non-fatal — might just be slow, still allow user to tap
        setPrefetchState('ready'); // show as ready anyway; WS will reveal real error
        prefetchInProgressRef.current = false;
        console.warn('[VoiceSession] Backend warm-up ping failed (non-fatal):', err?.message);
      });
  }, []);

  // ── Audio Permissions ──────────────────────────────────────────────────────

  const requestAudioPermissions = useCallback(async (): Promise<boolean> => {
    if (!ExpoAudio) {
      setErrorMessage('Voice mode requires a native build. Please install the APK.');
      return false;
    }
    try {
      console.log('[VoiceSession] Requesting mic permission...');
      const { granted } = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!granted) {
        setErrorMessage('Microphone permission is required for voice mode');
        return false;
      }
      console.log('[VoiceSession] Mic permission granted ✓');

      // FIX 1: setAudioModeAsync is FIRE-AND-FORGET — never await on Android.
      // FIX 3: Add interruptionMode 'doNotMix' so Android routes to speaker during recording.
      ExpoAudio.setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        interruptionMode: 'doNotMix',
      }).catch((err: any) => {
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
    if (!NativeAudioModule?.AudioStream) {
      console.warn('[VoiceSession] AudioModule.AudioStream not available — mic disabled. Nova can still speak but cannot hear you.');
      return;
    }

    try {
      console.log('[VoiceSession] Creating AudioStream (16kHz mono float32)...');
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

      stream.addListener('audioStreamStatus', (status: any) => {
        console.log('[VoiceSession] AudioStream status:', JSON.stringify(status));
      });

      stream.start().then(() => {
        console.log('[VoiceSession] AudioStream started ✓ (16kHz mono float32→int16)');
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

  /**
   * FIX 1: Write WAV to a temp file, play from file:// URI.
   *
   * data: URIs fail silently on Android — ExoPlayer's ProgressiveMediaSource
   * cannot detect MIME type from a data: scheme and throws internally.
   * File-based playback is reliable across all Android versions.
   */
  const playNextChunk = useCallback(async () => {
    if (!ExpoAudio?.createAudioPlayer) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const base64Pcm = audioQueueRef.current.shift()!;
    try {
      // Build WAV base64 (44-byte header + 24kHz int16 PCM data)
      const wavBase64 = pcmToWavBase64(base64Pcm, 24000, 1, 16);

      // Write to temp file using the LEGACY API (works in all installed APK versions).
      // expo-file-system/legacy is guaranteed to be present in the native layer.
      const tmpPath = `${cacheDirectory}nova_chunk_${++_chunkCounter}.wav`;
      await writeAsStringAsync(tmpPath, wavBase64, { encoding: EncodingType.Base64 });
      console.log(`[VoiceSession] Playing chunk #${_chunkCounter} from ${tmpPath}`);

      const player = ExpoAudio.createAudioPlayer({ uri: tmpPath });

      let done = false;
      const cleanAndAdvance = () => {
        deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
        playNextChunk();
      };
      const markDone = () => {
        if (done) return;
        done = true;
        isPlayingRef.current = false;
        try { sub?.remove(); } catch (_) {}
        clearInterval(poll);
        try { player.remove?.(); } catch (_) {}
        cleanAndAdvance();
      };

      // Event-driven (primary path)
      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) {
          console.log(`[VoiceSession] Chunk #${_chunkCounter} done (event)`);
          markDone();
        }
        if (status?.error) {
          console.warn(`[VoiceSession] Chunk playback error: ${status.error}`);
          markDone();
        }
      });

      player.play();

      // FIX 4: Poll checks isLoaded && !playing (currentTime can reset to 0 at end)
      let pollTick = 0;
      const poll = setInterval(() => {
        pollTick++;
        // Wait a few ticks before checking to let the player start
        if (pollTick > 3 && player.isLoaded && !player.playing) {
          console.log(`[VoiceSession] Chunk #${_chunkCounter} done (poll)`);
          markDone();
        }
      }, 200);

      // Hard ceiling: 20s max per chunk
      setTimeout(() => {
        if (!done) {
          console.warn(`[VoiceSession] Chunk #${_chunkCounter} timeout`);
          markDone();
        }
      }, 20000);

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

    // 35-second hard timeout — accounts for Render free-tier cold start (~20-30s)
    // After backend wakes and session config is fetched, the WS + setupComplete
    // should arrive in <5s, well within this window.
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      stopMicStream();
      setErrorMessage('Connecting to Nova is taking longer than expected — server may be waking up. Please try again in a moment.');
      setState('error');
    }, 35000);

    const hasPermission = await requestAudioPermissions();
    if (!hasPermission) {
      clearConnectTimer();
      setState('error');
      return;
    }

    try {
      // Get the current JWT access token for backend auth
      const accessToken = useAuthStore.getState().accessToken;
      if (!accessToken) {
        clearConnectTimer();
        setErrorMessage('Please sign in to use voice mode');
        setState('error');
        return;
      }

      // Clear the prefetch cache (proxy builds its own session)
      cachedSessionRef.current = null;
      setPrefetchState('idle');
      setAvailableVoices([
        { id: 'Kore',   label: 'Kore',   description: 'Warm & expressive' },
        { id: 'Aoede',  label: 'Aoede',  description: 'Smooth & natural' },
        { id: 'Charon', label: 'Charon', description: 'Deep & calm' },
        { id: 'Fenrir', label: 'Fenrir', description: 'Clear & precise' },
        { id: 'Puck',   label: 'Puck',   description: 'Bright & energetic' },
      ]);

      // Connect to our backend proxy — it handles the Gemini Live connection
      // using a server-side API key (never exposed to mobile bundle)
      const wsUrl = getBackendVoiceWsUrl(accessToken, voiceName);
      console.log('[VoiceSession] Opening WebSocket to backend proxy...');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Backend proxy handles setup frame — nothing to send on open
        console.log('[VoiceSession] Backend proxy WS opened — waiting for setupComplete...');
      };

      // Wrap handleWsMessage to also detect proxyError frames
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.proxyError) {
            console.error('[VoiceSession] Proxy error:', data.proxyError.code, data.proxyError.message);
            clearConnectTimer();
            setErrorMessage(data.proxyError.message || 'Voice connection error');
            setState('error');
            return;
          }
        } catch {}
        handleWsMessage(event);
      };

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

    // Clean up leftover temp WAV files (best-effort)
    // Note: No directory listing in legacy API — files auto-cleared by OS on low storage
    // Active cleanup happens per-chunk in cleanAndAdvance()

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
    prefetchSession,
    prefetchState,
    endSession,
    mute,
    unmute,
    isMuted,
    selectVoice,
    isNativeAvailable,
  };
}

