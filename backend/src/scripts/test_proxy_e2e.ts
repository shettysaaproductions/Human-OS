/**
 * test_proxy_e2e.ts — Test the backend WebSocket proxy end-to-end
 *
 * This verifies:
 *   1. Backend /voice/ws WebSocket upgrade succeeds
 *   2. Backend connects to Gemini Live (server-side AQ. key)
 *   3. setupComplete flows through to the mobile client
 *   4. Audio flows through from Gemini to client
 *
 * Run: npx ts-node src/scripts/test_proxy_e2e.ts
 * Requires: TEST_AUTH_TOKEN env var (a valid user JWT)
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');
import 'dotenv/config';

const BACKEND_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://human-os.onrender.com')
  .replace(/\/api$/, '')
  .replace(/\/$/, '');
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

async function testProxy(authToken: string) {
  return new Promise<void>((resolve, reject) => {
    const url = `${WS_URL}/voice/ws?token=${encodeURIComponent(authToken)}&voice=Kore`;
    console.log(`\n[ProxyTest] Connecting to: ${WS_URL}/voice/ws`);
    const ws = new WebSocket(url);

    let setupComplete = false;
    let audioReceived = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout: no response within 40 seconds'));
    }, 40000);

    ws.on('open', () => {
      console.log('[ProxyTest] ✓ WebSocket opened to backend proxy');
    });

    ws.on('message', (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.proxyError) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`Proxy error: ${msg.proxyError.code} — ${msg.proxyError.message}`));
        return;
      }

      if (msg.setupComplete !== undefined) {
        setupComplete = true;
        console.log('[ProxyTest] ✓ setupComplete received — session is live!');

        // Send a text message via clientContent
        console.log('[ProxyTest] Sending text turn...');
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: 'Say hello in one word.' }] }],
            turnComplete: true,
          },
        }));
      }

      if (msg.serverContent) {
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            audioReceived = true;
            const kb = Math.round(part.inlineData.data.length * 0.75 / 1024);
            console.log(`[ProxyTest] ✓ AUDIO RECEIVED through proxy! ~${kb}KB PCM`);
          }
          if (part.text) {
            console.log(`[ProxyTest]   Transcript: "${part.text}"`);
          }
        }

        if (msg.serverContent.turnComplete && audioReceived) {
          clearTimeout(timeout);
          ws.close(1000);
          console.log('\n✅ PROXY E2E COMPLETE — voice works through backend proxy!\n');
          resolve();
        }
      }
    });

    ws.on('error', (e: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${e.message}`));
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (!audioReceived || !setupComplete) {
        clearTimeout(timeout);
        if (code !== 1000) {
          reject(new Error(`WS closed (${code}): ${reason}`));
        }
      }
    });
  });
}

(async () => {
  console.log('='.repeat(60));
  console.log('Nova Voice Backend Proxy E2E Test');
  console.log('='.repeat(60));

  const token = process.env.TEST_AUTH_TOKEN;
  if (!token) {
    console.log('\n❌ TEST_AUTH_TOKEN not set. Cannot test proxy (auth required).');
    console.log('Set it to a valid Supabase JWT for a user in your database.');
    process.exit(1);
  }

  try {
    await testProxy(token);
    console.log('='.repeat(60));
    console.log('✅ ALL PASSED — Deploy and test on mobile!');
    console.log('='.repeat(60));
  } catch (e: any) {
    console.error('\n❌ PROXY TEST FAILED:', e.message);
    process.exit(1);
  }
})();
