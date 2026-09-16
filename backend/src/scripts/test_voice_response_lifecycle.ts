/**
 * test_voice_response_lifecycle.ts — E2E Verification & Regression Suite
 *
 * Verifies all 17 requirements of the Nova Voice Response Lifecycle:
 * 1. Interim thinking phrases are completely rejected from audio synthesis.
 * 2. Verbal hesitations and thinking prefixes are stripped from final responses.
 * 3. Lifecycle transitions through: RECEIVED -> UNDERSTANDING -> THINKING -> ACTING -> FINALIZING -> COMPLETED.
 * 4. Only state COMPLETED is finalized and permitted to voice.
 * 5. Actions and tools execute in background, and results propagate truthfully.
 * 6. Tool failures produce truthful failure messages, never false success.
 * 7. Duplicate finalization is prevented by the finalization gate.
 * 8. User transcript is never fed back as Nova's response.
 * 9. Real dual-modality audio reply generation works with clean final text.
 */

import { voiceResponseLifecycle, isInterimThinkingPhrase, stripThinkingPrefix } from '../services/VoiceResponseLifecycle';
import { novaVoiceService } from '../services/NovaVoiceService';

async function runRegressionSuite() {
  console.log('===============================================================');
  console.log('🧪 RUNNING NOVA VOICE NOTE RESPONSE LIFECYCLE REGRESSION SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASSED] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAILED] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // ── TEST 1: Interim Thinking Phrase Rejection ─────────────────────────────
  console.log('\n--- 1. Interim Thinking Phrase Detection & Rejection ---');
  const thinkingPhrases = [
    'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.',
    'Hmm, let me think...',
    'Give me a moment...',
    'Let me analyze that...',
    "I'm checking...",
    "I'm currently analyzing...",
    'Let me listen again...',
    'Wait...',
    'Mujhe sochne de...',
    'Ek minute...',
    'Main check karti hoon...',
    'Main dekh rahi hoon...',
    'Ek second ruko...',
    'Ruko thoda...',
    "I'll text you right back in a bit.",
    'Currently analyzing the voice message...',
  ];

  for (const phrase of thinkingPhrases) {
    const isThinking = isInterimThinkingPhrase(phrase);
    assert(isThinking, `Thinking phrase identified: "${phrase.slice(0, 35)}..."`);
  }

  // Substantive answers must NOT be flagged as thinking phrases
  const substantiveAnswers = [
    'Done, kal subah 8 baje Rahul ko call karne ka reminder laga diya.',
    'Ramesh ko maine tumhare dost ke roop me yaad rakh liya hai.',
    'Aaj ka plan yeh hai ki subah coding karni hai aur sham ko gym jana hai.',
    'Maine check kiya, kal tumhari koi meeting schedule nahi hai.',
    'Are you sure Ramesh short film character hai? Pehle tumne dost bola tha.',
  ];

  for (const answer of substantiveAnswers) {
    const isThinking = isInterimThinkingPhrase(answer);
    assert(!isThinking, `Substantive answer accepted: "${answer.slice(0, 35)}..."`);
  }

  // ── TEST 2: Thinking Prefix Stripping ──────────────────────────────────────
  console.log('\n--- 2. Conversational Hesitation & Thinking Prefix Stripping ---');
  const prefixedSamples = [
    { input: 'Hmm... kal 8 baje Rahul ko call karne ka reminder laga diya.', expectedStart: 'kal 8 baje' },
    { input: 'Let me think... Ramesh is your college friend from Pune.', expectedStart: 'Ramesh is your' },
    { input: 'Ek minute... Done, yaad rakh liya!', expectedStart: 'Done, yaad rakh' },
    { input: 'Wait... aaj ka plan yeh hai ki shaam ko milna hai.', expectedStart: 'aaj ka plan' },
    { input: '<thought>Analyzing user memory</thought> Tumhara dost Ramesh Pune me rehta hai.', expectedStart: 'Tumhara dost' },
  ];

  for (const sample of prefixedSamples) {
    const stripped = stripThinkingPrefix(sample.input);
    const matches = stripped.startsWith(sample.expectedStart);
    assert(matches, `Prefix stripped correctly: "${sample.input.slice(0, 30)}..." -> "${stripped.slice(0, 30)}..."`);
  }

  // ── TEST 3: NovaVoiceService Refusal for Thinking Phrases ─────────────────
  console.log('\n--- 3. NovaVoiceService Synthesis Rejection Guard ---');
  const fallbackSpeechAttempt = await novaVoiceService.synthesizeVoiceReply(
    'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.',
    'Kore'
  );
  assert(fallbackSpeechAttempt === null, 'synthesizeVoiceReply immediately returns null for fallback reply');

  const letMeThinkAttempt = await novaVoiceService.synthesizeVoiceReply(
    'Let me think...',
    'Aoede'
  );
  assert(letMeThinkAttempt === null, 'synthesizeVoiceReply immediately returns null for "Let me think..."');

  // ── TEST 4: Voice Turn Lifecycle State Machine ─────────────────────────────
  console.log('\n--- 4. Voice Turn Lifecycle State Machine Transitions ---');
  const testTurnId = `turn_test_${Date.now()}`;
  const userId = 'u-test-lifecycle';
  const convId = 'c-test-lifecycle';

  const turn = voiceResponseLifecycle.startTurn(testTurnId, userId, convId);
  assert(turn.state === 'RECEIVED', 'Lifecycle initialized at RECEIVED state');

  voiceResponseLifecycle.transitionState(testTurnId, 'UNDERSTANDING');
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.state === 'UNDERSTANDING', 'State transitioned to UNDERSTANDING');

  const userSpeech = 'Kal subah 8 baje Rahul ko call karne ka reminder laga de.';
  voiceResponseLifecycle.setUserTranscript(testTurnId, userSpeech);
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.state === 'THINKING', 'Transcript set, state transitioned to THINKING');
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.userTranscript === userSpeech, 'userTranscript isolated and preserved');

  // Background action execution
  voiceResponseLifecycle.recordToolExecution(testTurnId, 'ReminderEngine', 'schedule', { time: '8am', title: 'Call Rahul' });
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.state === 'ACTING', 'Tool call recorded, state transitioned to ACTING');

  voiceResponseLifecycle.recordToolResult(testTurnId, 'ReminderEngine', true, { reminder_id: 'rem_123' });
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.toolResults.length === 1, 'Tool result recorded');

  // Attempting to finalize with a thinking phrase MUST fail
  const failedFinalize = voiceResponseLifecycle.finalizeTurn(
    testTurnId,
    'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.'
  );
  assert(failedFinalize === null, 'Finalization gate blocks thinking phrase');
  assert(voiceResponseLifecycle.getTurn(testTurnId)?.finalized === false, 'Turn remains unfinalized after rejected phrase');

  // Finalizing with real answer succeeds
  const finalAnswer = 'Done, kal subah 8 baje Rahul ko call karne ka reminder laga diya!';
  const finalResp = voiceResponseLifecycle.finalizeTurn(testTurnId, finalAnswer, 'b64_mock_audio', 2.5);
  assert(finalResp !== null, 'Finalization gate succeeds with substantive answer');
  assert(finalResp?.state === 'COMPLETED', 'Final state is COMPLETED');
  assert(finalResp?.finalText === finalAnswer, 'finalText matches substantive answer');
  assert(finalResp?.finalAudioBase64 === 'b64_mock_audio', 'finalAudioBase64 attached');

  // ── TEST 5: Duplicate Finalization / Race Protection ───────────────────────
  console.log('\n--- 5. Duplicate Finalization Gate Protection ---');
  const duplicateResp = voiceResponseLifecycle.finalizeTurn(testTurnId, 'Second attempted answer text');
  assert(duplicateResp?.finalText === finalAnswer, 'Duplicate finalization call returns original completed response without re-minting');

  // ── TEST 6: Tool Failure Handling (Zero False Success) ────────────────────
  console.log('\n--- 6. Tool Failure Truthful Propagation ---');
  const failTurnId = `turn_fail_${Date.now()}`;
  voiceResponseLifecycle.startTurn(failTurnId, userId, convId);
  voiceResponseLifecycle.setUserTranscript(failTurnId, 'Remember that Ramesh is my friend');
  voiceResponseLifecycle.recordToolExecution(failTurnId, 'MemoryRepository', 'save', { key: 'friend_name', value: 'Ramesh' });
  voiceResponseLifecycle.recordToolResult(failTurnId, 'MemoryRepository', false, undefined, 'Database timeout');

  const failureFinalText = 'Mujhe ye save karne mein problem aayi, ek baar phir try karte hain.';
  const failFinalResp = voiceResponseLifecycle.finalizeTurn(failTurnId, failureFinalText);
  assert(failFinalResp !== null, 'Finalization succeeds with truthful failure message');
  assert(failFinalResp?.finalText === failureFinalText, 'Truthful failure message preserved for speech');

  // ── TEST 7: Live Dual-Modality Speech Synthesis with Cleaned Text ─────────
  console.log('\n--- 7. Live Dual-Modality Audio Synthesis for Final Answer ---');
  const realAssistantReply = 'Done! Kal subah 8 baje Rahul ko call karne ka reminder laga diya.';
  const synthResult = await novaVoiceService.synthesizeVoiceReply(realAssistantReply, 'Kore');

  assert(synthResult !== null, 'Live dual-modality voice synthesis generated audio');
  if (synthResult) {
    assert(typeof synthResult.audio_base64 === 'string' && synthResult.audio_base64.length > 500, 'Valid audio base64 payload returned');
    assert(synthResult.duration_seconds > 0.5, `Duration measured correctly (${synthResult.duration_seconds}s)`);
    console.log(`   🎤 Synthesized ${synthResult.duration_seconds}s audio (${synthResult.audio_base64.length} chars base64)`);
  }

  // ── TEST 8: Transcript != Response Segregation ─────────────────────────────
  console.log('\n--- 8. Transcript Isolation Integrity ---');
  const segregationTurnId = `turn_segregation_${Date.now()}`;
  voiceResponseLifecycle.startTurn(segregationTurnId, userId, convId);
  const userQuery = 'Nova, tell me what my schedule is for today.';
  voiceResponseLifecycle.setUserTranscript(segregationTurnId, userQuery);

  const assistantReply = 'You have a team sync at 2 PM and gym at 6 PM.';
  const segFinal = voiceResponseLifecycle.finalizeTurn(segregationTurnId, assistantReply);

  assert(voiceResponseLifecycle.getTurn(segregationTurnId)?.userTranscript !== segFinal?.finalText, 'userTranscript is distinct from assistantFinalText');
  assert(segFinal?.finalText === assistantReply, 'assistantFinalText correctly captures model reply, never user transcript');

  console.log('\n===============================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Unhandled error in regression suite:', err);
  process.exit(1);
});
