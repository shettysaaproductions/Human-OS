import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const key = process.env.GEMINI_API_KEY || '';
  console.log('Using key prefix:', key.substring(0, 10));

  const client = new GoogleGenerativeAI(key);
  const model = client.getGenerativeModel({ model: 'gemini-flash-latest' });

  // Create a 1-second 16kHz WAV file base64
  const numSamples = 16000;
  const wav = new Uint8Array(44 + numSamples * 2);
  const v = new DataView(wav.buffer);
  v.setUint32(0,  0x52494646, false); // "RIFF"
  v.setUint32(4,  36 + numSamples * 2, true);
  v.setUint32(8,  0x57415645, false); // "WAVE"
  v.setUint32(12, 0x666d7420, false); // "fmt "
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 16000, true); // sampleRate
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461, false); // "data"
  v.setUint32(40, numSamples * 2, true);

  const b64 = Buffer.from(wav).toString('base64');

  try {
    const result = await model.generateContent([
      {
        text: 'Transcribe this audio verbatim. If silent or no speech is detected, output "[silence]". Output ONLY the transcription.',
      },
      {
        inlineData: {
          data: b64,
          mimeType: 'audio/wav',
        },
      },
    ]);

    console.log('✅ Transcription output:', result.response.text().trim());
  } catch (err: any) {
    console.error('❌ Transcription error:', err.message);
  }
}

main().catch(console.error);
