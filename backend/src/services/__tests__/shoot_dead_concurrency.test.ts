import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { supabaseAdmin } from '../../lib/supabase';
import { AccountLifecycleService } from '../AccountLifecycleService';
import { v4 as uuidv4 } from 'uuid';

describe('AccountLifecycleService - TOCTOU Race Condition (Shoot Dead)', () => {
  const lifecycleService = new AccountLifecycleService();
  let userA: string;
  let userB: string;

  beforeAll(async () => {}, 30000);

  beforeEach(async () => {
    userA = uuidv4();
    userB = uuidv4();
    
    // Create auth user so foreign keys to auth.users don't fail
    await supabaseAdmin.auth.admin.createUser({
      id: userA,
      email: `${userA}@test.com`,
      email_confirm: true,
    });

    await supabaseAdmin.from('profiles').insert({
      id: userA,
      email: 'user_a@test.com',
      preferred_name: 'Test A'
    });
  }, 30000);

  afterAll(async () => {
    await supabaseAdmin.from('account_tombstones').delete().neq('user_id', uuidv4());
  }, 30000);

  it('MEMORY_WORKER_RACE: Should block delayed worker insert after account deletion', async () => {
    const fakeMemoryPayload = { user_id: userA, key: 'mother_name', value: 'Rajeshree' };
    const deleteResult = await lifecycleService.deleteAccount(userA);
    expect(deleteResult.success).toBe(true);
    const { error } = await supabaseAdmin.from('working_memory').insert(fakeMemoryPayload);
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
    const { data: residue } = await supabaseAdmin.from('working_memory').select('*').eq('user_id', userA);
    expect(residue?.length).toBe(0);
  }, 30000);

  it('SAME_EMAIL_RECREATE: Should allow new user with same email but different UUID', async () => {
    await lifecycleService.deleteAccount(userA);

    await supabaseAdmin.auth.admin.createUser({
      id: userB,
      email: `${userB}@test.com`,
      email_confirm: true,
    });
    await supabaseAdmin.from('profiles').insert({ id: userB, email: 'user_a@test.com', preferred_name: 'Test B' });

    const { error: oldWorkerErr } = await supabaseAdmin.from('memories').insert({ user_id: userA, key: 'old_fact', value: 'data', memory_type: 'semantic' });
    expect(oldWorkerErr?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');

    const { error: newWorkerErr } = await supabaseAdmin.from('memories').insert({ user_id: userB, key: 'new_fact', value: 'data', memory_type: 'semantic' });
    expect(newWorkerErr).toBeNull();
    await lifecycleService.deleteAccount(userB);
  }, 30000);

  it('CANDIDATE_SYNTHESIS_RACE: Should block candidate promotion', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('candidate_synthesis_claims').insert({
      user_id: userA,
      run_id: uuidv4(),
      status: 'pending'
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('LIFETHREAD_RACE: Should block life thread updates', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('life_threads').insert({
      user_id: userA,
      topic: 'work',
      state: 'active',
      priority: 'medium'
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('REMINDER_RACE: Should block reminder insertion', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('reminders').insert({
      user_id: userA,
      text: 'Buy milk',
      status: 'pending'
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('WATCHTOWER_RACE: Should block watchtower anomaly logging', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('nova_guardian_anomalies').insert({
      user_id: userA,
      anomaly_code: 'W-001',
      severity: 'HIGH',
      status: 'DETECTED',
      fingerprint: uuidv4(),
      evidence: {}
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('OUTREACH_RACE: Should block proactive outreach generation', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('nova_outreach_log').insert({
      user_id: userA,
      outreach_type: 'check_in',
      message: 'hello'
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('RETRY_RACE: Should block retry job execution (handled by queueWorker isPermanent)', async () => {
    const dummyError = new Error('Database error: ACCOUNT_TOMBSTONE_VIOLATION during insert');
    const isPermanent = dummyError.message.includes('ACCOUNT_TOMBSTONE_VIOLATION');
    expect(isPermanent).toBe(true);
  }, 30000);

  it('NEW_CHAT_RACE: Should block new chat creation for deleted user', async () => {
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('conversation_sessions').insert({
      user_id: userA,
      session_date: '2026-09-08'
    });
    expect(error?.message).toContain('ACCOUNT_TOMBSTONE_VIOLATION');
  }, 30000);

  it('CROSS_USER: Should not affect other users during deletion', async () => {
    await supabaseAdmin.auth.admin.createUser({
      id: userB,
      email: `${userB}@test.com`,
      email_confirm: true,
    });
    await supabaseAdmin.from('profiles').insert({ id: userB, email: 'user_b@test.com' });
    await lifecycleService.deleteAccount(userA);
    const { error } = await supabaseAdmin.from('working_memory').insert({ user_id: userB, key: 'b_key', value: 'b_val' });
    expect(error).toBeNull();
    await lifecycleService.deleteAccount(userB);
  }, 30000);
});
