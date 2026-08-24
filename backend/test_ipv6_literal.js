const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:Bombay%408080635121@[2406:da12:557:f800:b37e:b9c1:6885:3266]:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(() => {
  console.log('Connected via IPv6 literal!');
  client.end();
}).catch(e => {
  console.log('Failed:', e.message);
});
