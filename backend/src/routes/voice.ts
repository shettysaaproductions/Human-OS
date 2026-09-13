/**
 * Voice Route — Nova Voice Mode Endpoints
 *
 * POST /api/voice/session   — Create session (returns ephemeral token + config)
 * POST /api/voice/tool      — Execute a tool call from the mobile Live session
 * POST /api/voice/end       — Process end-of-session transcript
 */

import { Router } from 'express';
import { logger } from '../lib/logger';
import { novaVoiceService, TranscriptEntry } from '../services/NovaVoiceService';

export const voiceRouter = Router();

// ── POST /api/voice/session ───────────────────────────────────────────────────
voiceRouter.post('/session', async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { language = 'auto', voice_name } = req.body;

  try {
    const session = await novaVoiceService.createSession(userId, language as 'en' | 'hi' | 'auto');

    if (voice_name && typeof voice_name === 'string') {
      session.voiceConfig.voiceName = voice_name;
    }

    logger.info('[VoiceRoute] Session created', { userId, model: session.model, voice: session.voiceConfig.voiceName });

    res.json({
      success: true,
      session,
      available_voices: [
        { id: 'Kore',   label: 'Kore',   description: 'Warm & expressive (great for Hindi)' },
        { id: 'Aoede',  label: 'Aoede',  description: 'Smooth & natural (great for English)' },
        { id: 'Charon', label: 'Charon', description: 'Deep & calm' },
        { id: 'Fenrir', label: 'Fenrir', description: 'Clear & precise' },
        { id: 'Puck',   label: 'Puck',   description: 'Bright & energetic' },
      ],
    });
  } catch (err: any) {
    logger.error('[VoiceRoute] Failed to create session', { userId, error: err.message });
    res.status(503).json({ error: 'Voice session unavailable', details: err.message });
  }
});

// ── POST /api/voice/tool ──────────────────────────────────────────────────────
voiceRouter.post('/tool', async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { tool_name, tool_args, session_id } = req.body;

  if (!tool_name || typeof tool_name !== 'string') {
    res.status(400).json({ error: 'tool_name is required' });
    return;
  }

  try {
    const result = await novaVoiceService.executeTool(userId, tool_name, tool_args || {});
    logger.info('[VoiceRoute] Tool executed', { userId, tool_name, session_id });
    res.json({ success: true, result });
  } catch (err: any) {
    logger.error('[VoiceRoute] Tool execution failed', { userId, tool_name, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voice/end ───────────────────────────────────────────────────────
voiceRouter.post('/end', async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { transcript, session_id, duration_seconds } = req.body;

  if (!Array.isArray(transcript)) {
    res.status(400).json({ error: 'transcript must be an array' });
    return;
  }

  // Respond immediately — background processing happens after
  res.json({ success: true, message: 'Session transcript received, processing in background' });

  novaVoiceService.processSessionEnd(
    userId,
    transcript as TranscriptEntry[],
    session_id || `voice_${Date.now()}`,
    duration_seconds || 0,
  ).catch(err =>
    logger.error('[VoiceRoute] Background session processing failed', { userId, error: err.message })
  );
});
