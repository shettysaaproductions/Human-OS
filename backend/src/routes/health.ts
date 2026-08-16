import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../lib/logger';

export const healthRouter = Router();

interface KeyTestResult {
  name: string;
  present: boolean;
  tests: {
    '8b': { success: boolean; latencyMs?: number; error?: string };
    '70b': { success: boolean; latencyMs?: number; error?: string };
  };
}

interface HealthResponse {
  timestamp: string;
  keys: KeyTestResult[];
  summary: {
    total: number;
    working8b: number;
    working70b: number;
    anyWorking: boolean;
  };
}

const MODELS_TO_TEST = [
  { key: '8b', model: 'meta/llama-3.1-8b-instruct' },
  { key: '70b', model: 'meta/llama-3.1-70b-instruct' },
];

const NVIDIA_BASE_URL = config.nvidia.baseUrl || 'https://integrate.api.nvidia.com/v1';
const TEST_TIMEOUT_MS = 15_000;

async function testKeyWithModel(apiKey: string, model: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  const startTime = Date.now();
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: NVIDIA_BASE_URL,
      maxRetries: 0,
      timeout: TEST_TIMEOUT_MS,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Reply with OK' },
        { role: 'user', content: 'Test' }
      ],
      max_tokens: 5,
      temperature: 0,
      stream: false,
    });

    const latency = Date.now() - startTime;
    // Just verify we got a response
    if (!response.choices[0]?.message) {
      return { success: false, latencyMs: latency, error: 'Empty response' };
    }

    return { success: true, latencyMs: latency };
  } catch (err: any) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      latencyMs: latency,
      error: err.message || String(err)
    };
  }
}

async function testKey(keyName: string, apiKey: string): Promise<KeyTestResult> {
  const result: KeyTestResult = {
    name: keyName,
    present: !!apiKey && apiKey.trim() !== '' && apiKey !== 'dummy_key',
    tests: {
      '8b': { success: false, error: 'Not tested' },
      '70b': { success: false, error: 'Not tested' },
    },
  };

  if (!result.present) {
    return result;
  }

  // Test both models in parallel
  const [test8b, test70b] = await Promise.all([
    testKeyWithModel(apiKey, MODELS_TO_TEST[0].model),
    testKeyWithModel(apiKey, MODELS_TO_TEST[1].model),
  ]);

  result.tests['8b'] = test8b;
  result.tests['70b'] = test70b;

  return result;
}

healthRouter.get('/keys', async (_req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  // Collect all keys from environment
  const keysToTest = [
    { name: 'NVIDIA_API_KEY (Frontal Cortex)', value: config.nvidia.apiKey },
    { name: 'NVIDIA_API_KEY_2 (Hippocampus)', value: config.nvidia.apiKey2 },
    { name: 'NVIDIA_API_KEY_3 (Cerebellum)', value: config.nvidia.apiKey3 },
    { name: 'NVIDIA_API_KEY_4 (Reserve)', value: config.nvidia.apiKey4 },
    { name: 'NVIDIA_API_KEY_5 (Extra Reserve)', value: (config.nvidia as any).apiKey5 || '' },
    { name: 'NVIDIA_API_KEY_6 (Extra Reserve)', value: (config.nvidia as any).apiKey6 || '' },
  ].filter(k => k.value && k.value.trim() !== '' && k.value !== 'dummy_key');

  if (keysToTest.length === 0) {
    res.status(503).json({
      timestamp: new Date().toISOString(),
      keys: [],
      summary: { total: 0, working8b: 0, working70b: 0, anyWorking: false },
      error: 'No NVIDIA API keys configured',
    });
    return;
  }

  logger.info('[Health] Starting NVIDIA key health check', { keyCount: keysToTest.length });

  // Test all keys in parallel
  const results = await Promise.all(
    keysToTest.map(k => testKey(k.name, k.value))
  );

  const working8b = results.filter(r => r.tests['8b'].success).length;
  const working70b = results.filter(r => r.tests['70b'].success).length;
  const anyWorking = working8b > 0 || working70b > 0;

  const response: HealthResponse = {
    timestamp: new Date().toISOString(),
    keys: results,
    summary: {
      total: keysToTest.length,
      working8b,
      working70b,
      anyWorking,
    },
  };

  const totalTime = Date.now() - startTime;
  logger.info('[Health] NVIDIA key health check complete', {
    totalTimeMs: totalTime,
    summary: response.summary
  });

  if (anyWorking) {
    res.status(200).json(response);
  } else {
    res.status(503).json(response);
  }
});

// Also add a simple liveness check
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Readiness check - verifies DB and keys
healthRouter.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { supabaseAdmin } = await import('../lib/supabase');

    // Quick DB ping
    await supabaseAdmin.from('profiles').select('id').limit(1);

    // Quick key check - just verify at least one key is present
    const hasKeys = !!config.nvidia.apiKey;

    if (hasKeys) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: { database: true, nvidiaKeys: true }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: { database: true, nvidiaKeys: false },
        error: 'No NVIDIA API keys configured'
      });
    }
  } catch (err: any) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: { database: false, nvidiaKeys: false },
      error: err.message
    });
  }
});