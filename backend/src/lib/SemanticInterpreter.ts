/**
 * SemanticInterpreter — Nova's Semantic Meaning Layer (Phase 0)
 *
 * Responsibility: INTERPRETATION ONLY.
 *   - Calls Gemini Flash to understand what the user said.
 *   - Returns a SemanticTurn: intent, facts, corrections, actions, clarification needs.
 *   - NEVER decides what is safe to persist.
 *   - NEVER writes to the database.
 *   - NEVER defaults missing information.
 *
 * Architecture:
 *   User Message
 *       ↓
 *   SemanticInterpreter (this file — LLM)
 *       ↓
 *   SemanticTurn
 *       ↓
 *   SemanticValidator (deterministic checks)
 *       ↓
 *   State Engines (MemoryRepository, ReminderEngine, etc.)
 *       ↓
 *   Supabase
 *
 * Latency contract:
 *   - Runs SYNCHRONOUSLY in the conversational path for turns with actionable
 *     semantics (corrections, reminders, goal updates, clarification resolution).
 *   - SKIPPED entirely for pure CHAT turns (no detected actions needed).
 *   - Hard budget: 400ms. Times out gracefully — returns CHAT intent on timeout
 *     so the conversation is never blocked.
 *
 * The three lines that must never be crossed:
 *   ❌ Never let the LLM become the database's authority.
 *   ❌ Never let regex become the semantic interpreter.
 *   ❌ Never let missing information become an invented default.
 */

import { geminiComplete } from './gemini';
import { logger } from './logger';

// ── SemanticTurn Types ────────────────────────────────────────────────────────

export type TurnIntent =
  | 'CHAT'
  | 'QUESTION'
  | 'MEMORY'
  | 'CORRECTION'
  | 'REMINDER'
  | 'GOAL_UPDATE'
  | 'MIXED';

/**
 * A fact the user expressed about themselves or their life.
 * e.g. "Meri wife Sakshi hai" → { concept: 'wife_name', value: 'Sakshi', ... }
 */
export interface SemanticFact {
  concept: string;        // raw concept label (NOT yet a canonical key)
  value: string;
  confidence: number;     // 0–1
  /** True if the value appears literally in the user's message text */
  groundedInTurn: boolean;
}

/**
 * A correction the user is making to a previously stated fact.
 * e.g. "Mera naam Ravi nahi, Rajesh hai" → corrects user_name to Rajesh
 */
export interface SemanticCorrection {
  concept: string;
  new_value: string;
  prior_value?: string;   // what LLM believes was stated before (optional)
  intent: 'replace' | 'append' | 'delete';
  confidence: number;
  /** True if the corrected value appears literally in the user's message */
  groundedInTurn: boolean;
}

/**
 * An action the user wants Nova to perform — reminder, goal update, etc.
 * completenessScore < 1.0 means the action requires clarification before it
 * can be passed to the state engine. Missing fields are listed explicitly.
 * The interpreter NEVER fills in defaults for missing fields.
 */
export interface SemanticAction {
  type: 'REMINDER' | 'GOAL_UPDATE' | 'EVENT' | 'WEBHOOK';
  data: Record<string, any>;
  /** 0–1. Only 1.0 means the action is complete and ready to execute. */
  completenessScore: number;
  /** Fields that MUST be provided by the user before this action can proceed. */
  missingFields: string[];
}

/**
 * Stateful clarification pending from a previous turn.
 * Stored in working_memory so it survives across messages.
 *
 * Scoping invariant: Resolution is scoped to the pending action only.
 * New facts or actions in the same clarification-reply turn are processed
 * as independent semantic items — they do NOT contaminate the pending context
 * and the pending context does NOT suppress them.
 *
 * Example A (resolution + new fact):
 *   Nova: "Shaam ko kaunse time remind karun?"
 *   User: "7 baje, aur waise meri favourite colour blue hai."
 *   → resolves reminder at 19:00 ✓
 *   → saves favourite_colour:blue as new independent fact ✓
 *
 * Example B (resolution only):
 *   Nova: "Shaam ko kaunse time remind karun?"
 *   User: "7 baje"
 *   → resolves reminder at 19:00 ✓
 *   → does NOT generate any unrelated memory from context ✓
 */
