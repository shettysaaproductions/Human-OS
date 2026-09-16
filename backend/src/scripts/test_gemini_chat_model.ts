import 'dotenv/config';
import { geminiComplete } from '../lib/gemini';

async function main() {
  try {
    const text = await geminiComplete([
      { role: 'user', content: 'Say hello in one word' }
    ]);
    console.log('geminiComplete success:', text);
  } catch (err: any) {
    console.error('geminiComplete error:', err.message);
  }
}

main().catch(console.error);
