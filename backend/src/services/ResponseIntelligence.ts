export type ResponseMode = 'HUMAN_CHAT' | 'LONG_CONTEXT';

export interface ResponseConfig {
  mode: ResponseMode;        // Which mode the LLM should use
  maxTokens: number;         // Dynamic token cap
  temperature: number;       // Lower for factual, higher for creative
  shouldOfferTable: boolean; // Whether to append table offer as follow-up bubble
}

export function classifyIntent(message: string, _recentHistory: string[]): ResponseConfig {
  const lower = message.toLowerCase();
  const len = message.length;
  
  // ── LONG_CONTEXT triggers (explicit depth requests) ──
  const explainPatterns = /\b(explain|detail|difference|compare|research|samjhao|batao in detail|deep dive|analysis|pros and cons|list.*(options|features)|step by step)\b/i;
  if (explainPatterns.test(lower)) {
    return { mode: 'LONG_CONTEXT', maxTokens: 1500, temperature: 0.7, shouldOfferTable: true };
  }
  
  const creativePatterns = /\b(write|poem|story|email|draft|script|lyrics|article|letter|essay|speech)\b/i;
  if (creativePatterns.test(lower)) {
    return { mode: 'LONG_CONTEXT', maxTokens: 2048, temperature: 0.9, shouldOfferTable: false };
  }
  
  const tablePatterns = /\b(table|chart|comparison|spreadsheet|excel)\b/i;
  if (tablePatterns.test(lower)) {
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
