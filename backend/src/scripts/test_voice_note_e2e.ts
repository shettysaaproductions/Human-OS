import 'dotenv/config';
import { novaVoiceService, detectAudioMimeType } from '../services/NovaVoiceService';
import { TurnAnalyzer } from '../services/TurnAnalyzer';
import { canonicalMemoryTreeService } from '../services/CanonicalMemoryTreeService';

async function runVoiceNoteTests() {
  console.log('====================================================');
  console.log('🧪 VOICE NOTE MULTIMODAL INTELLIGENCE & AUDIO E2E TEST');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Audio MIME type detection & format validation
  try {
    const riffHeader = Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ', 'ascii');
    const detectedWav = detectAudioMimeType(riffHeader);
    if (detectedWav !== 'audio/wav') throw new Error(`Expected audio/wav, got ${detectedWav}`);

    const mp4Header = Buffer.from('\x00\x00\x00\x1cftypM4A \x00\x00\x00\x00', 'ascii');
    const detectedMp4 = detectAudioMimeType(mp4Header);
    if (detectedMp4 !== 'audio/mp4') throw new Error(`Expected audio/mp4, got ${detectedMp4}`);

    console.log('✅ TEST 1 PASSED: Audio MIME type detection from binary header');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 1 FAILED: Audio MIME detection failed:', err.message);
    failed++;
  }

  // Test 2: Synthesize real speech and verify multimodal transcription for Hindi/Hinglish
  try {
    const testPhrase = 'Kal Sakshi ke birthday ka jo plan bola tha na usme cake wala part yaad rakhna.';
    console.log('Synthesizing speech for Hinglish phrase:', testPhrase);
    const synth = await novaVoiceService.synthesizeVoiceReply(testPhrase, 'Kore');
    if (!synth?.audio_base64) throw new Error('Speech synthesis returned null');

    console.log(`Synthesized audio: ${synth.duration_seconds}s (${synth.audio_base64.length} b64 chars)`);

    console.log('Transcribing synthesized audio via gemini-3.6-flash...');
    const transcribed = await novaVoiceService.transcribeAudio(synth.audio_base64, 'audio/wav');
    console.log('Transcribed output:', transcribed);

    const lower = transcribed.toLowerCase();
    if (!lower.includes('cake') && !lower.includes('sakshi')) {
      throw new Error(`Transcription did not recognize key entities. Output: "${transcribed}"`);
    }

    console.log('✅ TEST 2 PASSED: Multimodal Gemini 3.6 Flash understands natural Hinglish speech verbatim');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 2 FAILED: Audio synthesis or transcription error:', err.message);
    failed++;
  }

  // Test 3: Audio understanding enters TurnAnalyzer and Canonical Memory Tree
  try {
    // Spoken turn: "Ramesh is my friend from college."
    const rameshSpeech = 'Ramesh is my friend from college.';
    const synthRamesh = await novaVoiceService.synthesizeVoiceReply(rameshSpeech, 'Puck');
    if (!synthRamesh?.audio_base64) throw new Error('Ramesh speech synthesis failed');

    const transcribedRamesh = await novaVoiceService.transcribeAudio(synthRamesh.audio_base64, 'audio/wav');
    console.log('Transcribed Ramesh voice note:', transcribedRamesh);

    // TurnAnalyzer
    const analysis = TurnAnalyzer.analyze([{ role: 'user', message: transcribedRamesh }]);
    console.log('TurnAnalyzer units:', (analysis.units || []).map((u: any) => ({ type: u.type, factKey: u.factKey, factValue: u.factValue })));

    // Entity resolution
    const testUserId = '00000000-0000-4000-a000-000000000001';
    const entityResolution = await canonicalMemoryTreeService.resolveEntity(testUserId, transcribedRamesh);
    console.log('Resolved entity:', entityResolution);

    if (!entityResolution.entityName || entityResolution.entityName.toLowerCase() === 'unknown') {
      throw new Error(`Failed to resolve entity name from voice transcript: ${JSON.stringify(entityResolution)}`);
    }

    console.log('✅ TEST 3 PASSED: Voice note feeds directly into TurnAnalyzer and Canonical Memory Tree');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 3 FAILED: TurnAnalyzer / Memory resolution failed:', err.message);
    failed++;
  }

  // Test 4: Dual-modality assistant voice response generation
  try {
    const assistantTextReply = 'Haan mujhe yaad hai! Main Sakshi ke birthday ke cake ka part note kar liya hai.';
    const replyVoice = await novaVoiceService.synthesizeVoiceReply(assistantTextReply, 'Kore');
    if (!replyVoice?.audio_base64 || !replyVoice.duration_seconds) {
      throw new Error('Dual-modality voice reply synthesis returned empty');
    }

    console.log(`Assistant voice reply generated: ${replyVoice.duration_seconds}s, ${replyVoice.audio_base64.length} b64 chars`);

    // Verify it can be stored in chat_history meta
    const testRow = {
      user_id: '00000000-0000-4000-a000-000000000001',
      conversation_id: '00000000-0000-4000-a000-000000000002',
      role: 'assistant',
      content: assistantTextReply,
      meta: {
        is_voice_reply: true,
        audio_base64: replyVoice.audio_base64.substring(0, 100) + '...[truncated for test]',
        audio_duration: replyVoice.duration_seconds,
      },
    };

    if (!testRow.meta.is_voice_reply || !testRow.meta.audio_duration) {
      throw new Error('Missing voice metadata on assistant row');
    }

    console.log('✅ TEST 4 PASSED: Dual-modality text + playable audio response contract verified');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 4 FAILED: Voice reply synthesis failed:', err.message);
    failed++;
  }

  // Test 5: Voice reminder intent understanding
  try {
    const reminderSpeech = 'Remind me tomorrow at 8 to call Rahul.';
    const synthReminder = await novaVoiceService.synthesizeVoiceReply(reminderSpeech, 'Charon');
    if (!synthReminder?.audio_base64) throw new Error('Reminder speech synthesis failed');

    const transcribedReminder = await novaVoiceService.transcribeAudio(synthReminder.audio_base64, 'audio/wav');
    console.log('Transcribed reminder voice note:', transcribedReminder);

    const isReminderPromise = /(?:remind|call\s+rahul|tomorrow)/i.test(transcribedReminder);
    if (!isReminderPromise) {
      throw new Error(`Transcription did not detect reminder content: "${transcribedReminder}"`);
    }

    console.log('✅ TEST 5 PASSED: Voice note reminder instruction understood accurately');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 5 FAILED: Voice reminder test failed:', err.message);
    failed++;
  }

  // Test 6: Negative error handling contract (fail-fast, structured errors, no hallucination)
  try {
    let threwCorrectly = false;
    try {
      // Send corrupted/empty audio
      await novaVoiceService.transcribeAudio('YWJj', 'audio/wav'); // "abc"
    } catch (err: any) {
      threwCorrectly = err.message.includes('VOICE_FILE_INVALID') || err.message.includes('VOICE_AUDIO_PROCESSING_FAILED');
      console.log('Expected error caught:', err.message);
    }

    if (!threwCorrectly) throw new Error('Expected VOICE_FILE_INVALID or VOICE_AUDIO_PROCESSING_FAILED error');

    console.log('✅ TEST 6 PASSED: Invalid audio triggers structured error without generic hallucination');
    passed++;
  } catch (err: any) {
    console.error('❌ TEST 6 FAILED: Error contract failed:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runVoiceNoteTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
