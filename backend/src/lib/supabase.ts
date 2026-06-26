/**
 * Supabase client factory.
 *
 * Two clients:
 * - `supabaseAnon`: uses the anon key — safe for auth flows (respects RLS).
 * - `supabaseAdmin`: uses the service role key — bypasses RLS for server-side
 *   operations. NEVER expose this key to the client.
 *
 * Clients are created lazily to avoid crashing the server at startup when
 * environment variables are missing.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from './logger';

let _supabaseAnon: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

function validateSupabaseConfig(): void {
  if (!config.supabase.url || config.supabase.url.trim() === '') {
    throw new Error('SUPABASE_URL environment variable is missing or empty. Set it in your Render dashboard.');
  }
  if (!config.supabase.url.startsWith('https://')) {
    throw new Error(`SUPABASE_URL is invalid: "${config.supabase.url}". It must start with https://`);
  }
  if (!config.supabase.anonKey || config.supabase.anonKey.trim() === '') {
    throw new Error('SUPABASE_ANON_KEY environment variable is missing or empty. Set it in your Render dashboard.');
  }
}

export function getSupabaseAnon(): SupabaseClient {
  if (!_supabaseAnon) {
    validateSupabaseConfig();
    logger.info('Creating Supabase anon client', { url: config.supabase.url });
    _supabaseAnon = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAnon;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    validateSupabaseConfig();
    if (!config.supabase.serviceRoleKey || config.supabase.serviceRoleKey.trim() === '') {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is missing or empty.');
    }
    logger.info('Creating Supabase admin client', { url: config.supabase.url });
    _supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

// Backward-compatible exports — these are getters, not instances.
// Routes that import supabaseAnon directly will now call getSupabaseAnon() lazily.
export const supabaseAnon = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAnon() as any)[prop];
  },
});

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});
