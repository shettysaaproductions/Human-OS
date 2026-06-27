import dotenv from 'dotenv';
dotenv.config();

async function testNvidiaRaw() {
  const apiKey = process.env.NVIDIA_API_KEY || '';
  const model = process.env.NVIDIA_CHAT_MODEL || 'meta/llama-3.3-70b-instruct';
  const url = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

  console.log(`NVIDIA API Key: ${apiKey.substring(0, 15)}...`);
  console.log(`URL: ${url}/chat/completions`);
  console.log(`Model: ${model}`);

  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say hi' }],
        max_tokens: 10
      })
    });

    const status = res.status;
    const headers = Object.fromEntries(res.headers.entries());
    const bodyText = await res.text();

    console.log(`Status: ${status}`);
    console.log('Headers:', headers);
    console.log('Body:', bodyText);
  } catch (err: any) {
    console.error('Fetch error:', err);
  }
}

testNvidiaRaw().then(() => process.exit(0));
