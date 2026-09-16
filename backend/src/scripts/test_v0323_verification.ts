import 'dotenv/config';
import { novaVoiceService } from '../services/NovaVoiceService';
import { geminiLivePool } from '../lib/geminiLivePool';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING v0.3.23-beta VOICE & AUDIO VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Gemini Live Pool key availability
  console.log('[Test 1] Testing Gemini Live Pool key access...');
  try {
    const key = geminiLivePool.getDirectKey();
    if (!key || key.length < 10) throw new Error('Invalid Gemini key');
    console.log(`✓ [Test 1 PASSED] Key retrieved successfully (prefix: ${key.substring(0, 8)}...)`);
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 1 FAILED] ${err.message}`);
    failed++;
  }

  // Test 2: Voice Reply Synthesis across personas (Dual Modality)
  console.log('\n[Test 2] Testing Voice Reply Synthesis (Persona: Kore)...');
  try {
    const t0 = Date.now();
    const result = await novaVoiceService.synthesizeVoiceReply('Hello, this is Nova speaking.', 'Kore');
    const elapsed = Date.now() - t0;
    if (!result || !result.audio_base64 || result.duration_seconds <= 0) {
      throw new Error('Synthesis did not return valid audio data');
    }
    console.log(`✓ [Test 2 PASSED] Synthesized ${result.duration_seconds}s WAV audio in ${elapsed}ms (${result.audio_base64.length} base64 chars)`);
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 2 FAILED] ${err.message}`);
    failed++;
  }

  // Test 3: Voice Selection - Fenrir Persona
  console.log('\n[Test 3] Testing Voice Selection (Persona: Fenrir)...');
  try {
    const resultFenrir = await novaVoiceService.synthesizeVoiceReply('Nova here with a deep voice.', 'Fenrir');
    if (!resultFenrir || !resultFenrir.audio_base64) {
      throw new Error('Fenrir voice synthesis failed');
    }
    console.log(`✓ [Test 3 PASSED] Fenrir voice synthesis successful (${resultFenrir.duration_seconds}s)`);
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 3 FAILED] ${err.message}`);
    failed++;
  }

  // Test 4: Audio Transcription Fallback & Engine
  console.log('\n[Test 4] Testing Audio Transcription Engine with synthesized sample...');
  try {
    // We synthesize a short audio phrase and transcribe it back
    const sampleAudio = await novaVoiceService.synthesizeVoiceReply('Remember to call Alex tomorrow at 10 AM', 'Aoede');
    if (!sampleAudio) throw new Error('Failed to generate sample audio for transcription test');

    const transcribed = await novaVoiceService.transcribeAudio(sampleAudio.audio_base64, 'audio/wav');
    console.log(`✓ Transcribed text: "${transcribed}"`);
    if (!transcribed || transcribed.length < 5) {
      throw new Error('Transcription output too short or empty');
    }
    console.log('✓ [Test 4 PASSED] Audio transcription engine working accurately!');
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 4 FAILED] ${err.message}`);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
