import { logger } from '../lib/logger';
import { chatCompletion } from '../lib/nvidia';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class WebSearchService {
  /**
   * Evaluates if a message requires a live web search.
   * Returns a search query if needed, or null if not.
   */
  async evaluateSearchNeed(message: string): Promise<string | null> {
    const prompt = `You are a Search Intent Analyzer for an AI assistant. 
Does this user message require searching the LIVE internet to answer correctly?
(E.g., current news, weather, stock prices, recent sports scores, or highly specific obscure facts not in general training data).

Message: "${message}"

If YES, output ONLY the exact search query you would use (e.g., "current weather in Mumbai" or "who won the F1 race yesterday").
If NO, output exactly "NO_SEARCH".`;

    try {
      const result = await chatCompletion([{ role: 'system', content: prompt }], {
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
    
    // Check if user provided Gemini API Key
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      logger.info('[WebSearch] Using Gemini Google Search Grounding');
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          tools: [{ googleSearch: {} } as any], // Cast to any to bypass TS typing if it doesn't know googleSearch yet
        });
        
        const prompt = `Search the live web for the following query and provide a detailed, factual summary of the current results. Query: "${query}"`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        
        if (!text || text.trim().length === 0) return null;
        
        return `\n\n## LIVE WEB SEARCH RESULTS (Omniscience Protocol)\nYou automatically searched the web using Google Search for "${query}" and found this:\n\n${text}\n\nUse this information to answer the user accurately.`;
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
