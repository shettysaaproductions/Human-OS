/**
 * Jest setup — runs before each test file.
 */
process.env.TZ = 'UTC';

if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => '00000000-0000-0000-0000-000000000000',
    },
    writable: true,
  });
}
