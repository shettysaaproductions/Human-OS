import { logger } from '../lib/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiPool } from '../lib/geminiPool';
import { supabaseAdmin } from '../lib/supabase';

export class VisionService {
  /**
   * Analyzes an image to determine the user's current context.
   * Uses Gemini 1.5 Flash Vision capabilities.
   */
  async analyzeContextImage(userId: string, frontImageBase64?: string, rearImageBase64?: string, mimeType: string = 'image/jpeg'): Promise<string | null> {
    const key = geminiPool.getNextKey();
    if (!key) {
      logger.warn('[VisionService] No Gemini API keys available for vision analysis.');
      return null;
    }
    if (!frontImageBase64 && !rearImageBase64) {
      logger.warn('[VisionService] No images provided for vision analysis.');
      return null;
    }

    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const prompt = "Describe what the user is currently doing based on the provided images in exactly 15 words or less. If there are two images, one is the front camera (the user's face) and the other is the rear camera (their environment). Combine the context into a single seamless observation (e.g., 'User is working on a laptop in a dark bedroom', 'User is smiling while walking through a park'). Do not mention 'camera', 'image', 'front', or 'rear' in your description.";
      
      const parts: any[] = [prompt];
      
      if (frontImageBase64) {
        parts.push({ inlineData: { data: frontImageBase64, mimeType: mimeType } });
      }
      if (rearImageBase64) {
        parts.push({ inlineData: { data: rearImageBase64, mimeType: mimeType } });
      }
      
      const result = await model.generateContent(parts);

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
