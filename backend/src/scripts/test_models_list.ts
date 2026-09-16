import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || '';
  const client = new GoogleGenerativeAI(key);

  const candidates = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-2.5-flash-lite',
  ];

  for (const m of candidates) {
    try {
      const model = client.getGenerativeModel({ model: m });
      const res = await model.generateContent('Hi');
      console.log(`✅ [${m}] WORKS! Output: ${res.response.text().trim()}`);
    } catch (e: any) {
      console.log(`❌ [${m}] Failed: ${e.message.substring(0, 100)}`);
    }
  }
}

main().catch(console.error);
