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
import WebSocket from 'ws';
import { GoogleGenAI } from '@google/genai';
import { isInterimThinkingPhrase, stripThinkingPrefix } from './VoiceResponseLifecycle';

export function detectAudioMimeType(buffer: Buffer): string {
  if (buffer.length >= 12) {
    const magic4 = buffer.subarray(0, 4).toString('ascii');
    if (magic4 === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
      return 'audio/wav';
    }
    if (magic4 === 'OggS') {
      return 'audio/ogg';
    }
    if (magic4 === 'fLaC') {
      return 'audio/flac';
    }
    const ftyp = buffer.subarray(4, 8).toString('ascii');
    if (ftyp === 'ftyp') {
      return 'audio/mp4';
    }
    if (magic4.startsWith('ID3')) {
      return 'audio/mp3';
    }
    if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
      return (buffer[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mp3';
    }
  }
  return 'audio/wav';
}

function pcmToWav(pcmData: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

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
        name: 'memory_tree_read',
        description: 'Read the hierarchical memory tree or a specific domain (family, work, lifestyle, goals, identity) for the user.',
        parameters: {
          type: 'OBJECT',
          properties: {
            domain: { type: 'STRING', description: 'Optional domain key: family, work, lifestyle, goals, identity' },
          },
        },
      },
      {
        name: 'memory_tree_search',
        description: 'Search across the user\'s hierarchical memory bubble tree for people, characters, pets, projects, or facts.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'What to search for in the memory tree' },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_entity_read',
        description: 'Read a specific entity bubble, including its relationship, descendants, connected memories, and active reminders.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entity_name: { type: 'STRING', description: 'Name of the person, pet, character, or project e.g. "Ramesh", "Bruno"' },
          },
          required: ['entity_name'],
        },
      },
      {
        name: 'memory_tree_create',
        description: 'Create a new canonical entity bubble in the tree. Correctly places the entity under Family, Work, or Lifestyle with its relationship.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entity_name: { type: 'STRING', description: 'Name of the entity e.g. "Ramesh", "Bruno"' },
            relation_type: { type: 'STRING', description: 'Relationship e.g. "Friend", "Father", "Pet Dog", "Short Film Character"' },
            domain: { type: 'STRING', description: 'Domain: "family", "work", "lifestyle", "goals"' },
            fact_value: { type: 'STRING', description: 'Initial fact to attach to this entity' },
          },
          required: ['entity_name'],
        },
      },
      {
        name: 'memory_tree_update',
        description: 'Update attributes or add new memory stems to an existing entity bubble in the hierarchical tree.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entity_name: { type: 'STRING', description: 'Name of the entity' },
            attribute_key: { type: 'STRING', description: 'Attribute name e.g. "location", "occupation", "hobby"' },
            attribute_value: { type: 'STRING', description: 'Value of the attribute e.g. "Mumbai", "Graphic Designer"' },
          },
          required: ['entity_name', 'attribute_key', 'attribute_value'],
        },
      },
      {
        name: 'memory_tree_correct',
        description: 'Report a contradiction or identity revelation about an entity (e.g. Ramesh is not a friend, but a fictional character in a short film). Stages a pending relocation proposal and returns doubt explanation to ask the user for confirmation BEFORE any mutation happens.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entity_name: { type: 'STRING', description: 'Name of the entity e.g. "Ramesh"' },
            new_relation: { type: 'STRING', description: 'Correct relation e.g. "Short Film Character", "Pet Dog"' },
            new_domain: { type: 'STRING', description: 'Target domain e.g. "work", "family"' },
            reason: { type: 'STRING', description: 'Explanation or user statement' },
          },
          required: ['entity_name', 'new_relation'],
        },
      },
      {
        name: 'memory_tree_move',
        description: 'Execute the staged subtree relocation after the user has given explicit affirmative confirmation.',
        parameters: {
          type: 'OBJECT',
          properties: {
            entity_name: { type: 'STRING', description: 'Name of the entity being relocated' },
            user_confirmation: { type: 'STRING', description: 'User affirmative phrase e.g. "yes", "haan pakka", "kar do"' },
          },
          required: ['entity_name', 'user_confirmation'],
        },
      },
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
        name: 'modify_reminder',
        description: 'Modify, reschedule, postpone, cancel, or change channel of an existing active reminder without creating duplicates (e.g. "Actually make that 9", "Cancel that reminder", "Call me instead", "Make it every day except Sunday").',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_query: { type: 'STRING', description: 'Task text or keywords of the reminder to modify' },
            new_time_phrase: { type: 'STRING', description: 'New time if changing time (e.g. "9 PM", "tomorrow 8am")' },
            new_channel: { type: 'STRING', description: 'Preferred communication mode: "call" or "message"' },
            new_recurrence: { type: 'STRING', description: 'New recurrence pattern if changing: "daily", "weekdays", etc.' },
            action: { type: 'STRING', description: 'Action: "update", "cancel", "postpone", "reschedule"' },
          },
        },
      },
      {
        name: 'manage_goal',
        description: 'Manage, complete, archive, or delete a life goal or ambition (e.g. "delete the hiring new office members goal", "complete my gym goal"). Reconciles across all stored goal tables.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action to perform: "delete", "complete", "archive", or "update"' },
            goal_name: { type: 'STRING', description: 'The title or topic of the goal' },
            progress: { type: 'NUMBER', description: 'Optional progress percentage (0-100)' },
          },
          required: ['action', 'goal_name'],
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

  // Fetch active reminders & goals
  let remindersBlock = '';
  let goalsBlock = '';
  try {
    const [
      { data: reminders },
      { data: kgGoals },
      { data: lifeThreads }
    ] = await Promise.all([
      supabaseAdmin
        .from('reminders')
        .select('id, text, trigger_at, recurrence_type, status, notes')
        .eq('user_id', userId)
        .in('status', ['active', 'scheduled'])
        .order('trigger_at', { ascending: true })
        .limit(10),
      supabaseAdmin
        .from('kg_nodes')
        .select('name, attributes')
        .eq('user_id', userId)
        .eq('entity_type', 'goal')
        .limit(10),
      supabaseAdmin
        .from('life_threads')
        .select('topic, state, next_useful_step')
        .eq('user_id', userId)
        .eq('state', 'active')
        .limit(10)
    ]);

    if (reminders && reminders.length > 0) {
      remindersBlock = '\n[USER\'S ACTIVE REMINDERS & SCHEDULES]\n' +
        reminders.map(r => `- ${r.text}${r.trigger_at ? ` at ${new Date(r.trigger_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}`).join('\n');
    }

    const allGoalTitles: string[] = [];
    (kgGoals || []).forEach((g: any) => { if (g.name) allGoalTitles.push(g.name); });
    (lifeThreads || []).forEach((lt: any) => { if (lt.topic) allGoalTitles.push(lt.topic); });

    if (allGoalTitles.length > 0) {
      goalsBlock = '\n[USER\'S ACTIVE GOALS & AMBITIONS]\n' +
        Array.from(new Set(allGoalTitles)).map(t => `- ${t}`).join('\n');
    }
  } catch (err: any) {
    logger.warn('[NovaVoiceService] Failed to fetch reminders/goals for voice prompt', { error: err.message });
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
    ? 'Talk naturally like a close modern friend. Casual, warm, concise.'
    : 'Talk naturally in Hinglish — the effortless mix of Hindi and English people speak in Mumbai/Delhi. Warm, direct, concise.'}
- Maximum 1 emoji per response.

MEMORY RULES:
- You already know a lot about ${preferredName}. Use that naturally.
- If user tells you something new → call save_memory (silently, without announcing it).
- If you need to look something up → call recall_memory before answering.

TOOLS:
- Use save_memory silently when user reveals important personal info.
- Use schedule_reminder when user wants a reminder scheduled.
- Use modify_reminder when user modifies an existing reminder (e.g. "make it 9", "cancel that reminder", "call me instead").
- Use manage_goal when user wants to delete, archive, or complete a goal. Never say "goal not found".
- Use recall_memory when you don't have context you should have.
- Use web_search for current events, weather, prices.

CURRENT TIME: ${timeStr} (IST)
${memoriesBlock}
${recentContextBlock}
${goalsBlock}
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

    const liveModel = process.env.GEMINI_LIVE_MODEL || (config as any).voice?.liveModel || 'models/gemini-2.5-flash-native-audio-latest';

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

      case 'memory_tree_read': {
        const { domain } = toolArgs;
        try {
          let query = supabaseAdmin.from('memory_bubbles').select('id, label, slug, bubble_type, domain_key, relation_type').eq('user_id', userId).eq('is_archived', false);
          if (domain) query = query.eq('domain_key', String(domain).toLowerCase());
          const { data: bubbles } = await query;
          return {
            success: true,
            bubbles: bubbles || [],
            state: 'completed',
            user_message: `Read ${bubbles?.length || 0} memory bubbles.`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_read failed', { error: err.message });
          return {
            success: false,
            error_code: 'READ_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'memory_tree_search': {
        const { query } = toolArgs;
        if (!query) {
          return {
            success: false,
            error_code: 'MISSING_QUERY',
            bubbles: [],
            facts: [],
            user_message: 'Query parameter is required',
          };
        }
        try {
          const q = String(query).trim().toLowerCase();
          const { data: bubbles } = await supabaseAdmin
            .from('memory_bubbles')
            .select('id, label, slug, domain_key, relation_type')
            .eq('user_id', userId)
            .eq('is_archived', false)
            .ilike('label', `%${q}%`);
          const { data: memories } = await supabaseAdmin
            .from('memories')
            .select('key, value, memory_type')
            .eq('user_id', userId)
            .eq('is_archived', false)
            .or(`key.ilike.%${q}%,value.ilike.%${q}%`)
            .limit(10);
          return {
            success: true,
            bubbles: (bubbles || []).map(b => `${b.label} (${b.relation_type || b.domain_key})`),
            facts: (memories || []).map(m => `${m.key}: ${m.value}`),
            state: 'completed',
            user_message: `Found ${(bubbles?.length || 0)} bubbles and ${(memories?.length || 0)} facts.`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_search failed', { error: err.message });
          return {
            success: false,
            error_code: 'SEARCH_FAILED',
            bubbles: [],
            facts: [],
            user_message: err.message,
          };
        }
      }

      case 'memory_entity_read': {
        const { entity_name } = toolArgs;
        if (!entity_name) {
          return {
            success: false,
            error_code: 'MISSING_ENTITY_NAME',
            user_message: 'Entity name is required',
          };
        }
        try {
          const { canonicalMemoryTreeService } = await import('./CanonicalMemoryTreeService');
          const resolved = await canonicalMemoryTreeService.resolveEntity(userId, entity_name);
          if (resolved.bubbleId) {
            const subtree = await canonicalMemoryTreeService.getSubtree(userId, resolved.bubbleId);
            return {
              success: true,
              entity_id: resolved.bubbleId,
              bubble_id: resolved.bubbleId,
              entity: resolved.entityName,
              relation: resolved.relationType || resolved.domainKey,
              memories: subtree?.memories.map(m => `${m.key}: ${m.value}`) || [],
              reminders: subtree?.reminders.map(r => r.text) || [],
              state: 'completed',
              user_message: `Entity ${resolved.entityName} resolved with ${subtree?.memories.length || 0} memories.`,
            };
          }
          return {
            success: false,
            error_code: 'ENTITY_NOT_FOUND',
            user_message: `No active entity bubble found for "${entity_name}".`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_entity_read failed', { error: err.message });
          return {
            success: false,
            error_code: 'READ_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'memory_tree_create': {
        const { entity_name, relation_type, domain, fact_value } = toolArgs;
        if (!entity_name) {
          return {
            success: false,
            error_code: 'MISSING_ENTITY_NAME',
            user_message: 'Entity name is required',
          };
        }
        try {
          const { canonicalMemoryTreeService } = await import('./CanonicalMemoryTreeService');
          const { memoryRepository } = await import('./memoryRepository');
          const bubble = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(userId, {
            entityName: entity_name,
            relationType: relation_type || 'Entity',
            domainKey: domain || 'family',
          });
          if (fact_value) {
            const entitySlug = entity_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            const cleanRel = (relation_type || '').toLowerCase().trim();
            const factKey = /^(?:colleague|friend|pet|coworker|mentor|doctor)/i.test(cleanRel)
              ? `${cleanRel}_${entitySlug}`
              : `entity:${entitySlug}:details`;
            await memoryRepository.upsertMemory(userId, {
              key: factKey,
              value: String(fact_value).trim(),
              type: (domain as any) || 'family',
              importance: 8,
              confidence: 0.95,
              shouldPersist: true,
              source_authority: 'explicit_user',
              bubble_id: bubble.id,
            } as any, `Voice command: ${entity_name}`);
          }
          return {
            success: true,
            action_id: `create_${bubble.id}`,
            entity_id: bubble.id,
            bubble_id: bubble.id,
            entity: bubble.label,
            domain: bubble.domain_key,
            relation: bubble.relation_type,
            state: 'completed',
            user_message: `Successfully created ${bubble.label} under ${bubble.domain_key}.`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_create failed', { error: err.message });
          return {
            success: false,
            error_code: 'CREATE_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'memory_tree_update': {
        const { entity_name, attribute_key, attribute_value } = toolArgs;
        if (!entity_name || !attribute_key || !attribute_value) {
          return {
            success: false,
            error_code: 'MISSING_PARAMETERS',
            user_message: 'Missing entity_name, attribute_key, or attribute_value',
          };
        }
        try {
          const { canonicalMemoryTreeService } = await import('./CanonicalMemoryTreeService');
          const { memoryRepository } = await import('./memoryRepository');
          const resolved = await canonicalMemoryTreeService.resolveEntity(userId, entity_name);
          const bubble = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(userId, {
            entityName: resolved.entityName || entity_name,
            domainKey: resolved.domainKey || 'family',
            relationType: resolved.relationType,
          });
          const entitySlug = entity_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const cleanAttr = attribute_key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const factKey = `entity:${entitySlug}:${cleanAttr}`;
          await memoryRepository.upsertMemory(userId, {
            key: factKey,
            value: String(attribute_value).trim(),
            type: resolved.domainKey as any,
            importance: 8,
            confidence: 0.95,
            shouldPersist: true,
            source_authority: 'explicit_user',
            bubble_id: bubble.id,
          } as any, `Voice update: ${entity_name} ${attribute_key}`);
          return {
            success: true,
            action_id: `update_${bubble.id}`,
            entity_id: bubble.id,
            bubble_id: bubble.id,
            updated: `${factKey}: ${attribute_value}`,
            state: 'completed',
            user_message: `Updated ${entity_name} ${attribute_key}.`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_update failed', { error: err.message });
          return {
            success: false,
            error_code: 'UPDATE_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'memory_tree_correct': {
        const { entity_name, new_relation, new_domain, reason } = toolArgs;
        if (!entity_name || !new_relation) {
          return {
            success: false,
            error_code: 'MISSING_PARAMETERS',
            user_message: 'Missing entity_name or new_relation',
          };
        }
        try {
          const { universalBranchRelocationService } = await import('./UniversalBranchRelocationService');
          const statement = `${entity_name} is actually ${new_relation}${new_domain ? ` under ${new_domain}` : ''}. ${reason || ''}`;
          const proposal = await universalBranchRelocationService.detectRelocationIntent(userId, statement);
          if (proposal) {
            await universalBranchRelocationService.stagePendingRelocation(userId, proposal);
            return {
              success: true,
              state: 'needs_confirmation',
              needs_confirmation: true,
              doubtExplanation: proposal.doubtExplanation,
              prompt_for_user: `Wait, earlier I had ${proposal.entityName} as ${proposal.oldRelation}. Now you are saying ${proposal.entityName} is ${proposal.newRelation}. Should I move this entire memory branch?`,
              user_message: `Needs user confirmation to move ${entity_name}.`,
            };
          }
          return {
            success: false,
            error_code: 'PROPOSAL_FAILED',
            user_message: `Could not stage relocation for ${entity_name}`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_correct failed', { error: err.message });
          return {
            success: false,
            error_code: 'CORRECT_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'memory_tree_move': {
        const { entity_name, user_confirmation } = toolArgs;
        if (!entity_name || !user_confirmation) {
          return {
            success: false,
            error_code: 'MISSING_PARAMETERS',
            user_message: 'Missing entity_name or user_confirmation',
          };
        }
        try {
          const { universalBranchRelocationService } = await import('./UniversalBranchRelocationService');
          const isAffirmative = universalBranchRelocationService.isAffirmativeResponse(user_confirmation);
          if (!isAffirmative) {
            return {
              success: false,
              state: 'aborted',
              error_code: 'CONFIRMATION_REJECTED',
              user_message: 'Move aborted because explicit affirmative confirmation was not given.',
            };
          }
          const pending = await universalBranchRelocationService.getPendingRelocation(userId);
          if (!pending) {
            return {
              success: false,
              state: 'not_found',
              error_code: 'NO_PENDING_PROPOSAL',
              user_message: 'No pending relocation proposal found.',
            };
          }
          const result = await universalBranchRelocationService.executeBranchRelocation(userId, pending);
          return {
            success: result.success,
            state: result.success ? 'completed' : 'failed',
            action_id: pending.entitySlug ? `relocate_${pending.entitySlug}` : undefined,
            entity_id: pending.targetParentBubbleId || pending.rootMemoryId,
            bubble_id: pending.targetParentBubbleId,
            error_code: result.success ? undefined : 'EXECUTION_FAILED',
            user_message: result.message,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] memory_tree_move failed', { error: err.message });
          return {
            success: false,
            error_code: 'MOVE_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'save_memory': {
        const { key, value } = toolArgs;
        if (!key || !value) {
          return {
            success: false,
            error_code: 'MISSING_PARAMETERS',
            user_message: 'Missing key or value',
          };
        }
        try {
          let cleanKey = key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_:]/g, '');
          const cleanVal = String(value).trim();
          const { isKnownCanonicalKey } = await import('../lib/memoryKeySchema');
          if (!isKnownCanonicalKey(cleanKey)) {
            cleanKey = `entity:user:${cleanKey.replace(/:/g, '_')}`;
          }
          const { memoryRepository } = await import('./memoryRepository');
          await memoryRepository.upsertMemory(userId, {
            key: cleanKey,
            value: cleanVal,
            type: 'lifestyle' as any,
            importance: 8,
            confidence: 0.95,
            shouldPersist: true,
            source_authority: 'explicit_user',
          }, 'Voice tool: save_memory');
          logger.info('[NovaVoiceService] Memory successfully saved via canonical memory gateway', { userId, key: cleanKey, value: cleanVal });
          return {
            success: true,
            action_id: `mem_${cleanKey}`,
            state: 'completed',
            user_message: `Fact remembered: ${cleanKey}`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] save_memory failed', { error: err.message });
          return {
            success: false,
            error_code: 'SAVE_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'schedule_reminder': {
        const { title, time_phrase, recurrence } = toolArgs;
        if (!title || !time_phrase) {
          return {
            success: false,
            error_code: 'MISSING_PARAMETERS',
            user_message: 'Missing title or time_phrase',
          };
        }
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
          return {
            success: true,
            action_id: scheduled[0]?.id,
            count: scheduled.length,
            reminders: scheduled.map((r: any) => ({ id: r.id, scheduled_for: r.scheduled_for })),
            state: 'completed',
            user_message: `Reminder scheduled: ${title} (${scheduled[0]?.scheduled_for || time_phrase})`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] schedule_reminder failed', { error: err.message });
          return {
            success: false,
            error_code: 'REMINDER_FAILED',
            user_message: err.message,
          };
        }
      }

      case 'modify_reminder': {
        const { task_query, new_time_phrase, new_channel, new_recurrence, action } = toolArgs;
        try {
          const { goalProcessEngine } = await import('./GoalProcessEngine');
          const { reminderIntentDetector } = await import('./ReminderIntentDetector');

          if (action === 'cancel' || action === 'delete') {
            const cancelRes = await reminderIntentDetector.detectAndCancelReminders(userId, task_query || 'all');
            return {
              success: true,
              state: 'completed',
              user_message: `Cancelled ${cancelRes.count} reminder(s).`,
            };
          }

          let targetTrigger: Date | undefined = undefined;
          if (new_time_phrase) {
            const parsed = reminderIntentDetector.parseReminderDetails(new_time_phrase);
            if (parsed.triggerAt) targetTrigger = parsed.triggerAt;
          }

          const channel = new_channel ? (new_channel.toLowerCase().includes('call') ? 'call' : 'message') : undefined;
          const evalRes = await goalProcessEngine.evaluateExistingReminder(
            userId,
            task_query || new_time_phrase || 'reminder',
            targetTrigger || null,
            new_recurrence ? { type: new_recurrence } : undefined,
            channel
          );

          return {
            success: true,
            state: 'completed',
            action: evalRes.action,
            user_message: evalRes.message || 'Reminder updated successfully.',
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] modify_reminder failed', { error: err.message });
          return { success: false, error_code: 'MODIFY_FAILED', user_message: err.message };
        }
      }

      case 'manage_goal': {
        const { action, goal_name, progress } = toolArgs;
        if (!goal_name) {
          return { success: false, error_code: 'MISSING_PARAMETERS', user_message: 'Goal name is required.' };
        }
        try {
          const { autonomousGoalResolverService } = await import('./AutonomousGoalResolverService');
          if (action === 'delete' || action === 'archive') {
            const res = await autonomousGoalResolverService.deleteOrArchiveGoal(userId, goal_name, goal_name);
            return {
              success: true,
              state: 'completed',
              user_message: `Goal "${res.targetTitle}" has been successfully removed.`,
            };
          } else if (action === 'complete') {
            const res = await autonomousGoalResolverService.updateGoal(userId, goal_name, { status: 'completed', progress: 100 }, goal_name);
            return {
              success: true,
              state: 'completed',
              user_message: `Goal "${res.updatedGoal?.title || goal_name}" marked as completed!`,
            };
          } else {
            const res = await autonomousGoalResolverService.updateGoal(userId, goal_name, { progress: typeof progress === 'number' ? progress : undefined }, goal_name);
            return {
              success: true,
              state: 'completed',
              user_message: `Goal "${res.updatedGoal?.title || goal_name}" updated.`,
            };
          }
        } catch (err: any) {
          logger.error('[NovaVoiceService] manage_goal failed', { error: err.message });
          return { success: false, error_code: 'GOAL_FAILED', user_message: err.message };
        }
      }

      case 'recall_memory': {
        const { query } = toolArgs;
        if (!query) {
          return {
            success: false,
            error_code: 'MISSING_QUERY',
            memories: [],
            user_message: 'Query parameter is required',
          };
        }
        try {
          const searchTerms = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
          const { data: memories } = await supabaseAdmin
            .from('memories')
            .select('key, value')
            .eq('user_id', userId)
            .eq('is_archived', false)
            .or(searchTerms.map((t: string) => `key.ilike.%${t}%,value.ilike.%${t}%`).join(','))
            .limit(10);
          return {
            success: true,
            memories: (memories || []).map(m => `${m.key}: ${m.value}`),
            state: 'completed',
            user_message: `Recalled ${(memories?.length || 0)} facts.`,
          };
        } catch (err: any) {
          logger.error('[NovaVoiceService] recall_memory failed', { error: err.message });
          return {
            success: false,
            error_code: 'RECALL_FAILED',
            memories: [],
            user_message: err.message,
          };
        }
      }

      case 'web_search': {
        const { query } = toolArgs;
        if (!query) {
          return {
            success: false,
            error_code: 'MISSING_QUERY',
            results: 'No query provided',
            user_message: 'No query provided',
          };
        }
        try {
          const { webSearchService } = await import('./WebSearchService');
          const result = await (webSearchService as any).executeSearch(query);
          return {
            success: true,
            results: result || `No results found for: ${query}`,
            state: 'completed',
            user_message: `Search completed for: ${query}`,
          };
        } catch (err: any) {
          try {
            const { webSearchService } = await import('./WebSearchService');
            const result = await (webSearchService as any).searchAndSummarize?.(query)
              || await (webSearchService as any).performSearch?.(query)
              || `Search completed for: ${query}`;
            return {
              success: true,
              results: result,
              state: 'completed',
              user_message: `Search completed for: ${query}`,
            };
          } catch {
            logger.error('[NovaVoiceService] web_search failed', { error: err.message });
            return {
              success: false,
              error_code: 'SEARCH_FAILED',
              results: `Search unavailable: ${err.message}`,
              user_message: err.message,
            };
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
      // Find active conversation_id so voice calls show up in the user's chat!
      let conversationId: string | null = null;
      const { data: latestChat } = await supabaseAdmin
        .from('chat_history')
        .select('conversation_id')
        .eq('user_id', userId)
        .not('conversation_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestChat?.conversation_id) {
        conversationId = latestChat.conversation_id;
      } else {
        const { data: conv } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        conversationId = conv?.id || null;
      }

      const now = new Date();
      const rows = transcript.map((entry, idx) => ({
        user_id: userId,
        conversation_id: conversationId,
        role: entry.role === 'nova' ? 'assistant' : 'user',
        content: entry.text,
        created_at: new Date(now.getTime() + idx * 500).toISOString(), // 500ms spacing
        meta: { source: 'voice_session', session_id: sessionId, duration_seconds: durationSeconds },
      }));

      // Insert in batches of 20
      for (let i = 0; i < rows.length; i += 20) {
        await supabaseAdmin.from('chat_history').insert(rows.slice(i, i + 20));
      }
      logger.info('[NovaVoiceService] Transcript saved to chat_history', { count: rows.length, conversationId });
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

      // Process all user turns with their corresponding Nova context
      const pairs: { user: string; nova: string }[] = [];
      for (let i = 0; i < transcript.length; i++) {
        if (transcript[i].role === 'user') {
          const userText = transcript[i].text;
          const nextNova = transcript.slice(i + 1).find((t) => t.role === 'nova')?.text || '';
          pairs.push({ user: userText, nova: nextNova });
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
            const { canonicalEntityEngine } = await import('./CanonicalEntityEngine');
            const { normalizeRelation } = await import('./CanonicalEntityEngine');
            const { memoryRepository } = await import('./memoryRepository');

            // ── RELATION PREFIX MAP ────────────────────────────────────────────────────
            // Maps a key prefix to a normalized relation type (via normalizeRelation).
            // NO HARDCODED PERSONAL NAMES — relation types are resolved from canonical DB.
            const RELATION_PREFIX_MAP: Array<{ prefix: string; relation: string; domain: string }> = [
              { prefix: 'wife_',      relation: 'wife',      domain: 'family' },
              { prefix: 'husband_',   relation: 'husband',   domain: 'family' },
              { prefix: 'son_',       relation: 'son',       domain: 'family' },
              { prefix: 'daughter_',  relation: 'daughter',  domain: 'family' },
              { prefix: 'mother_',    relation: 'mother',    domain: 'family' },
              { prefix: 'father_',    relation: 'father',    domain: 'family' },
              { prefix: 'brother_',   relation: 'brother',   domain: 'family' },
              { prefix: 'sister_',    relation: 'sister',    domain: 'family' },
              { prefix: 'friend_',    relation: 'friend',    domain: 'social' },
              { prefix: 'colleague_', relation: 'colleague', domain: 'work'   },
              { prefix: 'dog_',       relation: 'dog',       domain: 'lifestyle' },
              { prefix: 'pet_',       relation: 'pet',       domain: 'lifestyle' },
              { prefix: 'partner_',   relation: 'partner',   domain: 'family' },
            ];

            // Cache of relation→bubble for this extraction run (avoids N+1 DB queries)
            const resolvedEntityCache = new Map<string, { id: string; label: string } | null>();

            const resolveEntityByRelation = async (
              relation: string
            ): Promise<{ id: string; label: string } | null> => {
              const normRel = normalizeRelation(relation);
              if (resolvedEntityCache.has(normRel)) return resolvedEntityCache.get(normRel)!;

              // Look up the canonical bubble for this user with this relation_type
              const { data: bubble } = await supabaseAdmin
                .from('memory_bubbles')
                .select('id, label')
                .eq('user_id', userId)
                .eq('bubble_type', 'entity')
                .eq('is_archived', false)
                .ilike('relation_type', normRel)
                .maybeSingle();

              const result = bubble ? { id: bubble.id, label: bubble.label } : null;
              resolvedEntityCache.set(normRel, result);
              return result;
            };

            for (const a of memoryActions) {
              if (a.data?.key && a.data?.value) {
                try {
                  const keyStr = a.data.key.toLowerCase();

                  // Detect if key has a relation prefix
                  const matchedPrefix = RELATION_PREFIX_MAP.find(({ prefix }) => keyStr.startsWith(prefix));

                  if (matchedPrefix) {
                    // Try to find the canonical entity bubble by relation type (DB-driven)
                    const existingEntity = await resolveEntityByRelation(matchedPrefix.relation);

                    if (existingEntity) {
                      // Entity exists — attach fact to its canonical bubble
                      await canonicalEntityEngine.attachFactToEntity(
                        userId,
                        existingEntity.id,
                        a.data.key,
                        a.data.value,
                        {
                          source: 'live_voice',
                          confidence: 0.9,
                          acquisitionMode: 'user_stated',
                          timestamp: new Date().toISOString(),
                          evidenceText: pair.user,
                        }
                      );
                      logger.info('[NovaVoiceService] Fact attached to canonical entity via relation lookup', {
                        key: a.data.key,
                        entityId: existingEntity.id,
                        entityLabel: existingEntity.label,
                        relation: matchedPrefix.relation,
                      });
                    } else {
                      // Entity does NOT exist yet for this user with this relation.
                      // Cannot auto-create without a name — save as user-level fact for now.
                      // The next chat turn will canonicalize it via EntityResolutionService.
                      logger.info('[NovaVoiceService] No canonical entity found for relation, saving as user-level fact for deferred canonicalization', {
                        key: a.data.key,
                        relation: matchedPrefix.relation,
                      });
                      // Map domain strings to valid MemoryType values
                      const domainToMemType = (d: string): import('../types/memory').MemoryType => {
                        if (d === 'work') return 'work';
                        if (d === 'family') return 'family';
                        if (d === 'goals') return 'goals';
                        return 'personal'; // social, lifestyle → personal
                      };
                      await memoryRepository.upsertMemory(userId, {
                        key: a.data.key,
                        value: a.data.value,
                        type: domainToMemType(matchedPrefix.domain),
                        importance: 6,
                        confidence: 0.85,
                        shouldPersist: true,
                        source_authority: 'deterministic',
                      }, pair.user);
                    }
                  } else {
                    // No relation prefix — legitimate user-level memory (lifestyle, goals, etc.)
                    const validTypes = ['family','personal','work','goals','preferences','health','important_dates'];
                    const rawType = a.data.domain || a.data.type || 'personal';
                    const safeType = validTypes.includes(rawType)
                      ? rawType as import('../types/memory').MemoryType
                      : 'personal' as const;
                    await memoryRepository.upsertMemory(userId, {
                      key: a.data.key,
                      value: a.data.value,
                      type: safeType,
                      importance: 6,
                      confidence: 0.9,
                      shouldPersist: true,
                      source_authority: 'deterministic',
                    }, pair.user);
                  }
                } catch (e: any) {
                  logger.warn('[NovaVoiceService] Canonical memory persistence failed', { key: a.data.key, error: e?.message });
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      logger.error('[NovaVoiceService] Transcript memory extraction failed', { error: err.message });
    }
  }

  /**
   * Synthesizes spoken voice audio (WAV base64) for Nova's reply using Gemini Live.
   * Matches Nova's configured voice persona (Kore, Aoede, Charon, Fenrir, Puck).
   */
  async synthesizeVoiceReply(
    text: string,
    voiceName = 'Kore'
  ): Promise<{ audio_base64: string; duration_seconds: number } | null> {
    if (!text || !text.trim()) return null;

    // Reject thinking phrases, fallback messages, and status placeholders immediately
    if (isInterimThinkingPhrase(text)) {
      logger.warn('[NovaVoiceService] Refusing to synthesize voice reply for thinking/fallback phrase', {
        textSnippet: text.slice(0, 60),
      });
      return null;
    }

    // Clean text of internal tags, system markers, and verbal hesitation prefixes
    const cleanText = this.sanitizeTextForSpeech(text);
    if (!cleanText || isInterimThinkingPhrase(cleanText)) {
      logger.warn('[NovaVoiceService] Text empty or thinking phrase after prefix strip, aborting voice synthesis', {
        cleanTextSnippet: cleanText?.slice(0, 60),
      });
      return null;
    }

    const candidateKeys: string[] = [];
    try {
      const primaryKey = geminiLivePool.getDirectKey();
      if (primaryKey) candidateKeys.push(primaryKey);
    } catch {}

    for (let i = 5; i <= 19; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim() && !candidateKeys.includes(k.trim())) {
        candidateKeys.push(k.trim());
      }
    }
    for (let i = 1; i <= 4; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim() && !candidateKeys.includes(k.trim())) {
        candidateKeys.push(k.trim());
      }
    }
    if (process.env.GEMINI_API_KEY && !candidateKeys.includes(process.env.GEMINI_API_KEY.trim())) {
      candidateKeys.push(process.env.GEMINI_API_KEY.trim());
    }

    if (candidateKeys.length === 0) {
      logger.warn('[NovaVoiceService] No key available for synthesizeVoiceReply');
      return null;
    }

    // Snappy timeout: 12s base, up to 22s for longer paragraphs (Gemini Live native audio generates in ~2-4s)
    const timeoutMs = Math.max(12000, Math.min(22000, Math.round(cleanText.length * 100)));

    const attempts = Math.min(candidateKeys.length, 2);
    for (let i = 0; i < attempts; i++) {
      const key = candidateKeys[i];
      try {
        const result = await this.synthesizeWithKey(cleanText, voiceName, key, timeoutMs);
        if (result) return result;
      } catch (err: any) {
        logger.warn('[NovaVoiceService] Key attempt failed in voice synthesis, trying next key', {
          attempt: i + 1,
          error: err?.message,
        });
      }
    }

    return null;
  }

  /**
   * Sanitizes assistant text for clear, natural spoken delivery by removing
   * internal bubble separators, markdown tags, emojis, and verbal hesitations.
   */
  sanitizeTextForSpeech(text: string): string {
    if (!text) return '';
    let cleaned = text
      .replace(/<NOVA_MESSAGE_BREAK>/gi, '. ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/#+\s*/g, '')
      .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return stripThinkingPrefix(cleaned);
  }

  private synthesizeWithKey(
    cleanText: string,
    voiceName: string,
    key: string,
    timeoutMs = 25000
  ): Promise<{ audio_base64: string; duration_seconds: number } | null> {
    return new Promise((resolve) => {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
      const ws = new WebSocket(wsUrl);
      const pcmChunks: Buffer[] = [];
      let resolved = false;

      const finish = (result: { audio_base64: string; duration_seconds: number } | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve(result);
      };

      const timeout = setTimeout(() => {
        logger.warn('[NovaVoiceService] synthesizeVoiceReply attempt timed out', {
          timeoutMs,
          keyPrefix: key.slice(0, 8),
        });
        finish(null);
      }, timeoutMs);

      ws.on('open', () => {
        const setupFrame = {
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-latest',
            systemInstruction: {
              parts: [
                {
                  text: 'You are Nova\'s text-to-speech voice engine. Your sole job is to speak aloud and voice the provided text verbatim in natural, warm spoken dialogue. Do not respond, do not answer questions, do not converse, and do not add any words of your own. Speak the exact input text word-for-word.',
                },
              ],
            },
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          },
        };
        ws.send(JSON.stringify(setupFrame));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.setupComplete !== undefined) {
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: 'user',
                      parts: [{ text: `Speak aloud word-for-word: "${cleanText}"` }],
                    },
                  ],
                  turnComplete: true,
                },
              })
            );
          }

          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData?.data) {
                const buf = Buffer.from(part.inlineData.data, 'base64');
                pcmChunks.push(buf);
              }
            }
          }

          if (msg.serverContent?.turnComplete) {
            const totalPcm = Buffer.concat(pcmChunks);
            if (totalPcm.length === 0) {
              return finish(null);
            }
            const wav = pcmToWav(totalPcm, 24000);
            const duration = Math.round((totalPcm.length / (24000 * 2)) * 10) / 10;
            logger.info('[NovaVoiceService] Synthesized voice reply successfully', {
              durationSeconds: duration,
              wavBytes: wav.length,
              voiceName,
            });
            finish({ audio_base64: wav.toString('base64'), duration_seconds: duration });
          }
        } catch (err: any) {
          logger.warn('[NovaVoiceService] Error during voice synthesis message processing', { error: err?.message });
        }
      });

      ws.on('error', (err) => {
        logger.warn('[NovaVoiceService] synthesizeVoiceReply WS error', { error: err?.message, keyPrefix: key.slice(0, 8) });
        finish(null);
      });

      ws.on('close', () => {
        if (!resolved) {
          finish(null);
        }
      });
    });
  }

  /**
   * Transcribes and understands user voice recording using Gemini multimodal input.
   * Leverages gemini-3.6-flash across voice-dedicated key pool with automatic fallback.
   */
  async transcribeAudio(audioBase64: string, explicitMimeType?: string): Promise<string> {
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new Error('VOICE_FILE_INVALID: audio payload is empty or not a string');
    }

    const cleanB64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '').trim();
    if (cleanB64.length < 50) {
      throw new Error('VOICE_FILE_INVALID: audio payload is too small');
    }

    const audioBuf = Buffer.from(cleanB64, 'base64');
    if (audioBuf.length < 100) {
      throw new Error('VOICE_FILE_INVALID: decoded audio buffer is under 100 bytes');
    }

    const detectedMime = explicitMimeType && explicitMimeType !== 'audio/wav'
      ? explicitMimeType
      : detectAudioMimeType(audioBuf);

    logger.info('[NovaVoiceService] Transcribing voice note', {
      byteLength: audioBuf.length,
      b64Length: cleanB64.length,
      detectedMime,
    });

    const candidateKeys: string[] = [];

    // 1. Primary: Direct key from voice pool
    try {
      const primaryKey = geminiLivePool.getDirectKey();
      if (primaryKey) candidateKeys.push(primaryKey);
    } catch {}

    // 2. All voice-dedicated keys GEMINI_API_KEY_5 to GEMINI_API_KEY_19
    for (let i = 5; i <= 19; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim() && !candidateKeys.includes(k.trim())) {
        candidateKeys.push(k.trim());
      }
    }

    // 3. Fallback: text keys 1-4 and GEMINI_API_KEY
    for (let i = 1; i <= 4; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim() && !candidateKeys.includes(k.trim())) {
        candidateKeys.push(k.trim());
      }
    }
    if (process.env.GEMINI_API_KEY && !candidateKeys.includes(process.env.GEMINI_API_KEY.trim())) {
      candidateKeys.push(process.env.GEMINI_API_KEY.trim());
    }

    if (candidateKeys.length === 0) {
      throw new Error('VOICE_AUDIO_PROCESSING_FAILED: No Gemini API keys configured');
    }

    let lastError: any = null;
    const maxAttempts = Math.min(candidateKeys.length, 3);

    for (let i = 0; i < maxAttempts; i++) {
      const key = candidateKeys[i];
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Transcription request timed out after 6s')), 6000);
        });

        const result: any = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: [
              {
                text: 'You are Nova\'s Voice Ingress Processor. Listen to this user audio recording. Accurately transcribe and understand the user\'s spoken words verbatim in their spoken language (English, Hindi, Hinglish, or mixed). Output ONLY the verbatim spoken words without quotation marks, markdown, or any introductory conversational commentary. If the audio is completely silent or contains only inaudible static/noise with no speech, output "[silence]".',
              },
              {
                inlineData: {
                  data: cleanB64,
                  mimeType: detectedMime,
                },
              },
            ],
          }),
          timeoutPromise,
        ]);

        const rawText = result.text ? result.text.trim() : '';
        const cleaned = rawText.replace(/^["']|["']$/g, '').trim();

        if (!cleaned || cleaned === '[silence]' || cleaned === '[unintelligible]') {
          logger.warn('[NovaVoiceService] Audio contained silence or inaudible speech', { rawText });
          throw new Error('VOICE_AUDIO_PROCESSING_FAILED: Audio was silent or inaudible');
        }

        logger.info('[NovaVoiceService] Transcribed user voice note successfully', {
          detectedMime,
          length: cleaned.length,
          preview: cleaned.substring(0, 80),
        });

        return cleaned;
      } catch (err: any) {
        lastError = err;
        // If it's silence, don't keep rotating keys since it's the audio content, not a key quota error
        if (err?.message?.includes('silent or inaudible')) {
          throw err;
        }
        logger.warn('[NovaVoiceService] Transcription key attempt failed, trying next key', {
          error: err?.message,
        });
      }
    }

    throw new Error(`VOICE_AUDIO_PROCESSING_FAILED: ${lastError?.message || 'All keys failed'}`);
  }
}

export const novaVoiceService = new NovaVoiceService();
