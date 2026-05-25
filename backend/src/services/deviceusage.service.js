const crypto = require('crypto');
const { getMikrotikClient } = require('../config/mikrotik');
const { query } = require('../config/db');
const { detectDevice } = require('./devices.service');

const { touchFirstSeen, reconcile: reconcileFirstSeen } = require('./conntrackFirstSeen');

// Previous snapshot of per-connection bytes, keyed by conntrack entry id ('.id')
// Reset on process restart — first sample after restart contributes nothing,
// subsequent samples contribute deltas.
const prevByConnId = new Map();

// Map conntrack id → { sessionKey, inserted } — lets us update the same DB row
// for the lifetime of one conntrack entry, then close it when the id disappears.
// 'inserted' flips true after the first INSERT, so later samples only UPDATE.
const sessionByConnId = new Map();

const TZ = 'Asia/Bangkok';

function bangkokDay(d = new Date()) {
  // YYYY-MM-DD in Asia/Bangkok
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Pull conntrack + arp + leases; compute byte deltas per src-IP, then map to MAC,
// then upsert daily aggregates.
async function sampleDeviceUsage() {
  const mk = await getMikrotikClient.fromDB();
  const [conns, arp, leases] = await Promise.all([
    mk.get('/ip/firewall/connection').then(r => r.data).catch(() => []),
    mk.get('/ip/arp').then(r => r.data).catch(() => []),
    mk.get('/ip/dhcp-server/lease').then(r => r.data).catch(() => []),
  ]);

  // Build IP → { mac, hostname } using ARP first then DHCP leases
  const ipInfo = new Map();
  for (const a of arp) {
    const ip = a.address;
    const mac = (a['mac-address'] || '').toLowerCase();
    if (ip && mac) ipInfo.set(ip, { mac, hostname: '' });
  }
  for (const l of leases) {
    const ip = l.address;
    const mac = (l['mac-address'] || '').toLowerCase();
    const host = l['host-name'] || '';
    if (!ip || !mac) continue;
    const existing = ipInfo.get(ip);
    if (existing) {
      if (host) existing.hostname = host;
      if (!existing.mac) existing.mac = mac;
    } else {
      ipInfo.set(ip, { mac, hostname: host });
    }
  }

  // Aggregate byte deltas per src-IP (rx = repl-bytes received by device = download,
  //                                  tx = orig-bytes sent by device      = upload)
  // Also build per-session writes for device_connection_history.
  const perIp = new Map();
  const seenIds = new Set();
  const sessionWrites = []; // { isNew, sessionKey, deviceIp, dstIp, dstPort, protocol, tcpState, totalBytes }

  for (const c of conns) {
    const id = c['.id'];
    if (!id) continue;
    seenIds.add(id);
    touchFirstSeen(id);

    const srcAddr = (c['src-address'] || '').split(':')[0];
    if (!srcAddr) continue;

    // Only count traffic originating from LAN devices (private IPv4 ranges)
    if (!/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(srcAddr)) continue;

    const orig = Number(c['orig-bytes']) || 0;
    const repl = Number(c['repl-bytes']) || 0;
    const total = orig + repl;

    const prev = prevByConnId.get(id);
    let dTx, dRx;
    if (!prev) {
      dTx = 0; dRx = 0;
    } else {
      dTx = orig - prev.orig;
      dRx = repl - prev.repl;
      if (dTx < 0) dTx = orig;
      if (dRx < 0) dRx = repl;
    }
    prevByConnId.set(id, { orig, repl });

    if (dTx !== 0 || dRx !== 0) {
      const agg = perIp.get(srcAddr) || { tx: 0, rx: 0 };
      agg.tx += dTx;
      agg.rx += dRx;
      perIp.set(srcAddr, agg);
    }

    // Connection-history session bookkeeping (one DB row per conntrack id)
    let sess = sessionByConnId.get(id);
    if (!sess) {
      sess = { sessionKey: crypto.randomUUID(), inserted: false };
      sessionByConnId.set(id, sess);
    }
    const [dstIp, dstPort] = (c['dst-address'] || '').split(':');
    sessionWrites.push({
      isNew: !sess.inserted,
      sessionKey: sess.sessionKey,
      deviceIp: srcAddr,
      dstIp,
      dstPort: dstPort ? Number(dstPort) : null,
      protocol: c.protocol || null,
      tcpState: c['tcp-state'] || null,
      totalBytes: total,
    });
    sess.inserted = true;
  }

  // Drop ids that disappeared from conntrack — and close their DB rows
  const closedSessionKeys = [];
  for (const id of prevByConnId.keys()) {
    if (!seenIds.has(id)) prevByConnId.delete(id);
  }
  for (const [id, sess] of sessionByConnId.entries()) {
    if (!seenIds.has(id)) {
      if (sess.inserted) closedSessionKeys.push(sess.sessionKey);
      sessionByConnId.delete(id);
    }
  }
  reconcileFirstSeen(seenIds);

  // Persist connection-history rows (fire-and-track; map src-ip → mac via ipInfo)
  for (const w of sessionWrites) {
    const info = ipInfo.get(w.deviceIp);
    const mac = info?.mac || null;
    if (w.isNew) {
      await query(
        `INSERT INTO device_connection_history
           (session_key, device_mac, device_ip, dst_ip, dst_port, protocol, tcp_state, total_bytes, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (session_key) DO NOTHING`,
        [w.sessionKey, mac, w.deviceIp, w.dstIp, w.dstPort, w.protocol, w.tcpState, w.totalBytes]
      );
    } else {
      await query(
        `UPDATE device_connection_history
            SET total_bytes = $2, tcp_state = COALESCE($3, tcp_state), last_seen = NOW()
          WHERE session_key = $1`,
        [w.sessionKey, w.totalBytes, w.tcpState]
      );
    }
  }
  if (closedSessionKeys.length) {
    await query(
      `UPDATE device_connection_history SET closed_at = NOW()
        WHERE closed_at IS NULL AND session_key = ANY($1::text[])`,
      [closedSessionKeys]
    );
  }

  if (perIp.size === 0) return { devices: 0, totalBytes: 0 };

  // Map per-IP totals to per-MAC, accumulating (multiple IPs can share a MAC e.g. dual-stack)
  const perMac = new Map();
  for (const [ip, { tx, rx }] of perIp.entries()) {
    const info = ipInfo.get(ip);
    if (!info) continue;
    const key = info.mac;
    const entry = perMac.get(key) || { ip, hostname: info.hostname, tx: 0, rx: 0 };
    entry.tx += tx;
    entry.rx += rx;
    if (!entry.hostname && info.hostname) entry.hostname = info.hostname;
    perMac.set(key, entry);
  }

  if (perMac.size === 0) return { devices: 0, totalBytes: 0 };

  const day = bangkokDay();
  let totalBytes = 0;

  // Upsert per MAC for today
  for (const [mac, { ip, hostname, tx, rx }] of perMac.entries()) {
    const total = tx + rx;
    if (total <= 0) continue;
    totalBytes += total;
    const { type, vendor } = detectDevice({ hostname, mac });
    await query(
      `INSERT INTO device_usage_daily (day, mac, ip, hostname, type, vendor, rx_bytes, tx_bytes, total_bytes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (day, mac) DO UPDATE SET
         rx_bytes    = device_usage_daily.rx_bytes + EXCLUDED.rx_bytes,
         tx_bytes    = device_usage_daily.tx_bytes + EXCLUDED.tx_bytes,
         total_bytes = device_usage_daily.total_bytes + EXCLUDED.total_bytes,
         ip          = COALESCE(EXCLUDED.ip, device_usage_daily.ip),
         hostname    = COALESCE(NULLIF(EXCLUDED.hostname,''), device_usage_daily.hostname),
         type        = COALESCE(EXCLUDED.type, device_usage_daily.type),
         vendor      = COALESCE(NULLIF(EXCLUDED.vendor,''), device_usage_daily.vendor),
         updated_at  = NOW()`,
      [day, mac, ip || null, hostname || '', type, vendor || '', rx, tx, total]
    );
  }

  return { devices: perMac.size, totalBytes };
}

// Top devices over a date range, ranked by total bytes
async function topDevices({ from, to, limit = 10 }) {
  const r = await query(
    `SELECT mac,
            MAX(hostname) FILTER (WHERE hostname <> '') AS hostname,
            MAX(ip)       AS ip,
            MAX(type)     AS type,
            MAX(vendor)   AS vendor,
            SUM(rx_bytes)::bigint    AS rx_bytes,
            SUM(tx_bytes)::bigint    AS tx_bytes,
            SUM(total_bytes)::bigint AS total_bytes,
            COUNT(DISTINCT day)       AS days_seen
       FROM device_usage_daily
      WHERE day >= $1::date AND day <= $2::date
      GROUP BY mac
      ORDER BY total_bytes DESC
      LIMIT $3`,
    [from, to, Math.min(Number(limit) || 10, 100)]
  );
  return r.rows;
}

async function cleanupOldUsage() {
  await query(`DELETE FROM device_usage_daily WHERE day < CURRENT_DATE - INTERVAL '90 days'`);
  // Connection history is much higher cardinality — keep 14 days
  await query(`DELETE FROM device_connection_history WHERE last_seen < NOW() - INTERVAL '14 days'`);
}

module.exports = { sampleDeviceUsage, topDevices, cleanupOldUsage, bangkokDay };
