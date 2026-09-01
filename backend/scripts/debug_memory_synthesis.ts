import { config } from 'dotenv';
config();
import { candidateSynthesisService } from '../src/services/CandidateSynthesisService';
import { supabaseAdmin } from '../src/lib/supabase';
import { logger } from '../src/lib/logger';
import { cognitiveRouter } from '../src/lib/cognitiveRouter';

async function run() {
  logger.info('Starting raw evidence packet build & evaluation...');
  const testUserId = '32996d46-e2ca-4b85-9467-285ca848a771';
  
  try {
    // We bypass the orchestration and directly call the internal methods
    // We use any casting to bypass private restrictions for this debug script
    const svc = candidateSynthesisService as any;
    
    logger.info('Building evidence packet...');
    const packet = await svc.buildEvidencePacket(testUserId);
    logger.info(`Packet built. Working memory items: ${packet.workingMemoryRecords.length}`);
    
    logger.info('Evaluating with Gemini...');
    const result = await svc.evaluateWithGemini(packet);
    logger.info('Gemini evaluation success!', result);
  } catch (err: any) {
    logger.error('Caught exception during raw execution', {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
      name: err.name,
      fullErr: err
    });
  }
}

run().catch(console.error);
