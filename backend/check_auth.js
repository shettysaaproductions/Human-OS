/**
 * check_auth.js - Authentication verification utility
 *
 * VULNERABILITY FIX: Removed hardcoded Supabase credentials.
 * All API keys must now be provided via environment variables.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Validate required environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.');
  console.error('Usage: Set these environment variables before running this script.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Hash a user ID for safe logging.
 */
function hashUserId(userId) {
  return crypto
    .createHash('sha256')
    .update(userId)
    .digest('hex')
    .substring(0, 12);
}

async function test() {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: 'test3@humanos.app',
      password: 'password123'
    });

    if (error) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
      return;
    }

    // Log only the hashed user ID, never the raw identifier
    if (data?.user?.id) {
      console.log(JSON.stringify({ user_id_hash: hashUserId(data.user.id) }, null, 2));
    } else {
      console.log(JSON.stringify({ data }, null, 2));
    }
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
}

// Only run the test if this file is executed directly
if (require.main === module) {
  test();
}

module.exports = { test, hashUserId };
