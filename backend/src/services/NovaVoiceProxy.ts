/**
 * NovaVoiceProxy — Backend WebSocket Proxy for Gemini Live
 *
 * Architecture (production-safe):
 *   Mobile ←──── wss://backend/voice/ws ────→ Backend ←──── Gemini Live ────→ Google
 *
 * Why proxying is necessary:
 *   - ALL API keys in .env are OAuth2 access tokens (AQ. prefix), NOT AI Studio
 *     API keys (AIzaSy prefix). OAuth tokens cannot be used as ?key= WebSocket params.
 *   - Even with real AIzaSy keys, exposing them in a mobile OTA bundle is a security risk.
 *   - The backend handles auth (JWT), key management, and memory injection — the mobile
 *     only needs to connect to our own server.
 *
 * Flow:
 *   1. Mobile opens WSS to /voice/ws with JWT in query param
 *   2. Backend verifies JWT, loads user context, opens WS to Gemini Live
 *   3. Backend sends the setup frame (model + system prompt + tools)
 *   4. All subsequent frames are relayed bidirectionally
 *   5. When either side closes, both connections are torn down cleanly
 */

import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';
import { novaVoiceService } from './NovaVoiceService';
import { geminiLivePool } from '../lib/geminiLivePool';

const GEMINI_LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// ── JWT verification ──────────────────────────────────────────────────────────

