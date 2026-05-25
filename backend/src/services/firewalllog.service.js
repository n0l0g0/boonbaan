const mikrotik = require('./mikrotik');
const { notify } = require('./notification');
const { query } = require('../config/db');
const { getMikrotikClient } = require('../config/mikrotik');

// Dedup recent log lines to avoid re-processing the same drop event.
// MikroTik logs use "time" string with second granularity; many drops happen per second.
let recentLogIds = new Set();

// Match MikroTik firewall log emitted by rules with log-prefix=WF-DROP / WF-SNI
// Example: "WF-DROP forward: in:bridge1 out:pppoe-out1, src-mac aa:..., proto TCP (SYN), 192.168.1.50:54321->1.2.3.4:443, len 60"
const WF_LOG_REGEX = /WF-(DROP|SNI)\b[^]*?(?:src-mac\s+([0-9a-f:]+).*?)?\b(\d+\.\d+\.\d+\.\d+):(\d+)\s*->\s*(\d+\.\d+\.\d+\.\d+):(\d+)/i;

const notifyCooldown = new Map();
async function getCooldownSec() {
  try { const r = await query("SELECT value FROM settings WHERE key='blocked_access_cooldown_sec'"); return Number(r.rows[0]?.value) || 300; }
  catch { return 300; }
}
async function isNotifyEnabled() {
  try { const r = await query("SELECT value FROM settings WHERE key='blocked_access_notify'"); return r.rows[0]?.value !== 'false'; }
  catch { return true; }
}
function canNotify(key, cooldownSec) {
  const now = Date.now();
  const last = notifyCooldown.get(key);
  if (!last || now - last > cooldownSec * 1000) { notifyCooldown.set(key, now); return true; }
  return false;
}

async function pollFirewallDropLogs(io) {
  try {
    const [logs, dnsCache] = await Promise.all([
      mikrotik.getLogs({ topics: 'firewall' }).catch(() => []),
      getMikrotikClient.fromDB().then(c => c.get('/ip/dns/cache')).then(r => r.data).catch(() => []),
    ]);
    if (!logs?.length) return;

    // Build IP→domain reverse lookup from MikroTik DNS cache
    const ipToDomain = new Map();
    for (const e of dnsCache) {
      if (!e.address || !e.name) continue;
      const existing = ipToDomain.get(e.address);
      if (!existing || e.name.length < existing.length) ipToDomain.set(e.address, e.name);
    }

    const cooldownSec = await getCooldownSec();
    const notifyEnabled = await isNotifyEnabled();

    for (const log of logs) {
      const msg = log.message || '';
      if (!/WF-(DROP|SNI)/i.test(msg)) continue;
      const m = msg.match(WF_LOG_REGEX);
      if (!m) continue;

      const logId = `${log.time}:${msg}`;
      if (recentLogIds.has(logId)) continue;
      recentLogIds.add(logId);

      const [, /*ruleType*/, /*srcMac*/, srcIp, /*srcPort*/, dstIp, dstPort] = m;
      const dstHost = ipToDomain.get(dstIp) || dstIp;

      await query(
        `INSERT INTO blocked_access_log (src_ip, dst_host, dst_port, raw_message, notified)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [srcIp, dstHost, dstPort, msg, notifyEnabled]
      ).catch(() => {});

      if (io) {
        io.emit('blocked:access', {
          srcIp, dstHost, dstPort, message: msg,
          detectedAt: new Date().toISOString(),
        });
      }

      if (notifyEnabled) {
        const key = `${srcIp}:${dstHost}`;
        if (canNotify(key, cooldownSec)) {
          await notify(
            'warning',
            'Blocked Website Access Detected',
            `IP: ${srcIp} attempted to access ${dstHost}${dstPort ? ':' + dstPort : ''}`
          ).catch(() => {});
        }
      }
    }

    // Trim dedup set so memory doesn't grow unbounded
    if (recentLogIds.size > 1000) {
      recentLogIds = new Set([...recentLogIds].slice(-300));
    }
  } catch (err) {
    console.error('firewalllog poll error:', err.message);
  }
}

module.exports = { pollFirewallDropLogs };
