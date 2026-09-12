export type ResponseMode = 'HUMAN_CHAT' | 'LONG_CONTEXT';

export interface ResponseConfig {
  mode: ResponseMode;        // Which mode the LLM should use
  maxTokens: number;         // Dynamic token cap
  temperature: number;       // Lower for factual, higher for creative
  shouldOfferTable: boolean; // Whether to append table offer as follow-up bubble
}

export function classifyIntent(message: string, recentHistory: string[] = []): ResponseConfig {
  const lower = message.toLowerCase();
  const len = message.length;
  
  // ── CONTEXT-AWARE OVERRIDES ──
  // If the AI just offered a table (in the last 2 messages) and the user agreed, force LONG_CONTEXT
  const lastAiMessage = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1]?.toLowerCase() : '';
  const secondLastAiMessage = recentHistory.length > 1 ? recentHistory[recentHistory.length - 2]?.toLowerCase() : '';
  
  const aiOfferedTable = (lastAiMessage && lastAiMessage.includes('table format')) || 
                         (secondLastAiMessage && secondLastAiMessage.includes('table format'));
  
  // FIXED: userAgreed must have an EXPLICIT yes word — 'len < 10' alone was triggering
  // LONG_CONTEXT mode for ANY short message ("Hi", "Supp", "ok") after Nova ever said
  // "table format" in any previous message, producing irrelevant structured tables.
  const hasExplicitAgreement = /\b(sure|yes|ha|haan|dikha|bata|karo|give|please|yep|yeah|show|dikh|ok|okay)\b/i.test(lower);
  const userAgreed = hasExplicitAgreement && len < 30; // Short AND explicit — not just short
  
  if (aiOfferedTable && userAgreed) {
    return { mode: 'LONG_CONTEXT', maxTokens: 1500, temperature: 0.5, shouldOfferTable: false };
  }

  // ── TABLE / LONG_CONTEXT triggers (explicit depth requests) ──
  const explainPatterns = /\b(explain|detail|difference|compare|research|samjhao|batao in detail|deep dive|analysis|pros and cons|list.*(options|features)|step by step)\b/i;
  if (explainPatterns.test(lower)) {
    // Provide a detailed explanation, then auto-probe with a table offer
    return { mode: 'LONG_CONTEXT', maxTokens: 1000, temperature: 0.7, shouldOfferTable: true };
  }
  
  const creativePatterns = /\b(write|poem|story|email|draft|script|lyrics|article|letter|essay|speech)\b/i;
  if (creativePatterns.test(lower)) {
    return { mode: 'LONG_CONTEXT', maxTokens: 2048, temperature: 0.9, shouldOfferTable: false };
  }
  
  const tablePatterns = /\b(table|chart|comparison|spreadsheet|excel)\b/i;
  if (tablePatterns.test(lower)) {
    // User explicitly asked for a table — go straight to LONG_CONTEXT
    return { mode: 'LONG_CONTEXT', maxTokens: 1500, temperature: 0.5, shouldOfferTable: false };
  }
  
  // ── HUMAN_CHAT mode (everything else) ──
  
  // Ultra-short casual (under 60 chars, no question intent)
  // These are the most common Indian chat replies: "ok", "haan", "ha", "correct", "theek hai"
  // Nova MUST move the conversation forward with 2 bubbles — needs room for that.
  if (len < 60 && !lower.includes('?') && !/\b(kya|kab|kaise|kitna|kyun|how|what|when|why|who)\b/.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 300, temperature: 0.7, shouldOfferTable: false };
  }
  
  // Direct factual questions
  const factualPatterns = /\b(how old|kitna|kab|what.?s (my|his|her)|name kya|time kya|age kya|when did|kitne din|kitne saal)\b/i;
  if (factualPatterns.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 350, temperature: 0.5, shouldOfferTable: false };
  }
  
  // Emotional / vent
  const emotionalPatterns = /\b(feel|sad|happy|angry|bura laga|khush|tension|stress|jhagda|fight|cry|ro raha|dukhi|pareshan)\b/i;
  if (emotionalPatterns.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 400, temperature: 0.75, shouldOfferTable: false };
  }
  
  // Default: Human chat, medium budget — enough for 2 proper bubbles
  return { mode: 'HUMAN_CHAT', maxTokens: 450, temperature: 0.7, shouldOfferTable: false };
}

