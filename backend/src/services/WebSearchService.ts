import { logger } from '../lib/logger';
import { chatCompletion } from '../lib/nvidia';
import * as cheerio from 'cheerio';
import axios from 'axios';

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
   * Scrapes DuckDuckGo HTML for a query (keyless, free).
   */
  async executeSearch(query: string): Promise<string | null> {
    logger.info('[WebSearch] Executing live search', { query });
    try {
      const response = await axios.post(
        'https://html.duckduckgo.com/html/',
        `q=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          }
        }
      );

      const $ = cheerio.load(response.data);
      const results: string[] = [];
      
      $('.result').each((i, el) => {
        if (i >= 3) return; // Keep top 3 results
        const title = $(el).find('.result__title').text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();
        if (title && snippet) {
          results.push(`Source: ${title}\nInfo: ${snippet}`);
        }
      });

      if (results.length === 0) return null;
      return `\n\n## LIVE WEB SEARCH RESULTS (Omniscience Protocol)\nYou automatically searched the web for "${query}" and found this:\n` + results.join('\n\n') + `\n\nUse this information to answer the user accurately.`;
    } catch (e) {
      logger.warn('[WebSearch] Search failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
}

export const webSearchService = new WebSearchService();
