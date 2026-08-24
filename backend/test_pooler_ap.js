const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.vhmrryofcdlgmsxvfbfn:Bombay%408080635121@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
client.connect().then(() => {
  console.log('Connected via ap-south-1 Pooler!');
  client.end();
}).catch(e => {
  console.log('Failed:', e.message);
});
