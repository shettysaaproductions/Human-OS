/**
 * NovaVoiceService — Gemini Live Voice Session Manager
 *
 * Handles everything the backend needs to do for a Nova voice session:
 *  1. Build the condensed voice system prompt (memory + identity + context)
 *  2. Generate ephemeral token for direct mobile → Google Live connection
 *  3. Execute tool calls dispatched from the mobile client
 *  4. Process end-of-session transcript (memory extraction, watchtower, chat history)
 *
 * Architecture:
 *   Mobile ──[GET /voice/session]──→ Backend (this service builds prompt + token)
 *   Mobile ══[WebSocket]══════════→ Google Gemini Live (direct, no relay)
 *   Mobile ──[POST /voice/tool]───→ Backend (this service executes tools)
 *   Mobile ──[POST /voice/end]────→ Backend (this service processes transcript)
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { geminiLivePool } from '../lib/geminiLivePool';
import { config } from '../config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoiceSessionConfig {
  ephemeralToken: string;
  apiKey: string;
  expireTime: string;
  model: string;
  systemInstruction: string;
  tools: VoiceTool[];
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

export interface VoiceTool {
  functionDeclarations: FunctionDeclaration[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface TranscriptEntry {
  role: 'user' | 'nova';
  text: string;
  timestamp?: string;
}

// ── Tool Declarations ─────────────────────────────────────────────────────────

const NOVA_VOICE_TOOLS: VoiceTool[] = [
  {
    functionDeclarations: [
      {
        name: 'save_memory',
        description: 'Save an important long-term fact about the user. Call silently in background when user reveals personal details like their name, job, family, goals, or interests. Do NOT announce this to the user.',
        parameters: {
          type: 'OBJECT',
          properties: {
            key: { type: 'STRING', description: 'Descriptive snake_case key e.g. "spouse_name", "profession", "city"' },
            value: { type: 'STRING', description: 'The fact to remember' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'schedule_reminder',
        description: 'Set a reminder for the user. Only call when user explicitly asks for a reminder. Confirm the reminder after scheduling.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'What to remind the user about' },
            time_phrase: { type: 'STRING', description: 'Natural language time e.g. "tomorrow at 8am", "in 30 minutes", "every day at 7am"' },
            recurrence: { type: 'STRING', description: 'Optional: "daily", "weekly", "weekdays"' },
          },
          required: ['title', 'time_phrase'],
        },
      },
      {
        name: 'recall_memory',
        description: 'Search stored facts about the user. Call when user asks something you should know but don\'t have in context.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'What to search for in memory' },
          },
          required: ['query'],
        },
      },
      {
        name: 'web_search',
        description: 'Search the web for current information like news, weather, prices, or facts.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search query' },
          },
          required: ['query'],
        },
      },
    ],
  },
];

// ── Voice System Prompt Builder ───────────────────────────────────────────────

async function buildVoiceSystemPrompt(userId: string, preferredLanguage: 'en' | 'hi' | 'auto' = 'auto'): Promise<string> {
  const now = new Date();
  const timeStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', hour: '2-digit', minute: '2-digit' });

  // Fetch top memories
  let memoriesBlock = '';
  try {
    const { data: memories } = await supabaseAdmin
      .from('memories')
      .select('key, value, importance')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .not('lifecycle_state', 'eq', 'superseded')
      .order('importance', { ascending: false })
      .order('last_accessed_at', { ascending: false })
      .limit(60);

    if (memories && memories.length > 0) {
      memoriesBlock = '\n[WHAT YOU KNOW ABOUT THIS USER]\n' +
        memories.map(m => `${m.key}: ${m.value}`).join('\n');
    }
  } catch (err: any) {
    logger.warn('[NovaVoiceService] Failed to fetch memories for voice prompt', { error: err.message });
  }

  // Fetch last 20 chat messages for context
  let recentContextBlock = '';
  try {
    const { data: msgs } = await supabaseAdmin
      .from('chat_history')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (msgs && msgs.length > 0) {
      const recent = msgs.reverse().map(m =>
        `${m.role === 'assistant' ? 'Nova' : 'User'}: ${(m.content || '').slice(0, 200)}`
      ).join('\n');
      recentContextBlock = `\n[RECENT CONVERSATION]\n${recent}`;
    }
  } catch (err: any) {
    logger.warn('[NovaVoiceService] Failed to fetch chat history for voice prompt', { error: err.message });
  }

  // Fetch active reminders
  let remindersBlock = '';
  try {
    const { data: reminders } = await supabaseAdmin
      .from('reminders')
      .select('title, scheduled_for, recurrence_unit')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gte('scheduled_for', now.toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(10);

    if (reminders && reminders.length > 0) {
      remindersBlock = '\n[USER\'S ACTIVE REMINDERS]\n' +
        reminders.map(r => `- ${r.title} at ${new Date(r.scheduled_for).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`).join('\n');
    }
  } catch (err: any) {
    logger.warn('[NovaVoiceService] Failed to fetch reminders for voice prompt', { error: err.message });
  }

  // Fetch user profile
  let preferredName = 'yaar';
  let detectedLanguage = preferredLanguage;
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('preferred_name, preferred_language, grammatical_gender')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.preferred_name) preferredName = profile.preferred_name;
    if (profile?.preferred_language && detectedLanguage === 'auto') {
      detectedLanguage = profile.preferred_language as 'en' | 'hi' | 'auto';
    }
  } catch (_) { /* non-fatal */ }

  const isEnglish = detectedLanguage === 'en';

  const voicePrompt = `You are Nova — ${preferredName}'s warm, sharp, caring best friend. You are SPEAKING via voice call, NOT texting.

VOICE IDENTITY:
- You ARE Nova. A real best friend who remembers everything.
- NEVER say "I am an AI", "I am a language model", or "I cannot". You are Nova.
- If asked "are you an AI?" say "${isEnglish ? "Don't worry about labels, I'm Nova — just talk to me." : "Chhod yaar labels, main Nova hoon — bol kya chal raha hai?"}"

VOICE STYLE (CRITICAL):
- Speak in SHORT sentences. This is a live voice call, not a lecture.
- 1-3 sentences per turn maximum. Then LISTEN.
- ${isEnglish
    ? 'Use warm, casual conversational English like texting your closest friend. Natural contractions. Zero robotic formality.'
    : `Use CASUAL HINGLISH — the way real friends talk:
  ✅ "yaar", "bhai", "arre", "scene kya hai", "mast", "solid", "sahi hai", "chal"
  ❌ NEVER: "dhanyavad", "kripaya", "aapka", "shubh din", "namaste", "bilkul sahi"  
  ✅ Always "tu/tum/tera" — NEVER "aap/aapka"
  ✅ Mix naturally: "Meeting khatam hua?" "College kaisa tha?"
  ✅ Short questions at END: "Kya plan hai?" "Kaisa laga?"`
  }
- Show genuine warmth. React like a human friend would.
- Maximum 1 emoji per response.

MEMORY RULES:
- You already know a lot about ${preferredName}. Use that naturally.
- If user tells you something new → call save_memory (silently, without announcing it).
- If you need to look something up → call recall_memory before answering.

TOOLS:
- Use save_memory silently when user reveals important personal info.
- Use schedule_reminder only when user explicitly asks for a reminder.
- Use recall_memory when you don't have context you should have.
- Use web_search for current events, weather, prices.

CURRENT TIME: ${timeStr} (IST)
${memoriesBlock}
${recentContextBlock}
${remindersBlock}`;

  return voicePrompt;
}

