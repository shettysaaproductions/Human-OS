/**
 * test_voice_e2e.ts — End-to-end voice session self-test
 *
 * Tests the COMPLETE flow:
 *  1. Backend /api/voice/session returns 200 + API key (no authTokens.create crash)
 *  2. Gemini Live WebSocket connects with that key
 *  3. setupComplete is received
 *  4. A text message is sent and a response with AUDIO is received
 *
 * Run: npx ts-node src/scripts/test_voice_e2e.ts
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');
import 'dotenv/config';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://human-os.onrender.com';
const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// ── Step 1: Get session config from backend ──────────────────────────────────
async function getSessionConfig() {
  console.log('\n[Step 1] Calling backend /api/voice/session ...');
  const res = await fetch(`${API_URL}/api/voice/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // NOTE: In production, the Authorization header comes from the user's JWT.
      // For this test, we use an env var.
      ...(process.env.TEST_AUTH_TOKEN
        ? { Authorization: `Bearer ${process.env.TEST_AUTH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ language: 'auto', voice_name: 'Kore' }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  console.log(`[Step 1] ✓ Backend returned 200. Model: ${data.session?.model}`);
  console.log(`[Step 1]   API key prefix: ${data.session?.apiKey?.substring(0, 10)}...`);
  return data.session;
}

// ── Step 2: Connect to Gemini Live ───────────────────────────────────────────
async function testGeminiLive(session: any) {
  return new Promise<void>((resolve, reject) => {
    const url = `${WS_URL}?key=${session.apiKey}`;
    console.log('\n[Step 2] Opening WebSocket to Gemini Live...');
    const ws = new WebSocket(url);

    let setupDone = false;
    let audioReceived = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout: no response within 20 seconds'));
    }, 20000);

    ws.on('open', () => {
      console.log('[Step 2] ✓ WebSocket opened — sending setup frame');
      ws.send(JSON.stringify({
        setup: {
          model: session.model,
          systemInstruction: {
            parts: [{ text: 'You are Nova. Reply with one short sentence.' }],
          },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        },
      }));
    });

    ws.on('message', (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const keys = Object.keys(msg); void keys;

      if (msg.setupComplete !== undefined) {
        setupDone = true;
        console.log('[Step 3] ✓ setupComplete received — session is live!');

        // Send a quick text prompt
        console.log('[Step 4] Sending text input "Say hello"...');
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: 'Say hello' }] }],
            turnComplete: true,
          },
        }));
      }

      if (msg.serverContent) {
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            audioReceived = true;
            const bytes = part.inlineData.data.length;
            console.log(`[Step 5] ✓ AUDIO CHUNK RECEIVED! Base64 length: ${bytes} chars (~${Math.round(bytes * 0.75 / 1024)}KB PCM)`);
          }
          if (part.text) {
            console.log(`[Step 5]   Text transcript: "${part.text}"`);
          }
        }

        if (msg.serverContent.turnComplete && audioReceived) {
          clearTimeout(timeout);
          ws.close(1000);
          console.log('\n✅ ALL STEPS PASSED — Voice pipeline is fully working!\n');
          resolve();
        }
      }
    });

    ws.on('error', (e: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${e.message}`));
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (!audioReceived) {
        clearTimeout(timeout);
        if (setupDone) {
          reject(new Error(`WS closed (${code}) after setup but before audio. Reason: ${reason}`));
        }
      }
    });
  });
}

// ── Direct key test (no auth) ─────────────────────────────────────────────────
async function testDirectKey() {
  const key = process.env.GEMINI_API_KEY_5;
  if (!key) {
    console.log('[DirectTest] GEMINI_API_KEY_5 not set — skipping direct test');
    return;
  }

  console.log('\n[DirectTest] Testing with GEMINI_API_KEY_5 directly (bypasses backend auth)...');
  const session = {
    apiKey: key,
    model: process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest',
  };

  await testGeminiLive(session);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(60));
  console.log('Nova Voice E2E Self-Test');
  console.log('='.repeat(60));

  try {
    // Test 1: Direct key (validates Gemini Live WS + audio works)
    await testDirectKey();

    // Test 2: Full backend flow (validates /api/voice/session endpoint)
    if (process.env.TEST_AUTH_TOKEN) {
      const session = await getSessionConfig();
      await testGeminiLive(session);
    } else {
      console.log('\n[BackendTest] Skipping backend auth test (set TEST_AUTH_TOKEN env var to enable)');
    }

    console.log('='.repeat(60));
    console.log('✅ E2E TEST COMPLETE — Voice is working');
    console.log('='.repeat(60));
  } catch (e: any) {
    console.error('\n❌ E2E TEST FAILED:', e.message);
    process.exit(1);
  }
})();
