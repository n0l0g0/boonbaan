const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'mikrotik',
  user: process.env.POSTGRES_USER || 'mikrotik',
  password: process.env.POSTGRES_PASS || 'mikrotik',
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
