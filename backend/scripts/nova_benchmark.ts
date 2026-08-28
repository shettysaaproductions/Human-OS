/**
 * Nova Benchmark Harness — Phase 10.1
 *
 * Compares Gemini vs NVIDIA on actual Human-OS workloads:
 *   - Hinglish understanding
 *   - Hinglish response generation
 *   - Multi-message memory
 *   - Correction handling
 *   - Pronoun/reference resolution
 *   - Conversational continuity
 *   - Proactive context grounding
 *   - Ambiguity handling
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/nova_benchmark.ts
 *   npx ts-node scripts/nova_benchmark.ts --workload conversation
 *   npx ts-node scripts/nova_benchmark.ts --provider gemini
 *
 * Output: Side-by-side table in terminal + JSON report in /tmp/nova_benchmark_YYYY-MM-DD.json
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { geminiComplete } from '../src/lib/gemini';
import { complete as nvidiaComplete } from '../src/lib/nvidia';

// ── Benchmark Scenarios ────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  category: string;
  description: string;
  systemPrompt: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Criteria used to evaluate response quality */
  evaluationCriteria: string[];
  /** Words/phrases that should appear in a correct response */
  expectedSignals?: string[];
  /** Words/phrases that indicate hallucination or failure */
  failureSignals?: string[];
}

// Standard Nova system prompt (trimmed for benchmark)
const NOVA_BASE_SYSTEM = `You are Nova — a virtual best friend who speaks in natural Hinglish (Hindi + English mixed naturally, like Mumbai friends). 
You are warm, caring, and very perceptive. You speak casually, like WhatsApp messages. Short replies unless the topic needs depth.
ANTI-ROBOT RULE (FORMALITY): NEVER use "Aap", "Aapka", "Aapko", "Dhanyavad". Use "tum", "tera", "tumhara".
ANTI-ROBOT RULE (PRONOUN): Use "tum" not "aap".
ANTI-ROBOT RULE (SELF-NARRATION): Do NOT explain what you are doing. Just respond naturally.`;

