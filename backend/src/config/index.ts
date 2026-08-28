/**
 * Environment variable configuration.
 * All env vars are validated at startup — the server will refuse to start
 * if any required variable is missing or malformed.
 */

import dotenv from 'dotenv';

// Load .env file before anything else
dotenv.config();


function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  const resolved = value && value.trim() !== '' ? value.trim() : defaultValue;
  
  // Auto-upgrade retired models (Llama 3.1 8B retired Aug 26, 2026, 70B retired, Nemotron-49B preview retired)
  // to active meta/llama-3.2-11b-vision-instruct so stale Render environment variables don't crash with 410 Gone.
  const lower = resolved.toLowerCase();
  if (lower.includes('70b-instruct') || lower.includes('3.1-8b-instruct') || lower.includes('nemotron-super-49b') || lower.includes('nemotron-70b')) {
    return 'meta/llama-3.2-11b-vision-instruct';
  }
  return resolved;
}

export const config = {
  server: {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
    appVersion: optionalEnv('APP_VERSION', '1.0.0'),
  },


  nvidia: {
    apiKey:   optionalEnv('NVIDIA_API_KEY',    ''),  // Key 1:  Frontal Cortex (real-time chat)
    apiKey2:  optionalEnv('NVIDIA_API_KEY_2',  ''),  // Key 2:  Hippocampus (memory)
    apiKey3:  optionalEnv('NVIDIA_API_KEY_3',  ''),  // Key 3:  Cerebellum (background)
    apiKey4:  optionalEnv('NVIDIA_API_KEY_4',  ''),  // Key 4:  Reserve / failover
    apiKey5:  optionalEnv('NVIDIA_API_KEY_5',  ''),  // Key 5:  Frontal overflow
    apiKey6:  optionalEnv('NVIDIA_API_KEY_6',  ''),  // Key 6:  Frontal overflow
    apiKey7:  optionalEnv('NVIDIA_API_KEY_7',  ''),  // Key 7:  Frontal overflow
    apiKey8:  optionalEnv('NVIDIA_API_KEY_8',  ''),  // Key 8:  Frontal overflow
    apiKey9:  optionalEnv('NVIDIA_API_KEY_9',  ''),  // Key 9:  Hippocampus overflow
    apiKey10: optionalEnv('NVIDIA_API_KEY_10', ''),  // Key 10: Hippocampus overflow
    apiKey11: optionalEnv('NVIDIA_API_KEY_11', ''),  // Key 11: Cerebellum overflow
    apiKey12: optionalEnv('NVIDIA_API_KEY_12', ''),  // Key 12: Cerebellum overflow
    apiKey13: optionalEnv('NVIDIA_API_KEY_13', ''),  // Key 13: Deep Cortex (Reflection/Reasoning)
    apiKey14: optionalEnv('NVIDIA_API_KEY_14', ''),  // Key 14: Deep Cortex overflow
    apiKey15: optionalEnv('NVIDIA_API_KEY_15', ''),  // Key 15: Emergency reserve
    baseUrl:   optionalEnv('NVIDIA_BASE_URL',   'https://integrate.api.nvidia.com/v1'),
    chatModel: optionalEnv('NVIDIA_CHAT_MODEL', 'meta/llama-3.2-11b-vision-instruct'),
    deepModel: optionalEnv('NVIDIA_DEEP_MODEL', 'meta/llama-3.2-11b-vision-instruct'),
  },

  // Optional in Phase 1 — Supabase is not yet used.
  // Required in Phase 2 (auth + memory). Set these before building auth.
  supabase: {
    url: optionalEnv('SUPABASE_URL', ''),
    anonKey: optionalEnv('SUPABASE_ANON_KEY', ''),
    serviceRoleKey: optionalEnv('SUPABASE_SERVICE_ROLE_KEY', ''),
  },

  cors: {
    origins: optionalEnv('CORS_ORIGINS', 'http://localhost:3001,http://localhost:8081')
      .split(',')
      .map((o) => o.trim()),
  },

  db: {
    databaseUrl: optionalEnv('DATABASE_URL', ''),
    degradedMode: optionalEnv('DATABASE_DEGRADED_MODE', 'false') === 'true',
    memorySearchLimit: parseInt(optionalEnv('MEMORY_SEARCH_LIMIT', '200'), 10),
    egressWarningThresholdMb: parseInt(optionalEnv('EGRESS_WARNING_THRESHOLD_MB', '400'), 10),
  },

  expo: {
    accessToken: optionalEnv('EXPO_ACCESS_TOKEN', ''),
  },

  gemini: {
    // Two production keys configured for Phase 10.1 experimentation.
    // Additional keys (3, 4) can be added later without code changes.
    apiKey1: optionalEnv('GEMINI_API_KEY_1', ''),
    apiKey2: optionalEnv('GEMINI_API_KEY_2', ''),
    // Primary Gemini model for conversational workloads
    chatModel: optionalEnv('GEMINI_CHAT_MODEL', 'gemini-3.6-flash'),
  },

  // Cognitive Model Router — maps workloads to providers.
  // Valid providers: 'gemini' | 'nvidia'
  // Override any workload via env vars, e.g. ROUTE_CONVERSATION=nvidia to revert.
  routing: {
    conversation:       optionalEnv('ROUTE_CONVERSATION',       'gemini'),
    proactiveReasoning: optionalEnv('ROUTE_PROACTIVE_REASONING', 'gemini'),
    proactiveGeneration:optionalEnv('ROUTE_PROACTIVE_GENERATION','gemini'),
    memoryExtraction:   optionalEnv('ROUTE_MEMORY_EXTRACTION',   'nvidia'),
    lifeThreads:        optionalEnv('ROUTE_LIFE_THREADS',         'nvidia'),
    actionIntelligence: optionalEnv('ROUTE_ACTION_INTELLIGENCE',  'nvidia'),
    backgroundCognition:optionalEnv('ROUTE_BACKGROUND_COGNITION', 'nvidia'),
    vision:             optionalEnv('ROUTE_VISION',               'nvidia'),
    turnAnalysis:       optionalEnv('ROUTE_TURN_ANALYSIS',        'nvidia'),
  },
} as const;
