import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.NVIDIA_API_KEY;

async function run() {
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{role: 'user', content: 'hi'}],
      max_tokens: 10
    })
  });
  
  console.log('Status:', res.status);
  console.log('Headers:', Object.fromEntries(res.headers.entries()));
  const text = await res.text();
  console.log('Body:', text);
}
run();
