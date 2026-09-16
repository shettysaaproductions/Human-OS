import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

async function main() {
  const key = process.env.GEMINI_API_KEY_5 || process.env.GEMINI_API_KEY || '';
  const ai = new GoogleGenAI({ apiKey: key });

  for (const modelName of [
    'gemini-2.5-flash-native-audio-latest',
    'gemini-2.0-flash-exp',
    'gemini-flash-latest',
  ]) {
    try {
      console.log(`Testing model: ${modelName}`);
      const res = await ai.models.generateContent({
        model: modelName,
        contents: 'Say in Hindi warmly: Haan bol yaar, sab theek hai!',
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

      const parts = res.candidates?.[0]?.content?.parts || [];
      console.log(`✅ [${modelName}] Success! Parts:`, parts.length);
      for (const p of parts) {
        if (p.inlineData) {
          console.log(`   Audio inlineData: ${p.inlineData.mimeType}, size: ${p.inlineData.data?.length}`);
        }
      }
      break;
    } catch (err: any) {
      console.log(`❌ [${modelName}] error:`, err.message?.substring(0, 150));
    }
  }
}

main().catch(console.error);
