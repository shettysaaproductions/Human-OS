import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = 'http://localhost:3000/api';
const TEST_EMAIL = 'admin@recrutos.com';
const TEST_PASSWORD = 'TestPassword123!';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify() {
  console.log('=== COGNITIVE SAFETY VERIFICATION (EXISTING ACCOUNT) ===');

  const { data: users, error: err1 } = await supabaseAdmin.auth.admin.listUsers();
  if (err1) throw new Error(err1.message);
  
  const adminUser = users?.users.find(u => u.email === TEST_EMAIL);
  if (!adminUser) {
    throw new Error('admin@recrutos.com not found');
  }
  const userId = adminUser.id;
  console.log(`Found target user ID: ${userId}`);

  // 1. Reset password so we can get a JWT
  console.log('Resetting password to obtain JWT...');
  await supabaseAdmin.auth.admin.updateUserById(userId, { password: TEST_PASSWORD });

  // 2. Sign in to get JWT
  const loginRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY || '' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const loginBody: any = await loginRes.json();
  if (!loginRes.ok || !loginBody.access_token) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  const token = loginBody.access_token;
  console.log('✅ Signed in (Got JWT)');

  const sendChat = async (message: string) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
    const elapsed = (Date.now() - t0) / 1000;
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`chat failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    }
    console.log(`  → reply in ${elapsed.toFixed(1)}s: ${String(body.reply || '(no reply)').slice(0, 150).replace(/\n/g, ' ')}`);
    return body;
  };

  // Test 1: Explicit Memory
  console.log('\n--- Test 1: Explicit Memory ---');
  console.log('Sending: "Remember this: my favourite dessert is rasmalai."');
  await sendChat('Remember this: my favourite dessert is rasmalai.');

  console.log('Waiting 15 seconds for extraction pipelines...');
  await sleep(15000);

  const { data: mem1 } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('All Durable Memories after Test 1:');
  console.dir(mem1, { depth: null });
  
  const { data: agenda1 } = await supabaseAdmin
    .from('nova_agenda')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  console.log('Agenda Items:');
  console.dir(agenda1, { depth: null });

  // Test 2: Correction
  console.log('\n--- Test 2: Explicit Correction ---');
  console.log('Sending: "Actually, correct that — my favourite dessert is gulab jamun."');

  await sendChat('Actually, correct that — my favourite dessert is gulab jamun.');

  console.log('Waiting 15 seconds for extraction pipelines...');
  await sleep(15000);

  const { data: mem2 } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
    
  console.log('All Durable Memories after Test 2:');
  console.dir(mem2, { depth: null });
  
  const { data: agenda2 } = await supabaseAdmin
    .from('nova_agenda')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  console.log('Agenda Items after Test 2:');
  console.dir(agenda2, { depth: null });
  
  console.log('=== VERIFICATION COMPLETE ===');
  process.exit(0);
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});
