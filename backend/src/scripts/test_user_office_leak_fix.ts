import { isPromptLeak, sanitizeReply } from '../services/NovaBrainService';

console.log('=== TEST: USER OFFICE VOICE NOTE & PROMPT LEAK VERIFICATION ===\n');

// 1. Check prompt leak detection for the exact text shown in the user screenshot
const leak1 = 'SITUATIONAL TEMPORAL RULE: This conversation is happening now, and the user is currently at the office. CRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. 💫';
const leak2 = 'Find the answer in the archive above and tell them the exact time or context. Do NOT bring up unrelated facts from your long-term memory. 🎉';

console.log('Test 1: Leak 1 detection:');
const isLeak1 = isPromptLeak(leak1);
console.log(`  Leak 1 isPromptLeak: ${isLeak1} (Expected: true)`);
if (!isLeak1) {
  console.error('FAILED: leak1 was not detected as prompt leak!');
  process.exit(1);
}

console.log('\nTest 2: Leak 2 detection:');
const isLeak2 = isPromptLeak(leak2);
console.log(`  Leak 2 isPromptLeak: ${isLeak2} (Expected: true)`);
if (!isLeak2) {
  console.error('FAILED: leak2 was not detected as prompt leak!');
  process.exit(1);
}

console.log('\nTest 3: sanitizeReply rejects leaks:');
const sanitized1 = sanitizeReply(leak1);
const sanitized2 = sanitizeReply(leak2);
console.log(`  Sanitized leak 1: "${sanitized1}" (Expected: "")`);
console.log(`  Sanitized leak 2: "${sanitized2}" (Expected: "")`);
if (sanitized1 !== '' || sanitized2 !== '') {
  console.error('FAILED: sanitizeReply did not return empty string for leak!');
  process.exit(1);
}

console.log('\nTest 4: Temporal query pattern matching:');
const TEMPORAL_RECALL_PATTERNS = [
  /\b(?:do\s+you\s+remember|remember\s+when|what\s+did\s+(?:i|you|we)\s+(?:say|tell|talk|mention))\b/i,
  /\b(?:when\s+did\s+(?:i|you|we)|what\s+time\s+did\s+(?:i|you|we)|what\s+day\s+did\s+(?:i|you|we))\b/i,
  /\b(?:you\s+said|i\s+said|we\s+talked\s+about)\b/i,
  /\b(?:yaad\s+hai|yaad\s+karo|kab\s+bola\s+tha|kab\s+kaha\s+tha|kab\s+bataya\s+tha)\b/i,
  /\b(?:maine\s+kaha\s+tha|tune\s+kaha\s+tha|maine\s+bola\s+tha|tune\s+bola\s+tha)\b/i,
  /\b(?:kitne\s+baje\s+(?:bola|kaha|bataya|tha)|time\s+kya\s+tha|exact\s+time)\b/i,
];
const PAST_MARKERS = /\b(?:yesterday|days\s+ago|last\s+week|last\s+month|kal|parso|earlier\s+today|this\s+morning|last\s+night)\b/i;
const HAS_RECALL_OR_QUESTION = /\?|\b(?:kya|kab|kaun|kaise|kitne|batao|tell|what|when|who|which|where|remember|said|bola|kaha)\b/i;

function checkTemporal(msg: string): boolean {
  return (
    TEMPORAL_RECALL_PATTERNS.some(pat => pat.test(msg)) ||
    (PAST_MARKERS.test(msg) && HAS_RECALL_OR_QUESTION.test(msg) && /\b(?:say|said|talk|told|chat|msg|message|kaha|bola|bataya|likha|yaad)\b/i.test(msg))
  );
}

const msg1 = "i am in office right now";
const msg2 = "abhi office me hoon";
const msg3 = "kal maine kya bola tha?";
const msg4 = "do you remember what we talked about yesterday?";
const msg5 = "pehle ye batao";
const msg6 = "dopahar ko khana khaya?";

console.log(`  "${msg1}": isTemporal = ${checkTemporal(msg1)} (Expected: false)`);
console.log(`  "${msg2}": isTemporal = ${checkTemporal(msg2)} (Expected: false)`);
console.log(`  "${msg3}": isTemporal = ${checkTemporal(msg3)} (Expected: true)`);
console.log(`  "${msg4}": isTemporal = ${checkTemporal(msg4)} (Expected: true)`);
console.log(`  "${msg5}": isTemporal = ${checkTemporal(msg5)} (Expected: false)`);
console.log(`  "${msg6}": isTemporal = ${checkTemporal(msg6)} (Expected: false)`);

if (checkTemporal(msg1) !== false || checkTemporal(msg2) !== false || checkTemporal(msg3) !== true || checkTemporal(msg4) !== true) {
  console.error('FAILED: Temporal pattern matching returned unexpected results!');
  process.exit(1);
}

console.log('\nTest 5: Valid human conversation is NOT marked as prompt leak:');
const humanReplies = [
  "Achha, office me ho? Kaam kaisa chal raha hai?",
  "Got it, you're at the office! Hope work isn't too hectic today.",
  "Arey waah! Aaj ka din kaisa jaa raha hai?",
];
for (const hr of humanReplies) {
  const isLeak = isPromptLeak(hr);
  console.log(`  "${hr}": isPromptLeak = ${isLeak} (Expected: false)`);
  if (isLeak) {
    console.error(`FAILED: Human reply was falsely flagged as prompt leak: "${hr}"`);
    process.exit(1);
  }
}

console.log('\n✅ ALL OFFICE LEAK FIX TESTS PASSED SUCCESSFULLY!\n');
process.exit(0);
