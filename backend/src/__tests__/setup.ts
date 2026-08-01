process.env.TZ = 'UTC';

// Mock crypto.randomUUID if not available in this Node environment
if (!global.crypto) {
  (global as any).crypto = {};
}
if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = () => '00000000-0000-0000-0000-000000000000';
}
