import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const envs = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  RENDER_API_KEY: process.env.RENDER_API_KEY || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  PORT: process.env.PORT || '3000'
};

const REQUIRED_TABLES = [
  'profiles', 'chat_history', 'memories', 'working_memory', 'episodic_memories', 
  'kg_nodes', 'kg_edges', 'emotional_states', 'background_jobs', 'processed_jobs', 'failed_jobs',
  'llm_providers', 'app_settings'
];

async function runDoctor() {
  console.log('==================================================');
  console.log('          HUMAN OS DEVELOPMENT WORKSTATION        ');
  console.log('                   DOCTOR REPORT                  ');
  console.log('==================================================\n');

  const report: Record<string, { status: 'OK' | 'FAILED' | 'WARNING' | 'SKIPPED'; message: string }> = {};

  // 1. Check Environment Variables
  const missingEnv = Object.entries(envs)
    .filter(([k, v]) => !v && k !== 'RENDER_API_KEY' && k !== 'GITHUB_TOKEN')
    .map(([k]) => k);
    
  if (missingEnv.length > 0) {
    report['Environment Variables'] = {
      status: 'FAILED',
      message: `Missing required env vars: ${missingEnv.join(', ')}`
    };
  } else {
    report['Environment Variables'] = {
      status: 'OK',
      message: 'All core configuration variables are set.'
    };
  }

  // 2. Check Database Connectivity & Schema
  if (envs.DATABASE_URL) {
    const client = new Client({
      connectionString: envs.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    try {
      const start = Date.now();
      await client.connect();
      const latency = Date.now() - start;

      // Check missing tables
      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      const existingTables = tablesRes.rows.map(r => r.table_name);
      const missingTables = REQUIRED_TABLES.filter(t => !existingTables.includes(t));

      // Check indexes
      const indexesRes = await client.query(`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
      `);
      const existingIndexes = indexesRes.rows.map(r => r.indexname);
      
      const expectedIndexes = ['idx_memories_user_id', 'idx_chat_history_user_id'];
      const missingIndexes = expectedIndexes.filter(idx => !existingIndexes.includes(idx));

      let dbMsg = `Connected successfully (${latency}ms).`;
      let dbStatus: 'OK' | 'WARNING' = 'OK';

      if (missingTables.length > 0) {
        dbMsg += ` Missing tables: ${missingTables.join(', ')}.`;
        dbStatus = 'WARNING';
      }
      if (missingIndexes.length > 0) {
        dbMsg += ` Missing indexes: ${missingIndexes.join(', ')}.`;
        dbStatus = 'WARNING';
      }

      report['Database Connection & Schema'] = {
        status: dbStatus,
        message: dbMsg
      };

      await client.end();
    } catch (err: any) {
      report['Database Connection & Schema'] = {
        status: 'FAILED',
        message: `Connection failed: ${err.message}`
      };
    }
  } else {
    report['Database Connection & Schema'] = {
      status: 'SKIPPED',
      message: 'DATABASE_URL is not set.'
    };
  }

  // 3. Supabase REST API check
  if (envs.SUPABASE_URL && envs.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const start = Date.now();
      const res = await fetch(`${envs.SUPABASE_URL}/rest/v1/`, {
        headers: { apikey: envs.SUPABASE_SERVICE_ROLE_KEY }
      });
      const latency = Date.now() - start;

      if (res.ok) {
        report['Supabase REST API'] = {
          status: 'OK',
          message: `Endpoint active & accessible (${latency}ms).`
        };
      } else {
        report['Supabase REST API'] = {
          status: 'FAILED',
          message: `Returned HTTP status ${res.status}: ${res.statusText}`
        };
      }
    } catch (err: any) {
      report['Supabase REST API'] = {
        status: 'FAILED',
        message: `Request failed: ${err.message}`
      };
    }
  } else {
    report['Supabase REST API'] = {
      status: 'SKIPPED',
      message: 'Supabase URL or Key missing.'
    };
  }

  // 4. API Local Port Health Check
  try {
    const res = await fetch(`http://localhost:${envs.PORT}/health`);
    if (res.ok) {
      report['Local Express API'] = {
        status: 'OK',
        message: `Local server running and responsive on port ${envs.PORT}.`
      };
    } else {
      report['Local Express API'] = {
        status: 'WARNING',
        message: `Server returned status ${res.status} on port ${envs.PORT}.`
      };
    }
  } catch (err: any) {
    report['Local Express API'] = {
      status: 'WARNING',
      message: `Offline (Cannot connect to localhost:${envs.PORT}). Start it with 'npm run dev'.`
    };
  }

  // 5. GitHub access (optional)
  if (envs.GITHUB_TOKEN) {
    try {
      const res = await fetch('https://api.github.com/rate_limit', {
        headers: {
          'Authorization': `Bearer ${envs.GITHUB_TOKEN}`,
          'User-Agent': 'Human-OS-Doctor'
        }
      });
      if (res.ok) {
        report['GitHub Integration'] = {
          status: 'OK',
          message: 'Token valid. Accessible.'
        };
      } else {
        report['GitHub Integration'] = {
          status: 'FAILED',
          message: `Token invalid or API rate-limited (HTTP ${res.status}).`
        };
      }
    } catch (err: any) {
      report['GitHub Integration'] = {
        status: 'FAILED',
        message: `Connection failed: ${err.message}`
      };
    }
  } else {
    report['GitHub Integration'] = {
      status: 'SKIPPED',
      message: 'GITHUB_TOKEN not provided.'
    };
  }

  // 6. Render API check (optional)
  if (envs.RENDER_API_KEY) {
    try {
      const res = await fetch('https://api.render.com/v1/services', {
        headers: {
          'Authorization': `Bearer ${envs.RENDER_API_KEY}`
        }
      });
      if (res.ok) {
        report['Render API Integration'] = {
          status: 'OK',
          message: 'API Key is authenticated and active.'
        };
      } else {
        report['Render API Integration'] = {
          status: 'FAILED',
          message: `Key rejected by Render (HTTP ${res.status}).`
        };
      }
    } catch (err: any) {
      report['Render API Integration'] = {
        status: 'FAILED',
        message: `Connection failed: ${err.message}`
      };
    }
  } else {
    report['Render API Integration'] = {
      status: 'SKIPPED',
      message: 'RENDER_API_KEY not provided.'
    };
  }

  // Output formatting
  console.log('--- DIAGNOSTIC RESULTS ---');
  let hasFailure = false;
  for (const [component, data] of Object.entries(report)) {
    const symbol = data.status === 'OK' ? '✅' : data.status === 'WARNING' ? '⚠️' : data.status === 'SKIPPED' ? '⚪' : '❌';
    console.log(`${symbol} [${data.status}] ${component}: ${data.message}`);
    if (data.status === 'FAILED') hasFailure = true;
  }
  console.log('\n==================================================');

  if (hasFailure) {
    console.log('❌ SYSTEM HEALTH: DEGRADED / UNHEALTHY');
    process.exit(1);
  } else {
    console.log('✅ SYSTEM HEALTH: READY / EXCELLENT');
    process.exit(0);
  }
}

runDoctor();
