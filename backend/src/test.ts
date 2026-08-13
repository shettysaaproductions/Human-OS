import { config } from 'dotenv'; config();
import { chatCompletion } from './lib/nvidia';

async function test() {
  const res = await chatCompletion([{ role: 'user', content: 'Say hello in 3 words' }], { model: 'meta/llama-3.3-70b-instruct' });
  console.log('Test result:', res);
}
test();