async function verifyJwt(token: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// ── Find a valid Gemini API key ───────────────────────────────────────────────

function getGeminiLiveKey(): string {
  // Priority 1: explicit GEMINI_LIVE_API_KEY
  const explicitKey = process.env.GEMINI_LIVE_API_KEY;
  if (explicitKey?.trim()) {
    return explicitKey.trim();
  }

  // Priority 2: dedicated GeminiLivePool key
  try {
    const poolKey = geminiLivePool.getDirectKey();
    if (poolKey?.trim()) return poolKey.trim();
  } catch (err: any) {
    logger.warn('[VoiceProxy] Failed to acquire key from geminiLivePool', { error: err.message });
  }

  // Priority 3: GEMINI_API_KEY (primary) or GEMINI_API_KEY_1
  const primary = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1;
  if (primary?.trim()) return primary.trim();

  throw new Error('No Gemini API key available for voice proxy');
}

// ── Voice proxy handler ───────────────────────────────────────────────────────

export async function handleVoiceWsProxy(
  mobileWs: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const voiceName = url.searchParams.get('voice') || 'Kore';
  const language = (url.searchParams.get('lang') || 'auto') as 'en' | 'hi' | 'auto';

  // 1. Authenticate
  if (!token) {
    mobileWs.close(4001, 'Missing auth token');
    return;
  }

  const userId = await verifyJwt(token);
  if (!userId) {
    mobileWs.close(4001, 'Invalid auth token');
    return;
  }

  logger.info('[VoiceProxy] Mobile connected', { userId, voice: voiceName });

  // 2. Build session config (loads memory, context, tools)
  let session: any;
  try {
    session = await novaVoiceService.createSession(userId, language);
    session.voiceConfig.voiceName = voiceName;
  } catch (err: any) {
    logger.error('[VoiceProxy] Failed to build session config', { userId, error: err.message });
    mobileWs.close(4500, 'Failed to build session');
    return;
  }

  // 3. Get a valid Gemini Live key
  let geminiKey: string;
  try {
    geminiKey = (session.apiKey && session.apiKey.trim()) || getGeminiLiveKey();
  } catch (err: any) {
    // Send a friendly error to mobile before closing
    try {
      mobileWs.send(JSON.stringify({
        proxyError: {
          code: 'NO_VALID_API_KEY',
          message: 'Nova voice is not configured yet. Please contact support.',
        },
      }));
    } catch {}
    mobileWs.close(4500, 'No valid API key');
    return;
  }

  // 4. Open upstream WebSocket to Gemini Live
  const geminiUrl = `${GEMINI_LIVE_WS_URL}?key=${geminiKey}`;
  const geminiWs = new WebSocket(geminiUrl);

  let setupSent = false;
  let setupComplete = false;
  let closed = false;

  const cleanup = (reason: string) => {
    if (closed) return;
    closed = true;
    logger.info('[VoiceProxy] Cleaning up session', { userId, reason });
    try { geminiWs.close(1000); } catch {}
    // Don't close mobileWs here — let the caller handle it based on context
  };

  // 5. When Gemini connects, send setup frame immediately
  geminiWs.on('open', () => {
    logger.info('[VoiceProxy] Gemini Live WS opened — sending setup frame', { userId });

    const setupFrame = {
      setup: {
        model: session.model,
        systemInstruction: { parts: [{ text: session.systemInstruction }] },
        tools: session.tools,
        generationConfig: {
          responseModalities: session.sessionConfig?.responseModalities || ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: session.voiceConfig.voiceName },
            },
          },
        },
        inputAudioTranscription: session.sessionConfig?.inputAudioTranscription || {},
        outputAudioTranscription: session.sessionConfig?.outputAudioTranscription || {},
      },
    };

    try {
      geminiWs.send(JSON.stringify(setupFrame));
      setupSent = true;
    } catch (err: any) {
      logger.error('[VoiceProxy] Failed to send setup frame', { userId, error: err.message });
      mobileWs.close(4500, 'Setup failed');
      cleanup('setup_send_error');
    }
  });

  // 6. Relay Gemini → Mobile
  geminiWs.on('message', (data: Buffer) => {
    if (mobileWs.readyState !== WebSocket.OPEN) return;

    try {
      const msg = JSON.parse(data.toString());

      if (msg.setupComplete !== undefined) {
        setupComplete = true;
        logger.info('[VoiceProxy] setupComplete received — session is live', { userId });
      }

      // Relay everything verbatim to mobile
      mobileWs.send(data.toString());
    } catch {
      // If we can't parse it, relay raw
      try { mobileWs.send(data); } catch {}
    }
  });

  geminiWs.on('error', (err: Error) => {
    logger.error('[VoiceProxy] Gemini WS error', { userId, error: err.message });
    try {
      mobileWs.send(JSON.stringify({
        proxyError: { code: 'GEMINI_ERROR', message: err.message },
      }));
    } catch {}
    mobileWs.close(4500, 'Gemini connection error');
    cleanup('gemini_error');
  });

  geminiWs.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason.toString() || '(no reason)';
    logger.info('[VoiceProxy] Gemini WS closed', { userId, code, reason: reasonStr });

    if (!setupComplete && setupSent) {
      // Gemini closed before setup — likely invalid key or model
      logger.error('[VoiceProxy] Gemini closed before setupComplete!', {
        userId, code, reason: reasonStr,
        hint: code === 1000 ? 'Clean close — likely invalid API key or model name' : 'Unexpected close',
      });
      try {
        mobileWs.send(JSON.stringify({
          proxyError: {
            code: 'SETUP_REJECTED',
            message: `Gemini rejected setup (close ${code}): ${reasonStr}`,
          },
        }));
      } catch {}
    }

    if (mobileWs.readyState === WebSocket.OPEN) {
      mobileWs.close(code === 1000 ? 1000 : 4500, reasonStr);
    }
  });

  // 7. Relay Mobile → Gemini (user audio, tool responses, etc.)
  mobileWs.on('message', (data: Buffer | string) => {
    if (geminiWs.readyState !== WebSocket.OPEN) return;

    // Drop setup frames from mobile — backend already sent setup
    try {
      const msg = JSON.parse(data.toString());
      if (msg.setup) {
        logger.warn('[VoiceProxy] Dropping setup frame from mobile — backend handles setup', { userId });
        return;
      }
    } catch {}

    try {
      geminiWs.send(data);
    } catch (err: any) {
      logger.warn('[VoiceProxy] Failed to relay mobile → Gemini', { userId, error: err.message });
    }
  });

  mobileWs.on('close', (code: number) => {
    logger.info('[VoiceProxy] Mobile WS closed', { userId, code });
    cleanup('mobile_closed');
  });

  mobileWs.on('error', (err: Error) => {
    logger.warn('[VoiceProxy] Mobile WS error', { userId, error: err.message });
    cleanup('mobile_error');
  });
}
