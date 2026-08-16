import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import OpenAI from 'openai';

const apiKey = process.env.NVIDIA_API_KEY || '';
console.log('API Key present:', !!apiKey, '(length:', apiKey.length, ')');
console.log('Testing 8B model...');

const client = new OpenAI({
  apiKey,
  baseURL: 'https://integrate.api.nvidia.com/v1',
  maxRetries: 0
});

async function test() {
  const start = Date.now();
  try {
    const response = await client.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [
        { role: 'system', content: 'You are Nova, a casual friend. Reply in 1 short sentence in Hinglish.' },
        { role: 'user', content: 'Hi' }
      ],
      max_tokens: 128,
      temperature: 0.9,
      stream: false
    });
    const elapsed = Date.now() - start;
    console.log(`✅ 8B Model replied in ${elapsed}ms:`);
    console.log(response.choices[0]?.message?.content);
  } catch (err: any) {
    const elapsed = Date.now() - start;
    console.error(`❌ 8B Model FAILED after ${elapsed}ms:`);
    console.error('Status:', err.status);
    console.error('Message:', err.message);
    console.error('Type:', err.type);
  }

  // Also test the 49B model for comparison
  console.log('\nTesting 49B model...');
  const start2 = Date.now();
  try {
    const response2 = await client.chat.completions.create({
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
      messages: [
        { role: 'system', content: 'You are Nova, a casual friend. Reply in 1 short sentence in Hinglish.' },
        { role: 'user', content: 'Hi' }
      ],
      max_tokens: 128,
      temperature: 0.9,
      stream: false
    });
    const elapsed2 = Date.now() - start2;
    console.log(`✅ 49B Model replied in ${elapsed2}ms:`);
    console.log(response2.choices[0]?.message?.content);
  } catch (err: any) {
    const elapsed2 = Date.now() - start2;
    console.error(`❌ 49B Model FAILED after ${elapsed2}ms:`);
    console.error('Status:', err.status);
    console.error('Message:', err.message);
  }
}

test();
