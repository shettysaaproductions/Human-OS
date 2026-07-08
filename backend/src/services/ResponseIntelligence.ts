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
  
  const userAgreed = /\b(sure|yes|ha|haan|dikha|bata|ok|okay|karo|give|please|yep|yeah)\b/i.test(lower) || len < 10;
  
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
  if (len < 60 && !lower.includes('?') && !/\b(kya|kab|kaise|kitna|kyun|how|what|when|why|who)\b/.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 150, temperature: 0.9, shouldOfferTable: false };
  }
  
  // Direct factual questions
  const factualPatterns = /\b(how old|kitna|kab|what.?s (my|his|her)|name kya|time kya|age kya|when did|kitne din|kitne saal)\b/i;
  if (factualPatterns.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 256, temperature: 0.5, shouldOfferTable: false };
  }
  
  // Emotional / vent
  const emotionalPatterns = /\b(feel|sad|happy|angry|bura laga|khush|tension|stress|jhagda|fight|cry|ro raha|dukhi|pareshan)\b/i;
  if (emotionalPatterns.test(lower)) {
    return { mode: 'HUMAN_CHAT', maxTokens: 300, temperature: 0.85, shouldOfferTable: false };
  }
  
  // Default: Human chat, medium budget
  return { mode: 'HUMAN_CHAT', maxTokens: 400, temperature: 0.85, shouldOfferTable: false };
}
