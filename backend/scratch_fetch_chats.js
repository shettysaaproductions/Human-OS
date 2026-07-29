const { createClient } = require('@supabase/supabase-js');
const s = createClient(
  'https://vhmrryofcdlgmsxvfbfn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobXJyeW9mY2RsZ21zeHZmYmZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjU1MzQ1NCwiZXhwIjoyMDk4MTI5NDU0fQ.X3nOLNz758w2IlgVxbIs60Xy42A-dnX4Vk0ORfsYfi8'
);

(async () => {
  // Fetch existing behavioral patches
  const { data: patches } = await s.from('nova_behavioral_patches').select('*').eq('is_active', true);
  console.log('=== ACTIVE BEHAVIORAL PATCHES ===');
  console.log(JSON.stringify(patches, null, 2));
  
  // Check nova_agenda 
  const { data: agenda } = await s.from('nova_agenda').select('*').in('status', ['pending', 'active']).limit(10);
  console.log('\n=== PENDING AGENDA ITEMS ===');
  console.log(JSON.stringify(agenda, null, 2));
  
  // Check working_memory
  const { data: wm } = await s.from('working_memory').select('*').limit(20);
  console.log('\n=== WORKING MEMORY ===');
  console.log(JSON.stringify(wm, null, 2));
  
  // Check long-term memories
  const { data: mem } = await s.from('memories').select('key, value, memory_type').eq('is_archived', false).limit(30);
  console.log('\n=== LONG TERM MEMORIES ===');
  console.log(JSON.stringify(mem, null, 2));
})();