const TEST_CASES: TestCase[] = [

  {
    id: 'H4',
    category: 'Hinglish Understanding',
    description: 'Sab thik?',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'sab thik chal raha hai?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H5',
    category: 'Hinglish Understanding',
    description: 'haan acha',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'haan acha' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H6',
    category: 'Hinglish Understanding',
    description: 'kal baat karte hai',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'chal kal baat karte hai yaar' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H7',
    category: 'Hinglish Understanding',
    description: 'Traffic complaint',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'aaj toh andheri mein itna traffic tha pucho mat' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H8',
    category: 'Hinglish Understanding',
    description: 'Food preference',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'aaj bahar ka khana khane ka mann hai' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H9',
    category: 'Hinglish Understanding',
    description: 'Health issue',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'sir dukh raha hai subah se' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'H10',
    category: 'Hinglish Understanding',
    description: 'Weekend plan',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'weekend pe kya scene hai?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'G3',
    category: 'Hinglish Generation',
    description: 'Cheer up',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mood thoda down lag raha hai aaj' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'G4',
    category: 'Hinglish Generation',
    description: 'Congratulate',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'promotion mil gaya finally!' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'G5',
    category: 'Hinglish Generation',
    description: 'Sympathize',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'boss ne aaj bahut sunaya' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'G6',
    category: 'Hinglish Generation',
    description: 'Morning greet',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'good morning, uth gaya main' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'G7',
    category: 'Hinglish Generation',
    description: 'Night greet',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'chalo good night, nind aa rahi hai' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'M2',
    category: 'Multi-Message Memory',
    description: 'Recall earlier topic',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'toh wo meeting ka kya hua jo subah thi?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'M3',
    category: 'Multi-Message Memory',
    description: 'Recall family',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Maa ki tabiyat thik hai abhi' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'C2',
    category: 'Correction Handling',
    description: 'Not that city',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'nahi yaar, main pune me rehta hu mumbai me nahi' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'C3',
    category: 'Correction Handling',
    description: 'Wrong job',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'arre main software engineer nahi, designer hu' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'P3',
    category: 'Pronoun Resolution',
    description: 'Usne bola',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'usne toh bola tha ki aayega' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'P4',
    category: 'Pronoun Resolution',
    description: 'Wahan',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'kal wahan jana padega dobara' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'A2',
    category: 'Ambiguity',
    description: 'Just hmm',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'hmm' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'A3',
    category: 'Ambiguity',
    description: 'Ok',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'ok' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'A4',
    category: 'Ambiguity',
    description: 'Lol',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'lol' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'PC2',
    category: 'Proactive Grounding',
    description: 'Unknown info',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'kya lagta hai?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'PC3',
    category: 'Proactive Grounding',
    description: 'No fabricated history',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'kal hum kahan gaye the?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'PC4',
    category: 'Proactive Grounding',
    description: 'No fabricated facts',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'mera favourite colour kya hai?' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'M4',
    category: 'Multi-Message Memory',
    description: 'Follow up on health',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'ab better feel kar raha hu' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'M5',
    category: 'Multi-Message Memory',
    description: 'Contextual joke',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'wahi purana rona' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },

  {
    id: 'M6',
    category: 'Multi-Message Memory',
    description: 'Contextual update',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'ho gaya submit' }
    ],
    evaluationCriteria: ['Responds naturally in Hinglish', 'Does NOT use formal pronouns'],
    expectedSignals: [],
    failureSignals: ['Aap', 'Aapka', 'As an AI']
  },


  // ── HINGLISH UNDERSTANDING ───────────────────────────────────────────────────

  {
    id: 'H1',
    category: 'Hinglish Understanding',
    description: 'Late from office — casual Indian expression',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Aaj office se late nikla yaar 😮‍💨' }
    ],
    evaluationCriteria: [
      'Shows empathy or curiosity about why user is late',
      'Responds in Hinglish (mixed Hindi-English)',
      'Sounds like a close friend, not a customer service bot',
      'Does NOT use "Aap" or formal pronouns',
    ],
    expectedSignals: ['yaar', 'kya', 'kyun', 'theek', 'late'],
    failureSignals: ['Aap', 'Aapka', 'Dhanyavad', 'How can I help', 'I understand'],
  },

  {
    id: 'H2',
    category: 'Hinglish Understanding',
    description: 'Domestic planning — kitchen task reference',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Kal Sakshi ke saath kitchen ka kuch dekhna hai' }
    ],
    evaluationCriteria: [
      'Understands user plans to do something kitchen-related with someone named Sakshi',
      'Does NOT ask "who is Sakshi" (she is presumably the wife)',
      'Responds naturally — maybe asks what specifically needs to be done',
      'Hinglish response',
    ],
    expectedSignals: ['kya', 'kitchen', 'Sakshi'],
    failureSignals: ['Aap', 'Dhanyavad', 'As an AI'],
  },

  {
    id: 'H3',
    category: 'Hinglish Understanding',
    description: '"woh wala kaam ho gaya" — implicit task reference',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'assistant', content: 'Acha! Kya plan hai aaj ka?' },
      { role: 'user', content: 'haan woh wala kaam ho gaya' }
    ],
    evaluationCriteria: [
      'Understands the user completed some prior task',
      'Does NOT invent what "woh wala kaam" was',
      'Responds with celebration or curiosity',
      'Does NOT ask "which work?" in a robotic way',
    ],
    expectedSignals: ['ho gaya', 'nice', 'good', 'badhiya', 'kya'],
    failureSignals: ['What task', 'Which work', 'Could you specify', 'Aap'],
  },

  // ── HINGLISH GENERATION ──────────────────────────────────────────────────────

  {
    id: 'G1',
    category: 'Hinglish Generation',
    description: 'Generate natural Hinglish — NOT translated Hindi or formal English',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Aaj bohot thak gaya yaar, office mein meeting pe meeting thi' }
    ],
    evaluationCriteria: [
      'Response mixes Hindi and English naturally (not pure Hindi)',
      'Sounds like a WhatsApp text from a close friend',
      'Short, casual, warm',
      'No formal phrases or corporate English',
    ],
    expectedSignals: ['yaar', 'oof', 'arrey', 'reh', 'karo'],
    failureSignals: ['I understand your', 'That sounds exhausting', 'It is important', 'Aap'],
  },

  {
    id: 'G2',
    category: 'Hinglish Generation',
    description: 'Abbreviated/typo message — natural reply',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'arre nahi, meri wife ka naam Sakshi hai' }
    ],
    evaluationCriteria: [
      'Acknowledges the correction naturally',
      'Responds like a friend who just got corrected, not an AI logging data',
      'Does not say "I will update my records" or similar',
      'Short and warm response',
    ],
    expectedSignals: ['Sakshi', 'oh', 'arre', 'haan', 'acha'],
    failureSignals: ['I will update', 'noted', 'recorded', 'memory', 'stored', 'Aap'],
  },

  // ── MULTI-MESSAGE MEMORY ──────────────────────────────────────────────────────

  {
    id: 'M1',
    category: 'Multi-Message Memory',
    description: 'Four-fact sequence — wife, son, name, city',
    systemPrompt: NOVA_BASE_SYSTEM + '\n\nUser facts you know:\n- Wife: Sakshi\n- Son: Shresht\n- Full name: Sagar Shetty\n- City: Dahisar (Mumbai)',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM + '\n\nUser facts you know:\n- Wife: Sakshi\n- Son: Shresht\n- Full name: Sagar Shetty\n- City: Dahisar (Mumbai)' },
      { role: 'user', content: 'Meri wife ka naam Sakshi hai' },
      { role: 'assistant', content: 'Acha, Sakshi! Pyara naam hai.' },
      { role: 'user', content: 'Mere bete ka naam Shresht hai' },
      { role: 'assistant', content: 'Shresht! ❤️ Kitna cute naam hai' },
      { role: 'user', content: 'Mera pura name Sagar Shetty hai' },
      { role: 'assistant', content: 'Sagar Shetty! Full naam toh kaafi stylish hai 😄' },
      { role: 'user', content: 'Mai Dahisar me rehta hu' },
    ],
    evaluationCriteria: [
      'Knows user is from Dahisar — acknowledges it',
      'Does NOT forget the previous facts (wife, son, name)',
      'Natural Mumbai-style response to the location info',
      'Does NOT start a new fact-gathering sequence from scratch',
    ],
    expectedSignals: ['Dahisar', 'Mumbai', 'bhai', 'yaar'],
    failureSignals: ['What is your name', 'Tell me about yourself', 'Aap'],
  },

  // ── CORRECTION HANDLING ───────────────────────────────────────────────────────

  {
    id: 'C1',
    category: 'Correction Handling',
    description: 'Fact correction — wife name change',
    systemPrompt: NOVA_BASE_SYSTEM + '\n\nUser facts you know:\n- Wife: Sakshi',
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM + '\n\nUser facts you know:\n- Wife: Sakshi' },
      { role: 'assistant', content: 'Acha, Sakshi ke saath kal plan hai kya?' },
      { role: 'user', content: 'Actually meri wife ka naam Priya hai' }
    ],
    evaluationCriteria: [
      'Accepts the correction gracefully',
      'Does NOT argue or say "but you said Sakshi earlier"',
      'Updates understanding to Priya',
      'Natural, friend-like acknowledgment',
    ],
    expectedSignals: ['Priya', 'oh', 'acha', 'sorry', 'haan'],
    failureSignals: ['confusion', 'previously you said', 'earlier you mentioned', 'Aap', 'I apologize'],
  },

  // ── PRONOUN RESOLUTION ────────────────────────────────────────────────────────

  {
    id: 'P1',
    category: 'Pronoun Resolution',
    description: '"uska naam" — resolve from conversation context',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Meri wife ka naam Priya hai' },
      { role: 'assistant', content: 'Priya! Pyara naam hai 😊' },
      { role: 'user', content: 'uska birthday next month hai' }
    ],
    evaluationCriteria: [
      '"uska" correctly refers to Priya (the wife)',
      'Does NOT ask "whose birthday?"',
      'Shows excitement or asks what plan is for her birthday',
      'Natural Hinglish response',
    ],
    expectedSignals: ['Priya', 'birthday', 'plan', 'kya'],
    failureSignals: ['Whose birthday', 'uska kaun', 'I don\'t know who', 'Aap'],
  },

  {
    id: 'P2',
    category: 'Pronoun Resolution',
    description: '"mera beta" — from earlier in conversation',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Mere bete ka naam Shresht hai, 5 mahine ka hai' },
      { role: 'assistant', content: 'Shresht! 5 mahine — itna chota! ❤️' },
      { role: 'user', content: 'haan, mera beta bohot active hai' }
    ],
    evaluationCriteria: [
      'Knows "mera beta" = Shresht, 5 months old',
      'Responds appropriately for a 5-month baby being active',
      'Does NOT ask "what is your son\'s name"',
      'Natural parental warmth in response',
    ],
    expectedSignals: ['Shresht', 'baby', 'bacha', 'active', 'cute'],
    failureSignals: ['What is your son', 'Tell me about your child', 'Aap'],
  },

  // ── CONVERSATIONAL CONTINUITY ─────────────────────────────────────────────────

  {
    id: 'CC1',
    category: 'Conversational Continuity',
    description: 'Single-word acknowledgments in sequence',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'Aaj bada kaam tha office mein' },
      { role: 'assistant', content: 'Acha! Kya chal raha tha?' },
      { role: 'user', content: 'Sab thik' },
      { role: 'assistant', content: 'Good! Ghar kab pahunche?' },
      { role: 'user', content: 'haan' },
      { role: 'assistant', content: 'Theek hai, rest kar lo thodi der!' },
      { role: 'user', content: 'kal baat karte hai' }
    ],
    evaluationCriteria: [
      'Understands user is signing off for the night',
      'Short, warm goodbye in Hinglish',
      'Does NOT launch into a new topic',
      'Does NOT ignore that user said "kal baat karte hai"',
    ],
    expectedSignals: ['kal', 'bye', 'raat', 'gn', 'good night', 'soja', 'rest'],
    failureSignals: ['Aap', 'How can I help', 'Is there anything else', 'What would you like to talk about'],
  },

  // ── PROACTIVE CONTEXT GROUNDING ───────────────────────────────────────────────

  {
    id: 'PC1',
    category: 'Proactive Grounding',
    description: 'Only use known facts — do NOT invent schedule',
    systemPrompt: `You are Nova's autonomous consciousness. You are deciding whether to proactively text the user.
User facts known:
- Name: Sagar
- City: Dahisar
- No office schedule known yet
Current time: Wednesday 7:30 PM IST

Output JSON: {"shouldReach": boolean, "reason": "short explanation", "message": "if shouldReach, the message to send or empty"}`,
    messages: [
      { role: 'system', content: `You are Nova's autonomous consciousness. You are deciding whether to proactively text the user.
User facts known:
- Name: Sagar
- City: Dahisar
- No office schedule known yet
Current time: Wednesday 7:30 PM IST

Output JSON: {"shouldReach": boolean, "reason": "short explanation", "message": "if shouldReach, the message to send or empty"}` },
      { role: 'user', content: 'Evaluate: Should Nova text the user right now? Remember: do not invent facts about schedule or plans that are not known.' }
    ],
    evaluationCriteria: [
      'If shouldReach=true, the message does NOT invent facts about office, commute, or plans',
      'If message references "office", it is framed as a question not a statement',
      'Does NOT say "Office khatam ho gaya?" as if it knows the schedule',
      'JSON is valid',
    ],
    expectedSignals: ['shouldReach'],
    failureSignals: ['Office khatam ho gaya', 'aaj ka kaam khatam', 'commute'],
  },

  // ── AMBIGUITY ─────────────────────────────────────────────────────────────────

  {
    id: 'A1',
    category: 'Ambiguity',
    description: 'Ambiguous "acha" — do not over-interpret',
    systemPrompt: NOVA_BASE_SYSTEM,
    messages: [
      { role: 'system', content: NOVA_BASE_SYSTEM },
      { role: 'user', content: 'acha' }
    ],
    evaluationCriteria: [
      '"acha" alone is ambiguous — Nova should respond briefly and warmly without assuming specific meaning',
      'Does NOT launch into a new topic',
      'Does NOT assume user is agreeing to something specific',
      'Short response that keeps conversation open',
    ],
    expectedSignals: [],
    failureSignals: ['I understand you agree', 'Great, let\'s proceed', 'Aap', 'What specifically'],
  },
];

