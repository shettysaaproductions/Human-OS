const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://infkwyzomszyxtctewds.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZmt3eXpvbXN6eXh0Y3Rld2RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NjY5ODUsImV4cCI6MjA5ODA0Mjk4NX0.St8FKy28EnxG3DdCnbNxnK1RW3hsByd_C9ZyXDMsagk');

async function test() {
  const { data, error } = await supabase.auth.signUp({ email: 'test3@humanos.app', password: 'password123' });
  console.log(JSON.stringify({data, error}, null, 2));
}
test();
