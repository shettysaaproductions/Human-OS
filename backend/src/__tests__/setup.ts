/**
 * Jest setup — runs before each test file.
 */
process.env.TZ = 'UTC';
process.env.NODE_ENV = 'test';

if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://dummy-test.supabase.co';
}
if (!process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = 'dummy-anon-key-for-test-suite';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key-for-test-suite';
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'dummy-jwt-secret-for-testing-only-12345';
}

if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => '00000000-0000-0000-0000-000000000000',
    },
    writable: true,
  });
}