export interface ContextualOptionsInput {
  message: string;
  replyText: string;
  language?: string;
  mode?: ResponseMode;
}

/**
 * Synthesize smart, contextual quick-reply options (2-3 chips) when the LLM
 * did not output explicit <OPTIONS> tags or when JSON was malformed.
 * Tailored dynamically to lifestyle context (student, founder, fitness, task, venting)
 * and language (Hindi/Hinglish vs English).
 */
export function synthesizeContextualOptions(input: ContextualOptionsInput): string[] {
  const { message, replyText, language = 'auto' } = input;
  const lowerMsg = (message || '').toLowerCase();
  const lowerReply = (replyText || '').toLowerCase();

  const isHindi = language === 'hi' || (language !== 'en' && /\b(kya|hai|ho|kar|raha|rahi|bhai|yaar|nahi|hain|mujhe|mera|teri|tere|thoda|accha|theek|suno|bolo|kaise|karo|batao|aaj|kal|parso)\b/i.test(message + ' ' + replyText));

  // 1. Reminder / Task confirmation or routine check
  if (/\b(remind|reminder|schedule|alarm|task|yaad|routine|target)\b/i.test(lowerMsg) || /\b(reminder set|set kar diya|yaad dila|schedule kiya|noted)\b/i.test(lowerReply)) {
    return isHindi 
      ? ['Kab remind karu?', 'Show my tasks', 'All set, thanks!']
      : ['When should I remind you?', 'Show my tasks', 'All set, thanks!'];
  }

  // 2. Planning, studying, or student aspirant
  if (/\b(exam|study|syllabus|notes|revision|prepare|college|semester|mock test|padhai)\b/i.test(lowerMsg) || /\b(study|revision|padhai)\b/i.test(lowerReply)) {
    return isHindi
      ? ['Daily study plan bana do', 'Key points summarise karo', 'Quick quiz lo']
      : ['Make a daily study plan', 'Summarize key points', 'Give me a quick quiz'];
  }

  // 3. Work, startup, productivity, builder
  if (/\b(work|office|client|meeting|presentation|pitch|code|bug|project|deadline|sprint|kaam)\b/i.test(lowerMsg)) {
    return isHindi
      ? ['Next step kya karein?', 'Draft quick notes', 'Focus mode on karo']
      : ['What is the next step?', 'Draft quick notes', 'Set a focus block'];
  }

  // 4. Fitness, gym, health, routine
  if (/\b(gym|workout|diet|calories|exercise|run|running|health|protein|fat|vazan|kasrat)\b/i.test(lowerMsg)) {
    return isHindi
      ? ['Workout log karo', 'Diet tips do', 'Water reminder set karo']
      : ['Log this workout', 'Give diet tips', 'Remind me to hydrate'];
  }

  // 5. Emotional vent / stress / companionship
  if (/\b(feel|tired|exhausted|sad|tension|stress|lonely|bored|dukhi|pareshan|thak gaya|thak gayi)\b/i.test(lowerMsg)) {
    return isHindi
      ? ['Thoda baat karein?', 'Distract me please', 'I need a break']
      : ["Let's chat a bit", 'Distract me please', 'I need a break'];
  }

  // 6. Factual / Explanatory followup
  if (/\b(explain|detail|difference|compare|why|kaise|samjhao|batao)\b/i.test(lowerMsg)) {
    return isHindi
      ? ['Example ke saath batao', 'Table format me dikhao', 'Short summary do']
      : ['Give an example', 'Show in a table', 'Give a short summary'];
  }

  // 7. General friendly conversational progression
  if (lowerReply.includes('?') || lowerMsg.includes('?')) {
    return isHindi
      ? ['Haan bilkul', 'Thoda aur batao', 'Nahi, baad me']
      : ['Yes, definitely', 'Tell me more', 'Not right now'];
  }

  return [];
}

