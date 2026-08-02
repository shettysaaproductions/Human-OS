import { logger } from '../lib/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiPool } from '../lib/geminiPool';
import { supabaseAdmin } from '../lib/supabase';

export class VisionService {
  /**
   * Analyzes an image to determine the user's current context.
   * Uses Gemini 1.5 Flash Vision capabilities.
   */
  async analyzeContextImage(userId: string, imageBase64: string, mimeType: string = 'image/jpeg'): Promise<string | null> {
    const key = geminiPool.getNextKey();
    if (!key) {
      logger.warn('[VisionService] No Gemini API keys available for vision analysis.');
      return null;
    }

    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const prompt = "Describe what the user is currently doing based on this image in exactly 10 words or less. Focus purely on their activity and environment (e.g., 'Working on a laptop in a dark room', 'Driving a car on a highway', 'Sleeping in bed'). Do not mention the camera or photo itself.";
      
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType
          }
        }
      ]);

      const text = result.response.text();
      if (text && text.trim().length > 0) {
        const visualContext = text.trim();
        logger.info('[VisionService] Successfully analyzed image', { userId, context: visualContext });
        
        // Save to database
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ current_visual_context: visualContext })
          .eq('id', userId);
          
        if (error) {
          logger.error('[VisionService] Failed to save visual context to DB', { userId, error: error.message });
        }
        
        return visualContext;
      }
      return null;
    } catch (error) {
      logger.error('[VisionService] Image analysis failed', { userId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}

export const visionService = new VisionService();
