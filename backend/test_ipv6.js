const { Client } = require('pg');
const dns = require('dns');
dns.setDefaultResultOrder('ipv6first');

const client = new Client({
  connectionString: 'postgresql://postgres:Bombay%408080635121@db.vhmrryofcdlgmsxvfbfn.supabase.co:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(() => {
  console.log('Connected via IPv6!');
  client.end();
}).catch(e => {
  console.log('Failed:', e.message);
});