export interface PendingClarification {
  type: 'REMINDER' | 'CORRECTION' | 'GOAL_UPDATE';
  /** turnId of the turn that created this pending state */
  turnId: string;
  /** The incomplete action or correction waiting for more info */
  originalAction: SemanticAction | SemanticCorrection;
  /** What information is still needed */
  missingFields: string[];
  /** The exact question Nova asked the user */
  askedQuestion: string;
  /** Unix ms — pending clarification expires after this time */
  expiresAt: number;
}

/**
 * The canonical output of SemanticInterpreter per user turn.
 * Consumed by SemanticValidator, MemoryRepository, ReminderEngine, etc.
 */
export interface SemanticTurn {
  turnId: string;
  sourceMessageId: string;
  intent: TurnIntent;
  facts: SemanticFact[];
  corrections: SemanticCorrection[];
  actions: SemanticAction[];
  clarification: {
    required: boolean;
    question?: string;
    missingFields?: string[];
  };
  /**
   * Set when the user is responding to a previous Nova clarification question.
   *
   * Scoping: resolution is ONLY for the pending action identified by
   * pendingTurnId. Other facts/actions in this same turn are processed
   * through the normal pipeline as a separate, independent batch.
   */
  resolvesPending?: {
    pendingTurnId: string;
    resolvedFields: Record<string, string>;
    /** Independent facts/actions from this turn (unrelated to the pending clarification) */
    additionalFacts: SemanticFact[];
    additionalActions: SemanticAction[];
  };
  confidence: number;
}

// ── Query-aware retrieval mode ─────────────────────────────────────────────────

/**
 * Memory retrieval budget driven by semantic need, not an arbitrary fixed number.
 * Derived from SemanticTurn intent + query signals.
 */
export type RetrievalMode = 'minimal' | 'personal' | 'historical' | 'planning';

export const RETRIEVAL_BUDGETS: Record<RetrievalMode, number> = {
  minimal:   3,
  personal:  6,
  historical: 10,
  planning:  12,
};

export function deriveRetrievalMode(turn: SemanticTurn, rawMessage: string): RetrievalMode {
  const lower = rawMessage.toLowerCase();
  // Planning signals
  if (turn.intent === 'GOAL_UPDATE' || /plan|goal|target|schedule|roadmap/.test(lower)) {
    return 'planning';
  }
  // Historical recall signals
  if (/pehle|last time|yaad hai|yaad kar|remember when|earlier/.test(lower)) {
    return 'historical';
  }
  // Personal fact lookup
  if (
    turn.intent === 'QUESTION' &&
    /wife|husband|son|daughter|bhai|sister|mom|dad|naam|name|age|umar|birthday/.test(lower)
  ) {
    return 'personal';
  }
  // Corrections always need personal context to find what they're correcting
  if (turn.intent === 'CORRECTION' || turn.corrections.length > 0) {
    return 'personal';
  }
  // Memory-storing turn — need context to avoid duplicates
  if (turn.intent === 'MEMORY' || turn.facts.length > 0) {
    return 'personal';
  }
  return 'minimal';
}

// ── Interpreter ───────────────────────────────────────────────────────────────

/** Hard latency budget for actionable turns (ms) */
const INTERPRETER_BUDGET_MS = 400;

/** Soft pre-check: is this turn likely to need semantic interpretation at all? */
function isLikelyActionable(message: string): boolean {
  if (message.length > 100) return true;
  const lower = message.toLowerCase();
  return /remind|yaad|timer|alarm|schedule|correct|nahi|galat|actually|woh nahi|naam|wife|husband|son|daughter|bhai|sis|goal|plan|remember|save|note|favourite|favorite/.test(lower);
}

