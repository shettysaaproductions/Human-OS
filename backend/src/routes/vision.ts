import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { visionService } from '../services/VisionService';
import { logger } from '../lib/logger';

export const visionRouter: Router = Router();

// Zod schema for vision snap validation
const VisionSnapSchema = z.object({
  user_id: z.string().uuid(),
  front_image_base64: z.string().optional(), // Front camera (user)
  rear_image_base64: z.string().optional(), // Rear camera (environment)
  mime_type: z.string().optional().default('image/jpeg'),
});

visionRouter.post('/snap', async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = VisionSnapSchema.parse(req.body);
    const { user_id, front_image_base64, rear_image_base64, mime_type } = validatedData;
    
    // Process images in the background
    visionService.analyzeContextImage(user_id, front_image_base64, rear_image_base64, mime_type).catch(e => {
      logger.error('[VisionRouter] Background vision processing failed', { error: e });
    });
    
    res.status(202).json({ status: 'accepted', message: 'Vision snap received and processing.' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid payload', details: error.errors });
      return;
    }
    logger.error('[VisionRouter] Failed to handle vision snap', { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
