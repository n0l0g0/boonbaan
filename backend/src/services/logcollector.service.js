const { query } = require('../config/db');
const mikrotik = require('./mikrotik');
const { classify } = require('./logClassifier');

// Parse MikroTik log level from topics string
function parseLevel(topics = '') {
  if (topics.includes('critical') || topics.includes('error')) return 'error';
  if (topics.includes('warning')) return 'warning';
  if (topics.includes('info')) return 'info';
  if (topics.includes('debug')) return 'debug';
  return 'info';
}

// Extract username and src_ip from log message
function parseDetails(message = '', topics = '') {
  let username = null;
  let src_ip = null;

  // Hotspot: "192.168.1.10 logged in by username john"
  let m = message.match(/(\d+\.\d+\.\d+\.\d+) logged in.*?username[:\s]+(\S+)/i);
  if (m) { src_ip = m[1]; username = m[2]; return { username, src_ip }; }

  // Hotspot: "john logged in from 192.168.1.10"
  m = message.match(/^(\S+) logged (in|out).*?(\d+\.\d+\.\d+\.\d+)/i);
  if (m) { username = m[1]; src_ip = m[3]; return { username, src_ip }; }

  // PPP/VPN: "<user> logged in" or "<user>: connected"
  if (topics.includes('ppp') || topics.includes('l2tp') || topics.includes('pptp') || topics.includes('ovpn')) {
    m = message.match(/^(\S+)\s+(logged|connected|disconnected)/i);
    if (m) { username = m[1]; }
    m = message.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (m) src_ip = m[1];
    return { username, src_ip };
  }

  // Firewall: "forward: in:ether1 out:bridge, src-mac ... proto ... 192.168.1.5:port->..."
  m = message.match(/(\d+\.\d+\.\d+\.\d+):\d+->(\d+\.\d+\.\d+\.\d+)/);
  if (m) { src_ip = m[1]; return { username, src_ip }; }

  // Any IP in message
  m = message.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (m) src_ip = m[1];

  return { username, src_ip };
}

// Convert MikroTik time string to Date (router is +7)
function parseLogTime(timeStr) {
  if (!timeStr) return new Date();
  const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const now = new Date();

  // "12:34:56" — today
  if (/^\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
    // Router time is +7; treat as Asia/Bangkok local time
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return new Date(`${year}-${month}-${day}T${timeStr}+07:00`);
  }

  // "jan/02 12:34:56" — this year
  const m1 = timeStr.match(/^([a-z]{3})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/i);
  if (m1) {
    const month = String((MONTHS[m1[1].toLowerCase()] ?? 0) + 1).padStart(2, '0');
    return new Date(`${now.getFullYear()}-${month}-${m1[2]}T${m1[3]}+07:00`);
  }

  // "2024-01-02 12:34:56"
  const m2 = timeStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (m2) return new Date(`${m2[1]}T${m2[2]}+07:00`);

  return new Date();
}

async function getLastLogId() {
  const r = await query(`SELECT value FROM log_collector_state WHERE key = 'last_log_id'`);
  return r.rows[0]?.value || null;
}

async function setLastLogId(id) {
  await query(
    `INSERT INTO log_collector_state (key, value) VALUES ('last_log_id', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [id]
  );
}

function idToInt(id) {
  return id ? parseInt(id.replace('*', ''), 16) : -1;
}

async function collectLogs(io = null) {
  try {
    let lastId = await getLastLogId();
    let lastInt = idToInt(lastId);

    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();
    const all = await mk.get('/log').then(r => r.data).catch(() => []);

    // Detect log-buffer rollover (router reboot / clear): IDs reset to 0,
    // so our stored cursor sits above MikroTik's current max → no log would
    // ever match. Reset the cursor and ingest everything in the buffer.
    if (all.length) {
      const maxInt = idToInt(all[all.length - 1]['.id']);
      if (lastInt > maxInt) {
        console.warn(`log collector: cursor ${lastId} > current max *${maxInt.toString(16)} — buffer rotated, resetting cursor`);
        lastId = null;
        lastInt = -1;
      }
    }

    const logs = lastId
      ? all.filter(l => idToInt(l['.id']) > lastInt)
      : all;

    if (!logs || logs.length === 0) return;

    for (const log of logs) {
      const { username, src_ip } = parseDetails(log.message || '', log.topics || '');
      const logTime = parseLogTime(log.time);
      const { category, severity } = classify(log.message || '', log.topics || '');
      const result = await query(
        `INSERT INTO router_logs (collected_at, log_time, topics, level, message, username, src_ip, raw_time, category, severity)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, collected_at, log_time, topics, level, message, username, src_ip, raw_time, category, severity`,
        [
          logTime,
          log.topics || null,
          parseLevel(log.topics || ''),
          log.message || '',
          username,
          src_ip,
          log.time || null,
          category,
          severity,
        ]
      ).catch(() => null);

      if (io && result?.rows?.[0]) {
        io.emit('log:new', result.rows[0]);
      }
    }

    const lastLog = logs[logs.length - 1];
    if (lastLog?.['.id']) await setLastLogId(lastLog['.id']);

    await query(`DELETE FROM router_logs WHERE collected_at < NOW() - INTERVAL '180 days'`).catch(() => {});

  } catch (err) {
    console.error('Log collector error:', err.message);
  }
}

// Re-classify existing rows that don't have category/severity set yet.
// Safe to run repeatedly; only touches rows where severity IS NULL.
async function backfillClassification(batchSize = 2000) {
  let total = 0;
  while (true) {
    const r = await query(
      `SELECT id, topics, message FROM router_logs WHERE severity IS NULL LIMIT $1`,
      [batchSize]
    );
    if (!r.rows.length) break;
    for (const row of r.rows) {
      const { category, severity } = classify(row.message || '', row.topics || '');
      await query(
        `UPDATE router_logs SET category = $1, severity = $2 WHERE id = $3`,
        [category, severity, row.id]
      ).catch(() => {});
    }
    total += r.rows.length;
    if (r.rows.length < batchSize) break;
  }
  return total;
}

module.exports = { collectLogs, backfillClassification };
