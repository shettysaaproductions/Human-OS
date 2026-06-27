/**
 * Environment variable configuration.
 * All env vars are validated at startup — the server will refuse to start
 * if any required variable is missing or malformed.
 */

import dotenv from 'dotenv';

// Load .env file before anything else
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : defaultValue;
}

export const config = {
  server: {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
    appVersion: optionalEnv('APP_VERSION', '1.0.0'),
  },

  nvidia: {
    apiKey: requireEnv('NVIDIA_API_KEY'),
    baseUrl: optionalEnv('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    chatModel: optionalEnv('NVIDIA_CHAT_MODEL', 'meta/llama-3.3-70b-instruct'),
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
    degradedMode: optionalEnv('DATABASE_DEGRADED_MODE', 'false') === 'true',
    memorySearchLimit: parseInt(optionalEnv('MEMORY_SEARCH_LIMIT', '200'), 10),
    egressWarningThresholdMb: parseInt(optionalEnv('EGRESS_WARNING_THRESHOLD_MB', '400'), 10),
  },
} as const;
