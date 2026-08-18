import { config } from 'dotenv'; config();
import { chatCompletion } from './lib/nvidia';

async function test() {
  const res = await chatCompletion([{ role: 'user', content: 'Say hello in 3 words' }], { model: 'nvidia/llama-3.3-nemotron-super-49b-v1' });
  console.log('Test result:', res);
}
test();
