#!/usr/bin/env npx tsx
/**
 * Test script to verify all 4 NVIDIA API keys work independently.
 * Run with: npx tsx test-nvidia-keys.ts
 *
 * Requires: NVIDIA_API_KEY, NVIDIA_API_KEY_2, NVIDIA_API_KEY_3, NVIDIA_API_KEY_4
 * to be set in environment (Render Dashboard or local .env)
 */

import OpenAI from 'openai';
import { config } from './src/config/index';

const NVIDIA_BASE_URL = config.nvidia.baseUrl || 'https://integrate.api.nvidia.com/v1';

// Test multiple models to find one that works
const MODELS_TO_TEST = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'google/gemma-2-9b-it',
];

interface KeyTestResult {
  keyName: string;
  keyPreview: string;
  success: boolean;
  model?: string;
  response?: string;
  error?: string;
  latencyMs?: number;
}

async function testKeyWithModel(keyName: string, apiKey: string, model: string): Promise<KeyTestResult> {
  const startTime = Date.now();
  const preview = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: NVIDIA_BASE_URL,
      maxRetries: 0,
      timeout: 30_000,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a test assistant. Reply with exactly: OK' },
        { role: 'user', content: 'Test' }
      ],
      max_tokens: 10,
      temperature: 0,
      stream: false,
    });

    const latency = Date.now() - startTime;
    const content = response.choices[0]?.message?.content || '';

    return {
      keyName,
      keyPreview: preview,
      success: true,
      model,
      response: content,
      latencyMs: latency,
    };
  } catch (err: any) {
    const latency = Date.now() - startTime;
    return {
      keyName,
      keyPreview: preview,
      success: false,
      model,
      error: err.message || String(err),
      latencyMs: latency,
    };
  }
}

async function testKey(keyName: string, apiKey: string): Promise<KeyTestResult> {
  for (const model of MODELS_TO_TEST) {
    const result = await testKeyWithModel(keyName, apiKey, model);
    if (result.success) {
      return result;
    }
    // If 403/404, try next model - might be model access issue
    if (result.error?.includes('403') || result.error?.includes('404')) {
      continue;
    }
    // For other errors, return the failure
    return result;
  }
  // All models failed
  return {
    keyName,
    keyPreview: apiKey.slice(0, 8) + '...' + apiKey.slice(-4),
    success: false,
    error: 'All models failed (likely 403/404 on all)',
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     NVIDIA API Key Verification Test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  // Collect all keys from environment
  const keys: { name: string; value: string }[] = [
    { name: 'NVIDIA_API_KEY (Frontal Cortex)', value: config.nvidia.apiKey },
    { name: 'NVIDIA_API_KEY_2 (Hippocampus)', value: config.nvidia.apiKey2 },
    { name: 'NVIDIA_API_KEY_3 (Cerebellum)', value: config.nvidia.apiKey3 },
    { name: 'NVIDIA_API_KEY_4 (Reserve)', value: config.nvidia.apiKey4 },
    { name: 'NVIDIA_API_KEY_5 (Extra Reserve)', value: config.nvidia.apiKey5 || '' },
    { name: 'NVIDIA_API_KEY_6 (Extra Reserve)', value: config.nvidia.apiKey6 || '' },
  ].filter(k => k.value && k.value.trim() !== '' && k.value !== 'dummy_key');

  if (keys.length === 0) {
    console.error('❌ No NVIDIA API keys found in environment!');
    console.log('Set NVIDIA_API_KEY, NVIDIA_API_KEY_2, NVIDIA_API_KEY_3, NVIDIA_API_KEY_4');
    process.exit(1);
  }

  console.log(`Found ${keys.length} key(s) to test:`);
  keys.forEach(k => console.log(`  • ${k.name}: ${k.value.slice(0, 8)}...${k.value.slice(-4)}`));
  console.log();

  console.log('Testing each key independently (trying multiple models)...');
  console.log('─'.repeat(60));

  const results: KeyTestResult[] = [];
  for (const key of keys) {
    process.stdout.write(`Testing ${key.name}... `);
    const result = await testKey(key.name, key.value);
    results.push(result);

    if (result.success) {
      console.log(`✅ OK (${result.latencyMs}ms) [${result.model}] - "${result.response?.slice(0, 50)}"`);
    } else {
      console.log(`❌ FAILED (${result.latencyMs}ms) - ${result.error}`);
    }
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`Total keys tested: ${results.length}`);
  console.log(`✅ Working: ${successCount}`);
  console.log(`❌ Failed:  ${failCount}`);
  console.log();

  if (successCount === 0) {
    console.error('❌ CRITICAL: No working keys! Nova cannot generate replies.');
    console.log('');
    console.log('Possible issues:');
    console.log('  1. API key is invalid or expired');
    console.log('  2. Key doesn\'t have access to NVIDIA NIM models');
    console.log('  3. Key is from wrong NVIDIA account (needs build.nvidia.com access)');
    console.log('  4. Network/firewall blocking requests');
    process.exit(1);
  }

  if (failCount > 0) {
    console.warn('⚠️  Some keys failed. Check Render Dashboard environment variables.');
    console.log('Failed keys:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  • ${r.keyName}: ${r.error}`);
    });
  }

  if (successCount >= 4) {
    console.log('✅ All 4 core keys working! Full brain architecture active.');
  } else if (successCount >= 2) {
    console.log('⚠️  Partial brain architecture. Frontal cortex has ' + successCount + ' key(s).');
  }

  console.log();
  console.log('Next steps:');
  console.log('1. Add missing/working keys to Render Dashboard → Environment');
  console.log('2. Deploy: git push origin main');
  console.log('3. Verify startup log shows: "[BrainKeyRouter] 4 NVIDIA API key(s) available"');
  console.log('4. Test chat end-to-end');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});