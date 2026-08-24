const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.vhmrryofcdlgmsxvfbfn:Bombay%408080635121@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(() => {
  console.log('Connected');
  client.end();
}).catch(e => {
  console.log('Failed:', e.message);
});
