import 'dotenv/config';
import WebSocket from 'ws';
import { geminiLivePool } from '../lib/geminiLivePool';

function pcmToWav(pcmData: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

async function synthesizeSpeech(text: string, voiceName = 'Kore'): Promise<{ wavBase64: string; duration: number }> {
  return new Promise((resolve, reject) => {
    let key = '';
    try {
      key = geminiLivePool.getDirectKey();
    } catch {
      key = process.env.GEMINI_API_KEY_5 || process.env.GEMINI_API_KEY || '';
    }
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
    const ws = new WebSocket(wsUrl);

    const pcmChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Voice synthesis timed out'));
    }, 8000);

    ws.on('open', () => {
      console.log('[TestSynthesis] Connected to Gemini Live');
      const setupFrame = {
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-latest',
          systemInstruction: {
            parts: [
              {
                text: 'You are Nova. Speak the exact provided response directly in natural, warm spoken dialogue. Do not add commentary.',
              },
            ],
          },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        },
      };
      ws.send(JSON.stringify(setupFrame));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.setupComplete !== undefined) {
          console.log('[TestSynthesis] Setup complete. Sending user turn...');
          ws.send(
            JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: 'user',
                    parts: [{ text }],
                  },
                ],
                turnComplete: true,
              },
            })
          );
        }

        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData?.data) {
              const buf = Buffer.from(part.inlineData.data, 'base64');
              pcmChunks.push(buf);
            }
          }
        }

        if (msg.serverContent?.turnComplete) {
          clearTimeout(timeout);
          ws.close();
          const totalPcm = Buffer.concat(pcmChunks);
          console.log(`[TestSynthesis] Turn complete! Received ${pcmChunks.length} audio chunks (${totalPcm.length} bytes PCM)`);
          const wav = pcmToWav(totalPcm, 24000);
          const duration = Math.round((totalPcm.length / (24000 * 2)) * 10) / 10;
          resolve({ wavBase64: wav.toString('base64'), duration });
        }
      } catch (err) {
        // ignore parse error
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function run() {
  console.log('Testing speech synthesis for: "Haan bol yaar, maine tera reminder set kar diya hai!"');
  const result = await synthesizeSpeech('Haan bol yaar, maine tera reminder set kar diya hai!', 'Kore');
  console.log(`✅ Success! Duration: ${result.duration}s, WAV Base64 length: ${result.wavBase64.length}`);
}

run().catch(console.error);
