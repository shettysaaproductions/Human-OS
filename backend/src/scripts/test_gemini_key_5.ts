import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI } from '@google/genai';
import { geminiLivePool } from '../lib/geminiLivePool';

// Non-null assertion: process.exit(1) above guarantees key5 is defined beyond this point.
// TypeScript doesn't narrow across closure boundaries, so we assert explicitly.
const key5: string = process.env.GEMINI_API_KEY_5 ?? '';
if (!key5) {
  console.error('❌ GEMINI_API_KEY_5 is not set in environment or .env');
  process.exit(1);
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING GEMINI_API_KEY_5 FOR VOICE & LIVE API');
  console.log(`🔑 Key prefix: ${key5.substring(0, 12)}... (length: ${key5.length})`);
  console.log('====================================================\n');

  // Test 1: @google/genai SDK model check
  console.log('--- TEST 1: Check Model Generation with Key 5 ---');
  const testModels = ['gemini-2.5-flash-latest', 'gemini-1.5-flash-8b', 'gemini-2.5-pro'];
  for (const m of testModels) {
    try {
      const ai = new GoogleGenAI({ apiKey: key5 });
      const res = await ai.models.generateContent({
        model: m,
        contents: 'Say hi in one word.',
      });
      console.log(`✅ TEST 1 PASSED! Model [${m}] works! Output: "${res.text?.trim()}"`);
      break;
    } catch (err: any) {
      console.log(`ℹ️ [${m}] note: ${err.message?.substring(0, 120)}...`);
    }
  }

  // Test 2: GeminiLivePool Ephemeral Token Generation
  console.log('\n--- TEST 2: GeminiLivePool Ephemeral Token Generation ---');
  try {
    const tokenResult = await geminiLivePool.generateEphemeralToken(300);
    console.log('✅ TEST 2 PASSED! Live Ephemeral Token Created:');
    console.log(`   Token: ${tokenResult.token}`);
    console.log(`   Key prefix: ${tokenResult.apiKey.substring(0, 12)}...`);
    console.log(`   Expire: ${tokenResult.expireTime}\n`);
  } catch (err: any) {
    console.error('❌ TEST 2 FAILED:', err.message);
  }

  // Test 3: WebSocket Connection to Gemini Live API with Key 5
  console.log('--- TEST 3: Gemini Live WebSocket Handshake & setupComplete ---');
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key5}`;

  await new Promise<void>((resolve) => {
    try {
      const WebSocketImpl = (globalThis as any).WebSocket;
      console.log('Connecting to Gemini Live WebSocket URL...');
      const ws = new WebSocketImpl(wsUrl);

      const timeout = setTimeout(() => {
        console.error('❌ TEST 3 TIMEOUT: No response from Gemini Live WS after 15s');
        try { ws.close(); } catch (_) {}
        resolve();
      }, 15000);

      ws.onopen = () => {
        console.log('🔌 WebSocket connected! Sending setup frame for models/gemini-2.5-flash-native-audio-latest...');
        const setupMsg = {
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-latest',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Kore',
                  },
                },
              },
            },
          },
        };
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = async (event: any) => {
        try {
          let rawStr = '';
          if (typeof event.data === 'string') {
            rawStr = event.data;
          } else if (event.data && typeof event.data.text === 'function') {
            rawStr = await event.data.text();
          } else if (Buffer.isBuffer(event.data)) {
            rawStr = event.data.toString('utf8');
          } else {
            rawStr = String(event.data);
          }

          const data = JSON.parse(rawStr);
          console.log('📩 Received WebSocket message from Gemini Live:', JSON.stringify(data));
          if (data.setupComplete) {
            console.log('\n🎉 ✅ TEST 3 PASSED! Received setupComplete: true!');
            console.log('   Gemini 2.5 Live session successfully established with Key 5!\n');
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            resolve();
          }
        } catch (e: any) {
          console.log('   Error parsing message:', e.message);
        }
      };

      ws.onerror = (err: any) => {
        console.error('❌ TEST 3 WS ERROR:', err?.message || err);
        clearTimeout(timeout);
        resolve();
      };

      ws.onclose = (event: any) => {
        console.log(`🔌 WebSocket closed (code: ${event.code}, reason: ${event.reason || 'normal'})`);
        clearTimeout(timeout);
        resolve();
      };
    } catch (err: any) {
      console.error('❌ TEST 3 Exception:', err.message);
      resolve();
    }
  });

  console.log('====================================================');
  console.log('🏁 KEY 5 VERIFICATION COMPLETED');
  console.log('====================================================');
}

runTests().catch(console.error);