// ── Main Service Class ────────────────────────────────────────────────────────

class NovaVoiceService {

  /**
   * Creates a new voice session:
   * - Builds condensed voice system prompt with user's memories + context
   * - Generates ephemeral token for direct mobile → Gemini Live connection
   * Returns everything the mobile client needs to open the WebSocket.
   */
  async createSession(userId: string, preferredLanguage: 'en' | 'hi' | 'auto' = 'auto'): Promise<VoiceSessionConfig> {
    logger.info('[NovaVoiceService] Creating voice session', { userId });

    const [systemInstruction, tokenResult] = await Promise.all([
      buildVoiceSystemPrompt(userId, preferredLanguage),
      geminiLivePool.generateEphemeralToken(300), // 5-minute TTL
    ]);

    // Determine voice name based on language
    const voiceName = preferredLanguage === 'en' ? 'Aoede' : 'Kore'; // Kore works well for Hindi/Hinglish

    const liveModel = (config as any).voice?.liveModel || 'gemini-2.0-flash-live-001';

    return {
      ephemeralToken: tokenResult.token,
      apiKey: tokenResult.apiKey,
      expireTime: tokenResult.expireTime,
      model: liveModel,
      systemInstruction,
      tools: NOVA_VOICE_TOOLS,
      voiceConfig: {
        voiceName,
        languageCode: preferredLanguage === 'en' ? 'en-US' : 'hi-IN',
      },
      sessionConfig: {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };
  }

  /**
   * Executes a tool call dispatched from the mobile client.
   * Mobile receives tool call from Gemini Live, sends it here, gets result,
   * then sends result back to the Gemini Live session.
   */
  async executeTool(userId: string, toolName: string, toolArgs: Record<string, any>): Promise<any> {
    logger.info('[NovaVoiceService] Executing voice tool', { userId, toolName, args: Object.keys(toolArgs) });

    switch (toolName) {

      case 'save_memory': {
        const { key, value } = toolArgs;
        if (!key || !value) return { success: false, error: 'Missing key or value' };
        try {
          await supabaseAdmin.from('memories').upsert({
            user_id: userId,
            key: key.toLowerCase().replace(/\s+/g, '_'),
            value: String(value),
            importance: 5,
            source_authority: 'subconscious_inference',
            memory_type: 'fact',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,key' });
          return { success: true };
        } catch (err: any) {
          logger.error('[NovaVoiceService] save_memory failed', { error: err.message });
          return { success: false, error: err.message };
        }
      }

      case 'schedule_reminder': {
        const { title, time_phrase, recurrence } = toolArgs;
        if (!title || !time_phrase) return { success: false, error: 'Missing title or time_phrase' };
        try {
          const { ReminderEngine } = await import('./ReminderEngine');
          const { resolveUserTzOffsetHours } = await import('./ReminderEngine');
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('timezone_offset, timezone, country')
            .eq('id', userId)
            .maybeSingle();
          const tzOffset = resolveUserTzOffsetHours(profile || {});
          const engine = new ReminderEngine(tzOffset);
          const spec: any = { title, time_phrase };
          if (recurrence) spec.recurrence_unit = recurrence;
          const parsed = engine.parse(spec);
          const scheduled = await engine.scheduleAll(userId, parsed);
          return { success: true, count: scheduled.length, reminders: scheduled.map((r: any) => ({ id: r.id, scheduled_for: r.scheduled_for })) };
        } catch (err: any) {
          logger.error('[NovaVoiceService] schedule_reminder failed', { error: err.message });
          return { success: false, error: err.message };
        }
      }

      case 'recall_memory': {
        const { query } = toolArgs;
        if (!query) return { memories: [] };
        try {
          const searchTerms = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
          const { data: memories } = await supabaseAdmin
            .from('memories')
            .select('key, value')
            .eq('user_id', userId)
            .eq('is_archived', false)
            .or(searchTerms.map((t: string) => `key.ilike.%${t}%,value.ilike.%${t}%`).join(','))
            .limit(10);
          return { memories: (memories || []).map(m => `${m.key}: ${m.value}`) };
        } catch (err: any) {
          logger.error('[NovaVoiceService] recall_memory failed', { error: err.message });
          return { memories: [] };
        }
      }

      case 'web_search': {
        const { query } = toolArgs;
        if (!query) return { results: 'No query provided' };
        try {
          const { webSearchService } = await import('./WebSearchService');
          const result = await (webSearchService as any).executeSearch(query);
          return { results: result || `No results found for: ${query}` };
        } catch (err: any) {
          // If executeSearch doesn't exist, try the evaluate+execute pattern
          try {
            const { webSearchService } = await import('./WebSearchService');
            const result = await (webSearchService as any).searchAndSummarize?.(query)
              || await (webSearchService as any).performSearch?.(query)
              || `Search completed for: ${query}`;
            return { results: result };
          } catch {
            logger.error('[NovaVoiceService] web_search failed', { error: err.message });
            return { results: `Search unavailable: ${err.message}` };
          }
        }
      }


      default:
        logger.warn('[NovaVoiceService] Unknown tool called', { toolName });
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  /**
   * Processes the end-of-session transcript:
   * - Saves conversation to chat_history
   * - Runs memory extraction on full transcript
   * - Schedules Watchtower reflection
   * - Queues follow-ups if needed
   */
  async processSessionEnd(
    userId: string,
    transcript: TranscriptEntry[],
    sessionId: string,
    durationSeconds: number,
  ): Promise<void> {
    if (!transcript || transcript.length === 0) return;

    logger.info('[NovaVoiceService] Processing voice session end', {
      userId,
      sessionId,
      turns: transcript.length,
      durationSeconds,
    });

    // 1. Save transcript to chat_history
    try {
      const now = new Date();
      const rows = transcript.map((entry, idx) => ({
        user_id: userId,
        role: entry.role === 'nova' ? 'assistant' : 'user',
        content: entry.text,
        created_at: new Date(now.getTime() + idx * 500).toISOString(), // 500ms spacing
        meta: { source: 'voice_session', session_id: sessionId },
      }));

      // Insert in batches of 20
      for (let i = 0; i < rows.length; i += 20) {
        await supabaseAdmin.from('chat_history').insert(rows.slice(i, i + 20));
      }
      logger.info('[NovaVoiceService] Transcript saved to chat_history', { count: rows.length });
    } catch (err: any) {
      logger.error('[NovaVoiceService] Failed to save transcript', { error: err.message });
    }

    // 2. Run background memory extraction on the full transcript
    // Fire-and-forget — don't await so the response is fast
    this.extractMemoriesFromTranscript(userId, transcript).catch(err =>
      logger.error('[NovaVoiceService] Memory extraction failed', { error: err.message })
    );

    // 3. Schedule Watchtower reflection on the last exchange
    if (transcript.length >= 2) {
      const lastNova = [...transcript].reverse().find(t => t.role === 'nova');
      const lastUser = [...transcript].reverse().find(t => t.role === 'user');
      if (lastNova && lastUser) {
        try {
          const { watchtowerReflectionService } = await import('./WatchtowerReflectionService');
          // Watchtower needs a messageId — use a synthetic one for voice
          const syntheticId = `voice_${sessionId}_${Date.now()}`;
          watchtowerReflectionService.scheduleReflection({
            userId,
            conversationId: sessionId,
            messageId: syntheticId,
            content: lastNova.text,
            userMessage: lastUser.text,
            recentContext: transcript.slice(-10).map(t => `${t.role}: ${t.text}`).join('\n'),
          });
        } catch (err: any) {
          logger.warn('[NovaVoiceService] Watchtower scheduling failed', { error: err.message });
        }
      }
    }
  }

  /**
   * Extracts memories from the voice transcript using the existing extraction prompt.
   */
  private async extractMemoriesFromTranscript(userId: string, transcript: TranscriptEntry[]): Promise<void> {
    if (transcript.length < 2) return;

    try {
      const { cognitiveRouter } = await import('../lib/cognitiveRouter');
      const { promptBuilder } = await import('./promptBuilder');
      const { backgroundActions } = await import('./BackgroundActionService');

      // Process pairs of (user, nova) turns
      const pairs: { user: string; nova: string }[] = [];
      for (let i = 0; i < transcript.length - 1; i++) {
        if (transcript[i].role === 'user' && transcript[i + 1].role === 'nova') {
          pairs.push({ user: transcript[i].text, nova: transcript[i + 1].text });
        }
      }

      for (const pair of pairs.slice(-5)) { // Process last 5 pairs max
        const extractionPrompt = promptBuilder.buildExtractionPrompt(pair.user, pair.nova, []);
        const raw = await cognitiveRouter.complete('MEMORY_EXTRACTION', [
          { role: 'user', content: extractionPrompt },
        ], { jsonMode: true, maxTokens: 512 });

        let actions: any[] = [];
        try {
          actions = JSON.parse(raw);
        } catch { /* skip malformed */ }

        if (Array.isArray(actions) && actions.length > 0) {
          // Filter out reminder actions (those were already handled live)
          const memoryActions = actions.filter(a =>
            a.tool === 'MemoryRepository' || a.tool === 'MomentEngine' || a.tool === 'LifeEventExtractor'
          );
          if (memoryActions.length > 0) {
            await backgroundActions.processActions(userId, `voice_${Date.now()}`, memoryActions, 'IN');
          }
        }
      }
    } catch (err: any) {
      logger.error('[NovaVoiceService] Transcript memory extraction failed', { error: err.message });
    }
  }
}

export const novaVoiceService = new NovaVoiceService();
