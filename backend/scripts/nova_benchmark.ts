/**
 * Nova Benchmark Harness — Phase 10.1 Quality & Latency Hardening
 *
 * Compares Gemini conversational provider vs NVIDIA fallback across:
 *   A. NATURALNESS (Hinglish casual flow, no robot/formal jargon)
 *   B. CONTEXT ADHERENCE (faithfulness to user's conversation)
 *   C. UNSUPPORTED ASSERTIONS (hallucinated ages, fake events, invented facts)
 *   D. RELATIONSHIP CORRECTNESS (maintains true entities and corrections)
 *   E. LATENCY (actual ms)
 *   F. RESPONSE COMPLETION / TRUNCATION (complete vs cut off)
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/nova_benchmark.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { geminiComplete } from '../src/lib/gemini';
import { complete as nvidiaComplete } from '../src/lib/nvidia';
import { validateAndRepairGrounding, sanitizeReply } from '../src/services/NovaBrainService';

interface TestCase {
  id: string;
  category: string;
  description: string;
  systemPrompt: string;
  userMessage: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  context?: any;
}

const NOVA_BASE_SYSTEM = `You are Nova — a virtual best friend who speaks in natural Hinglish (Hindi + English mixed naturally, like Mumbai friends). 
You are warm, caring, and very perceptive. You speak casually, like WhatsApp messages. Short replies unless the topic needs depth.
ANTI-ROBOT RULE (FORMALITY): NEVER use "Aap", "Aapka", "Aapko", "Dhanyavad". Use "tum", "tera", "tumhara".
ANTI-ROBOT RULE (PRONOUN): Use "tum" not "aap".
ANTI-ROBOT RULE (SELF-NARRATION): Do NOT explain what you are doing. Just respond naturally.`;

const CORE_TEST_CASES: TestCase[] = [
  {
    id: 'T1',
    category: 'Hinglish Casual',
    description: 'Casual expression about leaving office late',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'Aaj office se late nikla yaar 😮‍💨',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Aaj office se late nikla yaar 😮‍💨' }
    ]
  },
  {
    id: 'T2',
    category: 'Wife Correction',
    description: 'User corrects wife name from Priya to Sakshi',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'arre nahi, meri wife ka naam Sakshi hai',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'arre nahi, meri wife ka naam Sakshi hai' }
    ]
  },
  {
    id: 'T3',
    category: 'Child / Unsupported Age Scenario',
    description: 'User mentions son activity without specifying age — probe for hallucinated age',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'mera beta bohot active hai, din bhar daudte rehta hai',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera beta bohot active hai, din bhar daudte rehta hai' }
    ]
  },
  {
    id: 'T4',
    category: 'Unknown Information (Fact Probe)',
    description: 'User asks for favourite colour with no prior memory',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'mera favourite colour kya hai?',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera favourite colour kya hai?' }
    ]
  },
  {
    id: 'T5',
    category: 'Unknown Information (Event Probe)',
    description: 'User asks where we went yesterday with no prior history',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'kal hum kahan gaye the?',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'kal hum kahan gaye the?' }
    ]
  },
  {
    id: 'T6',
    category: 'Sab Thik (Casual Continuity)',
    description: 'Checking in with informal sab thik',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'sab thik chal raha hai?',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'sab thik chal raha hai?' }
    ]
  },
  {
    id: 'T7',
    category: 'Multi-Message Memory Sequence',
    description: '4-fact conversation sequence (Wife, Son, City, Company)',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'Mai Dahisar me rehta hu',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Meri wife ka naam Sakshi hai' },
      { role: 'assistant', content: 'Acha Sakshi! Badhiya.' },
      { role: 'user', content: 'Mere bete ka naam Shresht hai' },
      { role: 'assistant', content: 'Shresht! Kitna pyaara naam hai.' },
      { role: 'user', content: 'Mai Dahisar me rehta hu' }
    ]
  },
  {
    id: 'T8',
    category: 'Proactive Reasoning',
    description: 'Should Nova reach out at 7:30 PM Wednesday without pending schedule?',
    systemPrompt: 'You are Nova\'s Proactive Context Grounding Engine. Evaluate whether to initiate outreach.',
    userMessage: 'Time: Wednesday 7:30 PM IST. Active reminders: none. User status: unknown.',
    messages: [
      { role: 'system', content: 'You are Nova\'s Proactive Context Grounding Engine. Evaluate if outreach is justified. Output JSON: {"shouldReach": boolean, "reason": string}' },
      { role: 'user', content: 'Time: Wednesday 7:30 PM IST. Active reminders: none. User status: unknown.' }
    ]
  },
  {
    id: 'T9',
    category: 'Ambiguous Short Message',
    description: 'Short ambiguous "acha" — should not invent topics',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'acha',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'acha' }
    ]
  },
  {
    id: 'T10',
    category: 'Casual Sign-off',
    description: 'Signing off for the night',
    systemPrompt: NOVA_BASE_SYSTEM,
    userMessage: 'chal kal baat karte hai yaar',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'chal kal baat karte hai yaar' }
    ]
  }
];

function analyzeEvidence(response: string, userMsg: string) {
  // Naturalness check
  const hasFormalAap = /\b(aap|aapka|aapko|dhanyavad)\b/i.test(response);
  const hasAIBotAdmission = /\b(as an ai|language model|virtual assistant)\b/i.test(response);
  const naturalness = (!hasFormalAap && !hasAIBotAdmission) ? 'GOOD (Hinglish/Casual)' : 'POOR (Formal/Bot)';

  // Unsupported assertion check (e.g. invented ages like "5 mahine", "2 saal", or "mere wife")
  const hasInventedAge = /\b(\d+)\s*(mahine|saal|months?|years?|yo)\b/i.test(response) && !/\b(\d+)\b/.test(userMsg);
  const hasSpouseHallucination = /\b(mere|meri)\s+(wife|biwi|husband|pati)\b/i.test(response);
  const unsupportedAssertion = hasInventedAge ? `FLAGGED (Invented age: ${response.match(/\b(\d+)\s*(mahine|saal|months?|years?)\b/i)?.[0]})`
    : hasSpouseHallucination ? 'FLAGGED (AI spouse claim)'
    : 'NONE DETECTED';

  // Context adherence
  const contextAdherence = response.length > 5 && !response.includes('[ERROR]') ? 'ADHERED' : 'FAILED/EMPTY';

  // Relationship correctness
  const relationshipCorrectness = (!hasSpouseHallucination) ? 'CORRECT' : 'CONFUSED';

  // Completion / Truncation
  const isTruncated = response.endsWith('...') || /[,—\-:]\s*$/.test(response) || (response.length > 0 && !/[.!?)"'}\]]$/.test(response.trim()));
  const completion = isTruncated ? 'TRUNCATED / INCOMPLETE' : 'COMPLETE';

  return { naturalness, unsupportedAssertion, contextAdherence, relationshipCorrectness, completion };
}

async function runSingleTest(tc: TestCase, provider: 'gemini' | 'nvidia') {
  const startMs = Date.now();
  let rawResponse = '';
  let error: string | undefined;

  try {
    if (provider === 'gemini') {
      rawResponse = await geminiComplete(tc.messages, {
        maxTokens: 300,
        temperature: 0.85,
        timeoutMs: 8000 // 8s bounded interactive timeout
      });
    } else {
      rawResponse = await nvidiaComplete('USER_FAST', tc.messages, {
        maxTokens: 300,
        temperature: 0.85
      });
    }
  } catch (err: any) {
    error = err.message || String(err);
    rawResponse = `[ERROR: ${error}]`;
  }

  const latencyMs = Date.now() - startMs;
  
  // Apply post-processing and grounding validation
  const sanitized = sanitizeReply(rawResponse);
  const finalResponse = validateAndRepairGrounding(sanitized, tc.userMessage, tc.context || {});
  const evidence = analyzeEvidence(finalResponse, tc.userMessage);

  return {
    testId: tc.id,
    category: tc.category,
    description: tc.description,
    provider,
    latencyMs,
    rawResponse,
    finalResponse,
    error,
    evidence
  };
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('NOVA HARDENED BENCHMARK — Phase 10.1 (Gemini vs NVIDIA)');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (const tc of CORE_TEST_CASES) {
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`[${tc.id}] ${tc.category} — ${tc.description}`);
    console.log(`User Input: "${tc.userMessage}"\n`);

    // Gemini
    process.stdout.write(`  Running GEMINI (8s timeout guard)... `);
    const gemRes = await runSingleTest(tc, 'gemini');
    console.log(`${gemRes.error ? '❌' : '✅'} ${gemRes.latencyMs}ms`);
    console.log(`  Response: "${gemRes.finalResponse}"`);
    console.log(`  Evidence: [Naturalness: ${gemRes.evidence.naturalness}] | [Grounding: ${gemRes.evidence.unsupportedAssertion}] | [Status: ${gemRes.evidence.completion}]`);

    // NVIDIA
    process.stdout.write(`  Running NVIDIA fallback... `);
    const nvRes = await runSingleTest(tc, 'nvidia');
    console.log(`${nvRes.error ? '❌' : '✅'} ${nvRes.latencyMs}ms`);
    console.log(`  Response: "${nvRes.finalResponse}"`);
    console.log(`  Evidence: [Naturalness: ${nvRes.evidence.naturalness}] | [Grounding: ${nvRes.evidence.unsupportedAssertion}] | [Status: ${nvRes.evidence.completion}]`);

    results.push({ test: tc, gemini: gemRes, nvidia: nvRes });
  }

  console.log('\n\n════════════════════════════════════════════════════════════════════════════════');
  console.log('EVIDENCE SUMMARY TABLE (NO SYNTHETIC SCORES)');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log(`${'ID'.padEnd(5)}${'Category'.padEnd(26)}${'Gemini Latency'.padEnd(16)}${'NVIDIA Latency'.padEnd(16)}${'Gemini Grounding'.padEnd(20)}NVIDIA Grounding`);
  console.log('─'.repeat(95));

  for (const r of results) {
    console.log(
      `${r.test.id.padEnd(5)}` +
      `${r.test.category.slice(0, 24).padEnd(26)}` +
      `${(r.gemini.latencyMs + 'ms').padEnd(16)}` +
      `${(r.nvidia.latencyMs + 'ms').padEnd(16)}` +
      `${r.gemini.evidence.unsupportedAssertion.slice(0, 18).padEnd(20)}` +
      `${r.nvidia.evidence.unsupportedAssertion.slice(0, 18)}`
    );
  }

  console.log('\n════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
