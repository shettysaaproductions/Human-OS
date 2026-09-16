import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const keys: { name: string; key: string }[] = [];
  if (process.env.GEMINI_API_KEY) keys.push({ name: 'GEMINI_API_KEY', key: process.env.GEMINI_API_KEY });
  for (let i = 1; i <= 20; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push({ name: `GEMINI_API_KEY_${i}`, key: k });
  }

  for (const { name, key } of keys) {
    const client = new GoogleGenerativeAI(key);
    for (const m of ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']) {
      try {
        const model = client.getGenerativeModel({ model: m });
        const res = await model.generateContent('Hi');
        console.log(`✅ [${name}] [${m}] WORKS! Output: ${res.response.text().trim()}`);
        break;
      } catch (e: any) {
        // failover
      }
    }
  }
}

main().catch(console.error);
