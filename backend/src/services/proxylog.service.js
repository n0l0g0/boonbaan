const mikrotik = require('./mikrotik');
const { notify } = require('./notification');
const { query } = require('../config/db');

// Track last processed log time to avoid reprocessing
let lastLogTime = null;

// MikroTik proxy deny log format:
// "web proxy,info denied x.x.x.x:port -> host:port"
// "proxy,info connection denied x.x.x.x -> host:port (rule comment)"
const DENY_PATTERNS = [
  // pattern: srcip, dsthost, dstport
  /denied\s+(?:connection[:\s]+)?(\d+\.\d+\.\d+\.\d+)(?::\d+)?\s*[-:>]+\s*([^\s:]+):?(\d+)?/i,
  /connection denied\s+(\d+\.\d+\.\d+\.\d+)\s*->\s*([^\s:]+):?(\d+)?/i,
];

function parseProxyDenyLog(msg) {
  for (const pattern of DENY_PATTERNS) {
    const m = msg.match(pattern);
    if (m) {
      return { srcIp: m[1], dstHost: m[2], dstPort: m[3] || null };
    }
  }
  return null;
}

// Cooldown per (srcIp + dstHost): avoid notification spam
const notifyCooldown = new Map();

async function getCooldownSec() {
  try {
    const r = await query(`SELECT value FROM settings WHERE key='blocked_access_cooldown_sec'`);
    return Number(r.rows[0]?.value) || 300;
  } catch { return 300; }
}

async function isNotifyEnabled() {
  try {
    const r = await query(`SELECT value FROM settings WHERE key='blocked_access_notify'`);
    return r.rows[0]?.value !== 'false';
  } catch { return true; }
}

function canNotify(key, cooldownSec) {
  const now = Date.now();
  const last = notifyCooldown.get(key);
  if (!last || now - last > cooldownSec * 1000) {
    notifyCooldown.set(key, now);
    return true;
  }
  return false;
}

async function pollProxyDenyLogs(io) {
  try {
    // Fetch recent web-proxy logs (last 200 entries)
    const logs = await mikrotik.getLogs({ topics: 'web-proxy,proxy' });
    if (!logs?.length) return;

    const cooldownSec = await getCooldownSec();
    const notifyEnabled = await isNotifyEnabled();

    for (const log of logs) {
      const msg = log.message || '';
      if (!msg.toLowerCase().includes('denied') && !msg.toLowerCase().includes('deny')) continue;

      // Use MikroTik log time as unique key to avoid double-processing
      const logTime = log.time || '';
      const logId = `${logTime}:${msg}`;

      // Skip if already seen (simple in-memory dedup for current run)
      if (lastLogTime && logTime <= lastLogTime) continue;

      const parsed = parseProxyDenyLog(msg);
      if (!parsed) continue;

      const { srcIp, dstHost, dstPort } = parsed;

      // Save to DB (ignore duplicate within same second)
      try {
        await query(
          `INSERT INTO blocked_access_log (src_ip, dst_host, dst_port, raw_message, notified)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [srcIp, dstHost, dstPort, msg, notifyEnabled]
        );
      } catch { continue; }

      // Emit to frontend via socket
      if (io) {
        io.emit('blocked:access', { srcIp, dstHost, dstPort, message: msg, detectedAt: new Date().toISOString() });
      }

      // Send notification (with cooldown)
      if (notifyEnabled) {
        const cooldownKey = `${srcIp}:${dstHost}`;
        if (canNotify(cooldownKey, cooldownSec)) {
          await notify(
            'warning',
            'Blocked Website Access Detected',
            `IP: ${srcIp} attempted to access ${dstHost}${dstPort ? ':' + dstPort : ''}`
          );
        }
      }
    }

    // Update last processed time
    if (logs.length > 0) lastLogTime = logs[logs.length - 1].time;

  } catch (err) {
    console.error('proxylog poll error:', err.message);
  }
}

module.exports = { pollProxyDenyLogs };
