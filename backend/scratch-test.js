const { chatCompletion } = require('./src/lib/nvidia');

async function test() {
  try {
    console.log('Sending to NVIDIA...');
    const res = await chatCompletion([
      { role: 'system', content: 'You are a test assistant. Reply exactly with "Hello, world!"' },
      { role: 'user', content: 'Say hello' }
    ]);
    console.log('Response:', res);
  } catch (err) {
    console.error('NVIDIA Error:', err.message, err.status, err.name);
  }
}

test();
