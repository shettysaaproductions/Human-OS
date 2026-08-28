const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const raw = JSON.parse(fs.readFileSync('scripts/forensic_snapshot_raw.json', 'utf8'));

const { cognitiveContextService } = require('../dist/services/CognitiveContextService');

async function runReport() {
  const userId = raw.user_id;

  // Re-fetch working memory specifically to inspect any rows
  const { data: wmRows } = await supabase.from('working_memory').select('*').eq('user_id', userId);
  const { data: allWm } = await supabase.from('working_memory').select('*');
  console.log('User WM rows count:', wmRows?.length);
  console.log('Total WM in DB count:', allWm?.length);

  // Call CognitiveContextService in read-only mode
  let cogCtx = null;
  try {
    cogCtx = await cognitiveContextService.assembleContext(userId, {
      message: 'Kaise ho Nova?',
      messages: [{ message: 'Kaise ho Nova?' }],
      conversationId: raw.chatHistory?.[raw.chatHistory.length - 1]?.conversation_id || 'test_conv',
      isProactive: false,
      skipMemory: false
    });
    console.log('CognitiveContextService assembled successfully.');
  } catch (err) {
    console.error('CognitiveContext assembly error:', err);
  }

  const reportData = {
    ...raw,
    working_memory: wmRows || [],
    all_system_wm: allWm || [],
    cognitive_context: cogCtx
  };

  fs.writeFileSync('scripts/forensic_snapshot_full.json', JSON.stringify(reportData, null, 2));
  console.log('Full forensic report data saved to scripts/forensic_snapshot_full.json');
}

runReport().catch(console.error);