const INTERPRETER_SYSTEM_PROMPT = `You are a semantic understanding engine for a personal AI companion called Nova.
Your ONLY job is to analyze a user message and return a strict JSON object describing its meaning.
You do NOT generate replies. You do NOT make decisions. You do NOT write to any database.
You extract meaning. Nothing else.

The user speaks Hinglish (Hindi + English mix). You MUST understand Hinglish naturally.
Do NOT teach English. Do NOT teach Hindi grammar. Just understand what they mean.

You MUST return a valid JSON object matching exactly this schema:

{
  "intent": "CHAT" | "QUESTION" | "MEMORY" | "CORRECTION" | "REMINDER" | "GOAL_UPDATE" | "MIXED",
  "facts": [
    {
      "concept": "<raw concept name, e.g. wife_name, favourite_colour>",
      "value": "<exact value from user's message>",
      "confidence": <0.0 to 1.0>,
      "groundedInTurn": <true if value literally appears in user's message, false otherwise>
    }
  ],
  "corrections": [
    {
      "concept": "<concept being corrected>",
      "new_value": "<the corrected value from user's message>",
      "prior_value": "<what user says was wrong (optional, may be null)>",
      "intent": "replace" | "append" | "delete",
      "confidence": <0.0 to 1.0>,
      "groundedInTurn": <true if new_value literally appears in user's message>
    }
  ],
  "actions": [
    {
      "type": "REMINDER" | "GOAL_UPDATE" | "EVENT" | "WEBHOOK",
      "data": {
        "task": "<what to remind about>",
        "date": "<YYYY-MM-DD or 'today'/'tomorrow' or null>",
        "time_of_day": "<HH:MM in 24h or null>",
        "time_period": "<'morning'/'evening'/'night' or null>",
        "relative_value": <number or null>,
        "relative_unit": "<'minutes'/'hours'/'days' or null>",
        "event_trigger": "<'wake_up'/'left_the_office' etc or null>",
        "recurrence": "<'daily'/'weekly'/null>"
      },
      "completenessScore": <0.0 to 1.0>,
      "missingFields": ["<field name>", ...]
    }
  ],
  "clarification": {
    "required": <true if the user's intent is clear but info is missing>,
    "question": "<the ONE question Nova should ask, in Hinglish, or null>",
    "missingFields": ["<field name>", ...]
  },
  "confidence": <0.0 to 1.0 overall>
}

CRITICAL RULES:
1. "groundedInTurn" MUST be true ONLY if the value/new_value literally appears in the user's message text. Do NOT set it true for values you infer or assume.
2. For reminders: if the user gave a time period like "evening" but not an exact time, set completenessScore < 1.0 and missingFields: ["exact_time"]. NEVER default to any time.
3. For corrections: include BOTH the corrected value AND what was wrong (if user stated it).
4. "facts" = new information being shared. "corrections" = changing something previously stated.
5. If multiple things are said (e.g. a correction AND a reminder), use intent "MIXED" and fill both arrays.
6. If the message is pure conversation with no fact, correction, action, or question about stored info — use intent "CHAT" with empty arrays.
7. Return ONLY the JSON object. No preamble. No explanation. No markdown.`;

/**
 * Interprets a user message semantically using Gemini Flash.
 *
 * @param message - The raw user message text
 * @param messageId - ID from chat_history (for traceability)
 * @param pendingClarification - Any pending clarification state from the previous turn
 * @param recentContext - Last 1-2 assistant messages for context (optional)
 * @returns SemanticTurn or null if the message is not actionable / timeout occurred
 */
