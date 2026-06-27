import { config } from 'dotenv';
config({ path: '.env' });
import { milestoneAgent } from '../src/agents/MilestoneAgent';
import { supabaseAdmin } from '../src/lib/supabase';
import crypto from 'crypto';

jest.mock('../src/lib/nvidia', () => ({
  chatCompletion: jest.fn().mockResolvedValue(JSON.stringify({
    milestone_memories: [
      {
        shouldPersist: true,
        type: 'child',
        key: 'child_name',
        value: 'Shreshth',
        importance: 100,
        confidence: 1.0,
        emotional_weight: 10
      },
      {
        shouldPersist: true,
        type: 'child',
        key: 'child_dob',
        value: '2026-02-17',
        importance: 100,
        confidence: 1.0,
        emotional_weight: 10
      }
    ]
  }))
}));

describe('Milestone Memory Extraction', () => {
  const testUserId = crypto.randomUUID();

  beforeAll(async () => {
    // create dummy user for test
    await supabaseAdmin.from('profiles').insert({
      id: testUserId,
      email: `test_${testUserId}@example.com`,
      preferred_name: 'TestUser'
    });
  });

  afterAll(async () => {
    // cleanup
    await supabaseAdmin.from('memories').delete().eq('user_id', testUserId);
    await supabaseAdmin.from('profiles').delete().eq('id', testUserId);
  });

  it('should extract child birth milestone and retrieve it successfully via RPC', async () => {
    const inputMessage = "I was blessed with a baby boy on 17 Feb 2026 and we named him Shreshth.";
    const messageId = crypto.randomUUID();

    // 1. Run extraction
    await milestoneAgent.processJob({
      id: 'job-123',
      job_type: 'extract_milestone',
      attempts: 0,
      status: 'running',
      created_at: new Date(),
      payload: {
        userId: testUserId,
        messageId,
        message: inputMessage
      }
    } as any);

    // 2. Fetch directly to verify fields
    const { data: memories } = await supabaseAdmin.from('memories').select('*').eq('user_id', testUserId);
    expect(memories?.length).toBeGreaterThan(0);

    // Find the child_name memory
    const childNameMem = memories?.find(m => m.key.includes('child_name') || m.key.includes('shreshth') || m.value.includes('Shreshth'));
    expect(childNameMem).toBeDefined();
    expect(childNameMem?.importance).toBe(100);
    expect(Number(childNameMem?.confidence)).toBe(1.0);
    expect(childNameMem?.memory_type).toMatch(/child|family/);
    expect(childNameMem?.emotional_weight).toBe(10);

    // 3. Test Retrieval via RPC (diagnostics simulation)
    const { data: searchResults, error } = await supabaseAdmin.rpc('search_relevant_memories', {
      p_user_id: testUserId,
      p_query: "What is my son's name?",
      p_limit: 5
    });

    expect(error).toBeNull();
    expect(searchResults?.length).toBeGreaterThan(0);
    
    const retrievedName = searchResults?.find((m: any) => m.id === childNameMem?.id);
    expect(retrievedName).toBeDefined();
    
    // Check components
    expect(Number(retrievedName?.score_importance)).toBe(0.25); // 100 * 0.25
    expect(Number(retrievedName?.score_confidence)).toBe(0.10); // 1.0 * 0.10
    expect(Number(retrievedName?.score_emotion)).toBe(0.10); // 10 * 0.10
    // type weight for child/family should be 0.9 or 1.0, so score_type is 0.09 or 0.10
    expect(Number(retrievedName?.score_type)).toBeGreaterThanOrEqual(0.09);
  }, 30000); // 30s timeout for LLM
});
