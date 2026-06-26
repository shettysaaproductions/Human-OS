/**
 * Supabase client factory.
 *
 * Two clients:
 * - `supabaseAnon`: uses the anon key — safe for auth flows (respects RLS).
 * - `supabaseAdmin`: uses the service role key — bypasses RLS for server-side
 *   operations. NEVER expose this key to the client.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

export const supabaseAnon = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