export async function interpretTurn(
  message: string,
  messageId: string,
  pendingClarification?: PendingClarification | null,
  recentContext?: string,
): Promise<SemanticTurn | null> {
  // Fast-path: skip for pure conversational turns
  if (!isLikelyActionable(message)) {
    logger.debug('[SemanticInterpreter] Skipped (not actionable)', { messageId, length: message.length });
    return null;
  }

  const turnId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Build user prompt
  let userPrompt = `User message: "${message}"`;
  if (recentContext) {
    userPrompt += `\n\nRecent context (last assistant message): ${recentContext}`;
  }
  if (pendingClarification) {
    userPrompt += `\n\nPENDING CLARIFICATION CONTEXT: Nova previously asked "${pendingClarification.askedQuestion}" about a pending ${pendingClarification.type}. The user's current message may be answering that question. If it is, identify which fields from missingFields=[${pendingClarification.missingFields.join(', ')}] are now resolved. Any OTHER facts or actions in this message are independent and should be extracted normally.`;
  }

  const messages = [
    { role: 'system' as const, content: INTERPRETER_SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];

  try {
    const raw = await Promise.race([
      geminiComplete(messages, {
        model: 'gemini-1.5-flash',
        maxTokens: 512,
        temperature: 0.1,
        jsonMode: true,
        timeoutMs: INTERPRETER_BUDGET_MS,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), INTERPRETER_BUDGET_MS + 50)),
    ]);

    if (!raw) {
      logger.warn('[SemanticInterpreter] Timed out — returning null (conversation not blocked)', { messageId });
      return null;
    }

    const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as any;

    // Build resolved pending fields if this message answers a clarification
    let resolvesPending: SemanticTurn['resolvesPending'] | undefined;
    if (pendingClarification && parsed.actions?.length > 0) {
      const resolvedFields: Record<string, string> = {};
      const missingSet = new Set(pendingClarification.missingFields);
      const mainAction = parsed.actions[0];

      // Check if any previously-missing fields are now present in the action data
      for (const field of missingSet) {
        const val = mainAction?.data?.[field];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          resolvedFields[field] = String(val);
        }
      }

      if (Object.keys(resolvedFields).length > 0) {
        // Additional independent facts/actions (not part of clarification resolution)
        const additionalFacts: SemanticFact[] = parsed.facts || [];
        const additionalActions: SemanticAction[] = (parsed.actions || []).slice(1);

        resolvesPending = {
          pendingTurnId: pendingClarification.turnId,
          resolvedFields,
          additionalFacts,
          additionalActions,
        };
      }
    }

    const turn: SemanticTurn = {
      turnId,
      sourceMessageId: messageId,
      intent: parsed.intent ?? 'CHAT',
      facts: parsed.facts ?? [],
      corrections: parsed.corrections ?? [],
      actions: parsed.actions ?? [],
      clarification: parsed.clarification ?? { required: false },
      resolvesPending,
      confidence: parsed.confidence ?? 0.5,
    };

    logger.info('[SemanticInterpreter] Turn interpreted', {
      messageId,
      intent: turn.intent,
      facts: turn.facts.length,
      corrections: turn.corrections.length,
      actions: turn.actions.length,
      clarificationRequired: turn.clarification.required,
      resolvesPending: !!resolvesPending,
      confidence: turn.confidence,
    });

    return turn;

  } catch (err) {
    logger.warn('[SemanticInterpreter] Failed to interpret turn — returning null (non-blocking)', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Reads a pending clarification from working_memory.
 * Returns null if none exists or it has expired.
 */
export async function getPendingClarification(
  userId: string,
  supabaseAdmin: any,
): Promise<PendingClarification | null> {
  try {
    const { data } = await supabaseAdmin
      .from('working_memory')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'pending_clarification')
      .maybeSingle();

    if (!data?.value) return null;

    const pending: PendingClarification = JSON.parse(data.value);
    if (Date.now() > pending.expiresAt) {
      // Expired — clean up
      await clearPendingClarification(userId, supabaseAdmin);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

/**
 * Writes a pending clarification to working_memory.
 * Expiry: 10 minutes for reminders, 5 minutes for corrections.
 */
export async function setPendingClarification(
  userId: string,
  pending: Omit<PendingClarification, 'expiresAt'>,
  supabaseAdmin: any,
): Promise<void> {
  const ttlMs = pending.type === 'REMINDER' ? 10 * 60 * 1000 : 5 * 60 * 1000;
  const full: PendingClarification = { ...pending, expiresAt: Date.now() + ttlMs };

  await supabaseAdmin.from('working_memory').upsert({
    user_id: userId,
    key: 'pending_clarification',
    value: JSON.stringify(full),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,key' });
}

/**
 * Clears the pending clarification from working_memory.
 * Called after successful resolution or expiry.
 */
export async function clearPendingClarification(
  userId: string,
  supabaseAdmin: any,
): Promise<void> {
  await supabaseAdmin
    .from('working_memory')
    .delete()
    .eq('user_id', userId)
    .eq('key', 'pending_clarification');
}
