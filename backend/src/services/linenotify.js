const axios = require('axios');
const { query } = require('../config/db');

async function sendLineNotify(message) {
  try {
    const r = await query(`SELECT value FROM settings WHERE key IN ('line_notify_token','line_notify_enabled')`);
    const map = Object.fromEntries(r.rows.map(row => [row.key, row.value]));
    if (map.line_notify_enabled !== 'true' || !map.line_notify_token) return false;

    await axios.post(
      'https://notify-api.line.me/api/notify',
      new URLSearchParams({ message }),
      { headers: { Authorization: `Bearer ${map.line_notify_token}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return true;
  } catch (err) {
    console.error('Line Notify failed:', err.message);
    return false;
  }
}

module.exports = { sendLineNotify };