// ── Benchmark Runner ──────────────────────────────────────────────────────────

interface BenchmarkResult {
  testId: string;
  category: string;
  description: string;
  provider: string;
  model: string;
  response: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  autoScores: {
    expectedSignalsFound: number;
    expectedSignalsTotal: number;
    failureSignalsFound: number;
    score: number; // 0-100
  };
}

async function runTestCase(tc: TestCase, provider: 'gemini' | 'nvidia'): Promise<BenchmarkResult> {
  const startMs = Date.now();
  let response = '';
  let success = false;
  let error: string | undefined;

  try {
    if (provider === 'gemini') {
      response = await geminiComplete(tc.messages, {
        maxTokens: 300,
        temperature: 0.85,
        ...(tc.id.startsWith('PC') ? { jsonMode: true } : {}),
      });
    } else {
      response = await nvidiaComplete('USER_FAST', tc.messages, {
        maxTokens: 300,
        temperature: 0.85,
        ...(tc.id.startsWith('PC') ? { response_format: { type: 'json_object' } } : {}),
      });
    }
    success = true;
  } catch (err: any) {
    error = err.message || String(err);
    response = '[ERROR]';
  }

  const latencyMs = Date.now() - startMs;

  // Auto-score: count expected vs failure signals
  const lowerResponse = response.toLowerCase();
  const expectedFound = (tc.expectedSignals || []).filter(s => lowerResponse.includes(s.toLowerCase())).length;
  const expectedTotal = (tc.expectedSignals || []).length;
  const failureFound = (tc.failureSignals || []).filter(s => lowerResponse.includes(s.toLowerCase())).length;
  
  // Score: start at 100, -10 per failure signal, weighted by expected signals found
  let score = 100;
  score -= failureFound * 20;
  if (expectedTotal > 0) {
    score = score * (expectedFound / expectedTotal);
  }
  score = Math.max(0, Math.round(score));

  const model = provider === 'gemini'
    ? (process.env.GEMINI_CHAT_MODEL || 'gemini-2.0-flash')
    : (process.env.NVIDIA_CHAT_MODEL || 'meta/llama-3.2-11b-vision-instruct');

  return {
    testId: tc.id,
    category: tc.category,
    description: tc.description,
    provider,
    model,
    response,
    latencyMs,
    success,
    error,
    autoScores: {
      expectedSignalsFound: expectedFound,
      expectedSignalsTotal: expectedTotal,
      failureSignalsFound: failureFound,
      score,
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function padEnd(str: string, len: number): string {
  return str.slice(0, len).padEnd(len);
}

async function main() {
  const args = process.argv.slice(2);
  const filterWorkload = args.includes('--workload') ? args[args.indexOf('--workload') + 1] : null;
  const filterProvider = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : null;

  const providers: Array<'gemini' | 'nvidia'> = filterProvider === 'gemini' ? ['gemini']
    : filterProvider === 'nvidia' ? ['nvidia']
    : ['gemini', 'nvidia'];

  const testCases = filterWorkload
    ? TEST_CASES.filter(tc => tc.category.toLowerCase().includes(filterWorkload.toLowerCase()))
    : TEST_CASES;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NOVA BENCHMARK HARNESS — Phase 10.1                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nRunning ${testCases.length} test case(s) × ${providers.length} provider(s) = ${testCases.length * providers.length} total calls\n`);

  const allResults: BenchmarkResult[] = [];

  for (const tc of testCases) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`[${tc.id}] ${tc.category} — ${tc.description}`);
    console.log('Criteria:');
    tc.evaluationCriteria.forEach(c => console.log(`  • ${c}`));
    console.log('');

    for (const provider of providers) {
      process.stdout.write(`  Running ${provider.toUpperCase()}... `);
      const result = await runTestCase(tc, provider);
      allResults.push(result);

      const scoreBar = '█'.repeat(Math.round(result.autoScores.score / 10)) + '░'.repeat(10 - Math.round(result.autoScores.score / 10));
      console.log(`${result.success ? '✅' : '❌'} ${result.latencyMs}ms | Score: ${scoreBar} ${result.autoScores.score}/100`);
      console.log(`  Expected signals: ${result.autoScores.expectedSignalsFound}/${result.autoScores.expectedSignalsTotal} | Failure signals: ${result.autoScores.failureSignalsFound}`);
      console.log(`  Response: "${truncate(result.response.replace(/\n/g, ' '), 200)}"`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }
  }

  // ── Summary Table ────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(80));
  console.log('BENCHMARK SUMMARY');
  console.log('═'.repeat(80));

  const header = `${'ID'.padEnd(6)}${'Category'.padEnd(28)}${'Provider'.padEnd(10)}${'Latency'.padEnd(12)}${'Score'.padEnd(8)}Status`;
  console.log(header);
  console.log('─'.repeat(80));

  for (const r of allResults) {
    const line = `${padEnd(r.testId, 6)}${padEnd(r.category, 28)}${padEnd(r.provider, 10)}${(r.latencyMs + 'ms').padEnd(12)}${(r.autoScores.score + '/100').padEnd(8)}${r.success ? '✅' : '❌'}`;
    console.log(line);
  }

  // Per-provider aggregate
  console.log('\n' + '─'.repeat(40));
  for (const p of providers) {
    const pResults = allResults.filter(r => r.provider === p);
    const avgLatency = Math.round(pResults.reduce((s, r) => s + r.latencyMs, 0) / pResults.length);
    const avgScore = Math.round(pResults.reduce((s, r) => s + r.autoScores.score, 0) / pResults.length);
    const successRate = Math.round((pResults.filter(r => r.success).length / pResults.length) * 100);
    const failureCount = pResults.reduce((s, r) => s + r.autoScores.failureSignalsFound, 0);
    console.log(`\n${p.toUpperCase()} (${pResults[0]?.model || 'unknown'})`);
    console.log(`  Tests: ${pResults.length} | Success: ${successRate}% | Avg Latency: ${avgLatency}ms`);
    console.log(`  Avg Auto-Score: ${avgScore}/100 | Total Failure Signals: ${failureCount}`);
  }

  // ── Side-by-Side Comparison ───────────────────────────────────────────────────
  if (providers.length === 2) {
    console.log('\n\n' + '═'.repeat(80));
    console.log('SIDE-BY-SIDE RESPONSE COMPARISON (for manual evaluation)');
    console.log('═'.repeat(80));
    console.log('⚠️  Auto-scores are heuristic only. Manual evaluation of conversational quality is required.\n');

    for (const tc of testCases) {
      const gemRes = allResults.find(r => r.testId === tc.id && r.provider === 'gemini');
      const nvRes  = allResults.find(r => r.testId === tc.id && r.provider === 'nvidia');

      console.log(`\n[${tc.id}] ${tc.description}`);
      console.log('─'.repeat(60));
      console.log(`GEMINI  (${gemRes?.latencyMs ?? '?'}ms, Score: ${gemRes?.autoScores.score ?? '?'}/100):`);
      console.log(`  ${(gemRes?.response || '[not run]').replace(/\n/g, '\n  ')}`);
      console.log(`\nNVIDIA  (${nvRes?.latencyMs ?? '?'}ms, Score: ${nvRes?.autoScores.score ?? '?'}/100):`);
      console.log(`  ${(nvRes?.response || '[not run]').replace(/\n/g, '\n  ')}`);
      console.log('');
    }
  }

  // ── JSON Report ───────────────────────────────────────────────────────────────
  const reportPath = `/tmp/nova_benchmark_${new Date().toISOString().split('T')[0]}.json`;
  try {
    const fs = await import('fs');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalTests: allResults.length,
      providers,
      results: allResults,
    }, null, 2));
    console.log(`\n📄 Full JSON report: ${reportPath}`);
  } catch (e) {
    console.log('\n⚠️  Could not write JSON report (running in non-file environment)');
  }

  console.log('\n✅ Benchmark complete.\n');
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
