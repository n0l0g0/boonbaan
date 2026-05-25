const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });

// Read from DB settings, fall back to env vars
async function getMikrotikConfig() {
  try {
    const { query } = require('./db');
    const r = await query(`SELECT key, value FROM settings WHERE key IN ('mikrotik_host','mikrotik_port','mikrotik_user','mikrotik_pass','mikrotik_ssl')`);
    const s = Object.fromEntries(r.rows.map(row => [row.key, row.value]));
    return {
      host: s.mikrotik_host || process.env.MIKROTIK_HOST,
      port: s.mikrotik_port || process.env.MIKROTIK_PORT || '443',
      user: s.mikrotik_user || process.env.MIKROTIK_USER,
      pass: s.mikrotik_pass || process.env.MIKROTIK_PASS,
      ssl:  s.mikrotik_ssl !== undefined ? s.mikrotik_ssl === 'true' : process.env.MIKROTIK_SSL === 'true',
    };
  } catch {
    return {
      host: process.env.MIKROTIK_HOST,
      port: process.env.MIKROTIK_PORT || '443',
      user: process.env.MIKROTIK_USER,
      pass: process.env.MIKROTIK_PASS,
      ssl:  process.env.MIKROTIK_SSL === 'true',
    };
  }
}

function getMikrotikClient(cfg) {
  const host = cfg?.host || process.env.MIKROTIK_HOST;
  const port = cfg?.port || process.env.MIKROTIK_PORT || '443';
  const user = cfg?.user || process.env.MIKROTIK_USER;
  const pass = cfg?.pass || process.env.MIKROTIK_PASS;
  const ssl  = cfg?.ssl !== undefined ? cfg.ssl : process.env.MIKROTIK_SSL === 'true';

  const baseURL = `${ssl ? 'https' : 'http'}://${host}:${port}/rest`;
  return axios.create({
    baseURL,
    auth: { username: user, password: pass },
    httpsAgent: agent,
    timeout: 10000,
  });
}

// Cached async client for services that call getMikrotikClient()
// (backward-compat — sync call uses env vars as before, async path uses DB)
getMikrotikClient.fromDB = async () => {
  const cfg = await getMikrotikConfig();
  return getMikrotikClient(cfg);
};

module.exports = { getMikrotikClient, getMikrotikConfig };
