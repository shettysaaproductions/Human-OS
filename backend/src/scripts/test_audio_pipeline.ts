import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { geminiLivePool } from '../lib/geminiLivePool';

async function main() {
  const key = geminiLivePool.getDirectKey();
  console.log('Using key prefix:', key.substring(0, 10));

  const ai = new GoogleGenAI({ apiKey: key });

  // Test 1: Can we generate speech/audio using gemini-2.5-flash or native audio?
  console.log('Testing audio generation with gemini-2.5-flash...');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Say in Hindi warmly: Arre sun, main bilkul theek hoon! Tu bata kaisa hai?',
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Kore',
            },
          },
        },
      },
    });

    console.log('Response candidates:', response.candidates?.length);
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    console.log('Parts count:', parts.length);
    for (const p of parts) {
      if (p.text) console.log('Text part:', p.text);
      if (p.inlineData) {
        console.log('InlineData mimeType:', p.inlineData.mimeType, 'data length:', p.inlineData.data?.length);
      }
    }
  } catch (err: any) {
    console.error('Audio generation test error:', err.message);
  }
}

main().catch(console.error);
