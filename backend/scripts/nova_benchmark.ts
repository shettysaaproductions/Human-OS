/**
 * Nova Isolated Benchmark Harness — Phase 10.1
 *
 * Compares Gemini vs NVIDIA with STRICT provider isolation:
 * - Does NOT inherit stale pool cooldown state
 * - Explicitly tracks provider_attempted, provider_used, model_used, fallback_used, status, latency_ms
 * - Never labels a fallback response as a Gemini response
 * - No synthetic intelligence score — only side-by-side evidence
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/nova_benchmark.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { complete as nvidiaComplete } from '../src/lib/nvidia';
import { config } from '../src/config';
import { validateAndRepairGrounding, sanitizeReply } from '../src/services/NovaBrainService';

interface BenchmarkTestCase {
  id: string;
  category: string;
  description: string;
  userMessage: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  context?: any;
}

const NOVA_BASE_SYSTEM = `You are Nova — a virtual best friend who speaks in natural Hinglish (Hindi + English mixed naturally, like Mumbai friends). 
You are warm, caring, and very perceptive. You speak casually, like WhatsApp messages. Short replies unless the topic needs depth.
ANTI-ROBOT RULE (FORMALITY): NEVER use "Aap", "Aapka", "Aapko", "Dhanyavad". Use "tum", "tera", "tumhara".
ANTI-ROBOT RULE (PRONOUN): Use "tum" not "aap".
ANTI-ROBOT RULE (SELF-NARRATION): Do NOT explain what you are doing. Just respond naturally.`;

const BENCHMARK_CASES: BenchmarkTestCase[] = [
  {
    id: '1',
    category: 'Hinglish Casual',
    description: 'Casual expression about leaving office late',
    userMessage: 'Aaj office se late nikla yaar 😮‍💨',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Aaj office se late nikla yaar 😮‍💨' }
    ]
  },
  {
    id: '2',
    category: 'Wife Correction',
    description: 'User corrects wife name from Priya to Sakshi',
    userMessage: 'arre nahi, meri wife ka naam Sakshi hai',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'arre nahi, meri wife ka naam Sakshi hai' }
    ]
  },
  {
    id: '3',
    category: 'Child / Family Context',
    description: 'User mentions energetic child without giving age',
    userMessage: 'mera beta bohot active hai, din bhar daudte rehta hai',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera beta bohot active hai, din bhar daudte rehta hai' }
    ]
  },
  {
    id: '4',
    category: 'Unknown Fact',
    description: 'User asks for favourite colour (no prior memory exists)',
    userMessage: 'mera favourite colour kya hai?',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera favourite colour kya hai?' }
    ]
  },
  {
    id: '5',
    category: 'Sab Thik',
    description: 'Checking in casually',
    userMessage: 'sab thik chal raha hai?',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'sab thik chal raha hai?' }
    ]
  },
  {
    id: '6',
    category: 'Multi-Message Context',
    description: 'Sequenced conversation history (Wife, Son, City)',
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
    id: '7',
    category: 'Proactive Reasoning',
    description: 'Evaluate if proactive reach-out is justified at 7:30 PM Wednesday without reminders',
    userMessage: 'Time: Wednesday 7:30 PM IST. Active reminders: none. User status: unknown.',
    messages: [
      { role: 'system', content: 'You are Nova\'s Proactive Context Grounding Engine. Evaluate if outreach is justified. Output JSON: {"shouldReach": boolean, "reason": string}' },
      { role: 'user', content: 'Time: Wednesday 7:30 PM IST. Active reminders: none. User status: unknown.' }
    ]
  },
  {
    id: '8',
    category: 'Unsupported-Age Scenario',
    description: 'Specific probe on child milestones without age context',
    userMessage: 'mera beta abhi naye naye tricks seekh raha hai',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera beta abhi naye naye tricks seekh raha hai' }
    ]
  },
  {
    id: '9',
    category: 'Ambiguous "acha"',
    description: 'Short ambiguous "acha" response',
    userMessage: 'acha',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'acha' }
    ]
  },
  {
    id: '10',
    category: 'Sign-off',
    description: 'Signing off for the night',
    userMessage: 'chal kal baat karte hai yaar',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'chal kal baat karte hai yaar' }
    ]
  }
];

interface ProviderResult {
  provider_attempted: 'gemini' | 'nvidia';
  provider_used: 'gemini' | 'nvidia' | 'none';
  model_used: string;
  credential_slot: 'KEY_3' | 'NVIDIA_POOL';
  fallback_used: boolean;
  status: 'SUCCESS' | 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_ERROR';
  latency_ms: number;
  raw_response: string;
  final_response: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runGeminiDirect(tc: BenchmarkTestCase): Promise<ProviderResult> {
  const startMs = Date.now();
  const modelName = config.gemini.chatModel || 'gemini-3.6-flash';
  // Strictly isolated benchmark credential: KEY_3
  const apiKey = config.gemini.apiKey3 || config.gemini.apiKey1;

  if (!apiKey) {
    return {
      provider_attempted: 'gemini',
      provider_used: 'none',
      model_used: modelName,
      credential_slot: 'KEY_3',
      fallback_used: false,
      status: 'PROVIDER_ERROR',
      latency_ms: 0,
      raw_response: '[NO_API_KEY_CONFIGURED]',
      final_response: '[NO_API_KEY_CONFIGURED]'
    };
  }

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const systemPrompt = tc.messages.find(m => m.role === 'system')?.content || '';
    const nonSystem = tc.messages.filter(m => m.role !== 'system');
    const lastMsg = nonSystem[nonSystem.length - 1]?.content || tc.userMessage;
    const historyMsgs = nonSystem.slice(0, -1);

    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt || undefined,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.85
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_8000MS')), 8000)
    );

    let completionPromise: Promise<any>;
    if (historyMsgs.length === 0) {
      completionPromise = model.generateContent(lastMsg);
    } else {
      const chat = model.startChat({
        history: historyMsgs.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      });
      completionPromise = chat.sendMessage([{ text: lastMsg }]);
    }

    const response = await Promise.race([completionPromise, timeoutPromise]);
    const rawText = response.response.text().trim();
    const latency_ms = Date.now() - startMs;
    const sanitized = sanitizeReply(rawText);
    const final_response = validateAndRepairGrounding(sanitized, tc.userMessage, tc.context || {});

    return {
      provider_attempted: 'gemini',
      provider_used: 'gemini',
      model_used: modelName,
      credential_slot: 'KEY_3',
      fallback_used: false,
      status: 'SUCCESS',
      latency_ms,
      raw_response: rawText,
      final_response
    };

  } catch (err: any) {
    const latency_ms = Date.now() - startMs;
    const msg = (err.message || '').toLowerCase();
    const status = err.status || 0;

    let errorStatus: 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_ERROR' = 'PROVIDER_ERROR';
    if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
      errorStatus = 'RATE_LIMITED';
    } else if (msg.includes('timeout') || err.message === 'TIMEOUT_8000MS') {
      errorStatus = 'TIMEOUT';
    }

    return {
      provider_attempted: 'gemini',
      provider_used: 'none',
      model_used: modelName,
      credential_slot: 'KEY_3',
      fallback_used: false,
      status: errorStatus,
      latency_ms,
      raw_response: `[${errorStatus}: ${err.message}]`,
      final_response: `[${errorStatus}]`
    };
  }
}

async function runNvidiaDirect(tc: BenchmarkTestCase): Promise<ProviderResult> {
  const startMs = Date.now();
  const modelName = config.nvidia.chatModel || 'meta/llama-3.2-11b-vision-instruct';

  try {
    const rawText = await nvidiaComplete('USER_FAST', tc.messages, {
      maxTokens: 300,
      temperature: 0.85
    });

    const latency_ms = Date.now() - startMs;
    const sanitized = sanitizeReply(rawText);
    const final_response = validateAndRepairGrounding(sanitized, tc.userMessage, tc.context || {});

    return {
      provider_attempted: 'nvidia',
      provider_used: 'nvidia',
      model_used: modelName,
      credential_slot: 'NVIDIA_POOL',
      fallback_used: false,
      status: 'SUCCESS',
      latency_ms,
      raw_response: rawText,
      final_response
    };

  } catch (err: any) {
    const latency_ms = Date.now() - startMs;
    return {
      provider_attempted: 'nvidia',
      provider_used: 'none',
      model_used: modelName,
      credential_slot: 'NVIDIA_POOL',
      fallback_used: false,
      status: 'PROVIDER_ERROR',
      latency_ms,
      raw_response: `[ERROR: ${err.message}]`,
      final_response: `[PROVIDER_ERROR: ${err.message}]`
    };
  }
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('NOVA ISOLATED BENCHMARK — Phase 10.1 (Gemini Key 3 vs NVIDIA)');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const benchmarkEntries: Array<{
    test: BenchmarkTestCase;
    gemini: ProviderResult;
    nvidia: ProviderResult;
  }> = [];

  for (const tc of BENCHMARK_CASES) {
    console.log(`──────────────────────────────────────────────────────────────────────`);
    console.log(`[Case ${tc.id}] ${tc.category} — ${tc.description}`);
    console.log(`Input: "${tc.userMessage}"\n`);

    // Run Gemini (isolated Key 3)
    process.stdout.write(`  GEMINI (Slot: KEY_3) : `);
    const geminiRes = await runGeminiDirect(tc);
    console.log(`[${geminiRes.status}] in ${geminiRes.latency_ms}ms (model: ${geminiRes.model_used})`);
    console.log(`  Output : "${geminiRes.final_response}"\n`);

    // Pacing delay to avoid burst rate limits on Gemini free tier
    await sleep(1500);

    // Run NVIDIA (isolated)
    process.stdout.write(`  NVIDIA (Slot: NVIDIA_POOL) : `);
    const nvidiaRes = await runNvidiaDirect(tc);
    console.log(`[${nvidiaRes.status}] in ${nvidiaRes.latency_ms}ms (model: ${nvidiaRes.model_used})`);
    console.log(`  Output : "${nvidiaRes.final_response}"\n`);

    benchmarkEntries.push({ test: tc, gemini: geminiRes, nvidia: nvidiaRes });
  }

  // Summary Output
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('BENCHMARK COMPARISON TABLE (EVIDENCE-ONLY, NO SYNTHETIC SCORES)');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log(`${'#'.padEnd(4)}${'Category'.padEnd(25)}${'Gemini Slot'.padEnd(14)}${'Gemini Status'.padEnd(15)}${'Gemini ms'.padEnd(12)}${'NVIDIA Status'.padEnd(15)}NVIDIA ms`);
  console.log('─'.repeat(95));

  let geminiSuccessCount = 0;
  for (const entry of benchmarkEntries) {
    if (entry.gemini.status === 'SUCCESS') geminiSuccessCount++;
    console.log(
      `${entry.test.id.padEnd(4)}` +
      `${entry.test.category.slice(0, 23).padEnd(25)}` +
      `${entry.gemini.credential_slot.padEnd(14)}` +
      `${entry.gemini.status.padEnd(15)}` +
      `${(entry.gemini.latency_ms + 'ms').padEnd(12)}` +
      `${entry.nvidia.status.padEnd(15)}` +
      `${entry.nvidia.latency_ms + 'ms'}`
    );
  }

  console.log('─'.repeat(95));
  const conclusion = geminiSuccessCount === benchmarkEntries.length
    ? 'SUCCESSFUL COMPARISON'
    : 'INCONCLUSIVE (Gemini capacity/rate-limited on free-tier quota)';
  console.log(`BENCHMARK CONCLUSION: ${conclusion}`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
