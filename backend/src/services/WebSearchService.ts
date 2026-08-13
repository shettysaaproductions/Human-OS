import { logger } from '../lib/logger';
import { chatCompletionBackground } from '../lib/nvidia';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiPool } from '../lib/geminiPool';

export class WebSearchService {
  /**
   * Evaluates if a message requires a live web search.
   * Returns a search query if needed, or null if not.
   */
  async evaluateSearchNeed(message: string): Promise<string | null> {
    const lower = message.toLowerCase().trim();
    
    // ── Fast-path keyword detection (no LLM call needed) ─────────────────
    // Covers English + Hinglish search intents without burning NVIDIA tokens.
    const SEARCH_TRIGGERS = [
      // English
      'search', 'google', 'look up', 'find out', 'what is', 'who is', 'where is',
      'how to', 'latest news', 'current', 'today\'s', 'right now', 'live score',
      'stock price', 'weather', 'temperature', 'cricket score', 'ipl', 'icc',
      'news', 'headline', 'breaking', 'trending', 'what happened',
      // Hinglish / Hindi
      'aaj ka mausam', 'mausam kaisa', 'weather kya', 'news kya', 'kya hua',
      'kaisa chal raha', 'live score', 'score kya hai', 'kitna hua',
      'search kar', 'dhundh', 'pata karo', 'batao kya hai', 'latest kya',
      'abhi kya ho raha', 'aaj ka news', 'kal ki news', 'rate kya hai',
      'price kya hai', 'kab hua', 'kahan hua', 'kaun hai',
    ];
    
    const EXCLUDED_PATTERNS = [
      // These look like search but are personal/conversational
      'what is your', 'what are you', 'who are you', 'what do you think',
      'mujhe lagta', 'kya lagta', 'tera kya', 'tumhara kya', 'mera kya',
    ];
    
    const isExcluded = EXCLUDED_PATTERNS.some(p => lower.includes(p));
    if (isExcluded) return null;
    
    const fastMatch = SEARCH_TRIGGERS.find(t => lower.includes(t));
    if (fastMatch) {
      // Generate a clean search query from the user's message
      // Strip Hinglish filler words to get a clean query
      const cleanQuery = message
        .replace(/^(bhai|yaar|na|toh|karo|kar|please|plz|batao)\s+/i, '')
        .replace(/\s+(kar|bhai|yaar|na|please)$/i, '')
        .trim();
      logger.info('[WebSearch] Fast-path match triggered', { trigger: fastMatch, query: cleanQuery });
      return cleanQuery;
    }
    
    // ── Slow-path: LLM for ambiguous queries (only if no fast-path match) ──
    const prompt = `You are a Search Intent Analyzer for an AI assistant. 
Does this user message require searching the LIVE internet to answer correctly or provide source links?
(E.g., current news, weather, stock prices, recent sports scores, general factual questions, or anything outside of personal chat).

Message: "${message}"

If YES, output ONLY the exact search query you would use (e.g., "current weather in Mumbai" or "who won the F1 race yesterday").
If NO, output exactly "NO_SEARCH".`;

    try {
      const result = await chatCompletionBackground([{ role: 'system', content: prompt }], {
        maxTokens: 50,
        temperature: 0.1
      });
      const res = result.trim();
      if (res === 'NO_SEARCH' || res === '' || res.toLowerCase().includes('no_search')) return null;
      return res;
    } catch (e) {
      logger.warn('[WebSearch] Failed to evaluate search need', { error: e });
      return null;
    }
  }

  /**
   * Scrapes Wikipedia for a query (keyless, free) OR uses Gemini API for Google Search grounding.
   */
  async executeSearch(query: string): Promise<string | null> {
    logger.info('[WebSearch] Executing live search', { query });
    
    // Request a key from the load balancer
    const geminiKey = geminiPool.getNextKey();
    if (geminiKey) {
      logger.info('[WebSearch] Using Gemini Google Search Grounding');
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          tools: [{ googleSearch: {} } as any], // Cast to any to bypass TS typing if it doesn't know googleSearch yet
        });
        
        const prompt = `Search the live web for the following query and provide a detailed, factual summary of the current results. IMPORTANT: You MUST include the source links/URLs (e.g. https://...) for the information you find so the user can verify it. Query: "${query}"`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Empty response = failed search — fall through to Wikipedia (the catch below
        // is not reached on a successful-but-empty call, so we signal it explicitly).
        if (!text || text.trim().length === 0) throw new Error('Gemini returned empty response');

        return `\n\n## LIVE WEB SEARCH RESULTS (Omniscience Protocol)\nYou automatically searched the web using Google Search for "${query}" and found this:\n\n${text}\n\nCRITICAL RULE: When answering the user, you MUST include the source links/URLs provided above so the user can click them (just like ChatGPT does).`;
      } catch (e) {
        logger.warn('[WebSearch] Gemini Search failed, falling back to Wikipedia', { error: e instanceof Error ? e.message : String(e) });
        // Fall through to Wikipedia
      }
    }

    // Fallback to Wikipedia
    logger.info('[WebSearch] Using Wikipedia as fallback');
    try {
      const response = await axios.get(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`,
        { headers: { 'User-Agent': 'NovaAI/1.0 (https://github.com/NovaApp)' } }
      );
      
      const searchResults = response.data?.query?.search;
      if (!searchResults || searchResults.length === 0) return null;
      
      const results: string[] = [];
      for (let i = 0; i < Math.min(3, searchResults.length); i++) {
        const item = searchResults[i];
        if (item.title && item.snippet) {
          // Clean HTML from Wikipedia snippets
          const cleanSnippet = item.snippet.replace(/<[^>]*>?/gm, '');
          results.push(`Source: Wikipedia - ${item.title}\nInfo: ${cleanSnippet}`);
        }
      }

      if (results.length === 0) return null;
      return `\n\n## LIVE WEB SEARCH RESULTS (Omniscience Protocol)\nYou automatically searched the web for "${query}" and found this:\n` + results.join('\n\n') + `\n\nUse this information to answer the user accurately.`;
    } catch (e) {
      logger.warn('[WebSearch] Search failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
}

export const webSearchService = new WebSearchService();
