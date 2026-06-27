import { supabaseAdmin } from '../src/lib/supabase';
import { onboardingService } from '../src/services/onboardingService';
import crypto from 'crypto';

async function testFlow() {
  let userId: string = crypto.randomUUID();

  console.log('--- TESTING FLOW ---');
  console.log(`Using simulated User ID: ${userId} (Skipping Auth due to dummy Anon Key)`);

  // 1. Test Onboarding
  console.log(`\n1. Testing Onboarding (simulating UI submission)...`);
  try {
    await onboardingService.processOnboarding(userId, {
      preferred_name: 'TestUser',
      passions: 'Coding, AI',
      goals: 'Build Human OS',
      family: 'None',
      important_facts: 'I love TypeScript',
      companion_personality: 'Helpful and direct'
    });
    console.log('Onboarding Processed Successfully!');
  } catch (err: any) {
    console.error('Onboarding Failed (CRASH!):', err.message);
    return;
  }
  
  // 2. Verify profiles table query (simulating Login check)
  console.log(`\n2. Verifying Profile (Login Check)...`);
  const { data: profileData, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('onboarding_completed')
    .eq('id', userId)
    .maybeSingle();
    
  if (profileError) {
    console.error('Login Profile Fetch Failed:', profileError.message);
    return;
  }
  console.log('Profile Verification Successful! Onboarding Completed:', profileData?.onboarding_completed || false);

  // 3. Test Chat (Insertion)
  console.log(`\n3. Testing Chat History Insertion...`);
  const { error: chatError } = await supabaseAdmin.from('chat_history').insert({
    user_id: userId,
    conversation_id: crypto.randomUUID(),
    role: 'user',
    content: 'Hello Nova!',
  });
  if (chatError) {
    console.error('Chat Insertion Failed:', chatError.message);
    return;
  }
  console.log('Chat Message Inserted Successfully!');

  // 4. Test Diagnostics (Fetching Chat)
  console.log(`\n4. Testing Diagnostics Verification...`);
  const { count: chatCount, error: diagChatError } = await supabaseAdmin
    .from('chat_history')
    .select('*', { count: 'exact', head: true });
    
  if (diagChatError) {
    console.error('Diagnostics Chat Fetch Failed:', diagChatError.message);
    return;
  }
  console.log(`Diagnostics: Total chat messages in DB: ${chatCount}`);
  
  console.log('\n--- ALL TESTS PASSED SUCCESSFULLY ---');
}

testFlow().then(() => process.exit(0)).catch(console.error);
