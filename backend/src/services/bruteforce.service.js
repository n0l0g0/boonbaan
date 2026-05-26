const { query } = require('../config/db');
const mikrotik = require('./mikrotik');
const { getSettings, sendEmail } = require('./notification');

// Default whitelist: RFC1918 private + loopback + link-local. Never block these.
const DEFAULT_WHITELIST_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
];

function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, p) => (acc << 8) + (Number(p) & 0xff), 0) >>> 0;
}

function inCidr(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt == null || baseInt == null || isNaN(bits)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isWhitelisted(ip, extra = []) {
  const cidrs = [...DEFAULT_WHITELIST_CIDRS, ...extra];
  return cidrs.some(c => {
    if (!c) return false;
    if (c.includes('/')) return inCidr(ip, c);
    return ip === c;
  });
}

async function getConfig() {
  const s = await getSettings([
    'bf_enabled', 'bf_window_min', 'bf_threshold',
    'bf_block_duration_min', 'bf_address_list', 'bf_whitelist_extra',
  ]);
  return {
    enabled: s.bf_enabled !== 'false',
    windowMin: Number(s.bf_window_min) || 10,
    threshold: Number(s.bf_threshold) || 5,
    blockMin: Number(s.bf_block_duration_min) || 60,
    listName: s.bf_address_list || 'auto_blacklist',
    whitelistExtra: (s.bf_whitelist_extra || '').split(/[,\s]+/).filter(Boolean),
  };
}

async function blockIp({ ip, attempts, categories, firstSeen }, cfg) {
  const expiresAt = new Date(Date.now() + cfg.blockMin * 60_000);
  const comment = `auto-blacklist: ${attempts} attempts (${categories.join(',')}) — expires ${expiresAt.toISOString()}`;

  // Push to MikroTik address-list with timeout — MikroTik will auto-remove
  let mtId = null;
  try {
    const result = await mikrotik.addAddressListEntry({
      list: cfg.listName,
      address: ip,
      comment,
      timeout: `${cfg.blockMin}m`,
    });
    mtId = result?.['.id'] || result?.['ret'] || null;
  } catch (err) {
    console.error(`brute-force: failed to add ${ip} to MikroTik address-list: ${err.message}`);
    return { ok: false, reason: err.message };
  }

  await query(
    `INSERT INTO brute_force_blocks (ip, attempts, categories, first_seen, expires_at, mt_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [ip, attempts, categories.join(','), firstSeen, expiresAt, mtId]
  );

  // Best-effort notification
  sendEmail(
    `Brute-force IP blocked: ${ip}`,
    `IP ${ip} ถูกบล็อกอัตโนมัติ\n\nAttempts: ${attempts} ครั้งใน ${cfg.windowMin} นาที\nCategories: ${categories.join(', ')}\nFirst seen: ${firstSeen}\nExpires: ${expiresAt.toISOString()} (${cfg.blockMin} นาที)\nAddress-list: ${cfg.listName}`,
    { rawSubject: true, force: true }
  ).catch(() => {});

  return { ok: true, ip, expiresAt, mtId };
}

// Main entry — call periodically. Idempotent (won't re-block active IPs).
async function evaluate() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };

  // Find IPs with auth failures in the window
  const r = await query(
    `SELECT src_ip,
            COUNT(*)::int AS attempts,
            MIN(collected_at) AS first_seen,
            array_agg(DISTINCT category) AS categories
       FROM router_logs
      WHERE collected_at > NOW() - ($1::int * INTERVAL '1 minute')
        AND category IN ('auth_failure','vpn_auth_failure','hotspot_auth_failure')
        AND src_ip IS NOT NULL
      GROUP BY src_ip
     HAVING COUNT(*) >= $2`,
    [cfg.windowMin, cfg.threshold]
  );

  const candidates = r.rows;
  const blocked = [];
  const skipped = [];

  for (const c of candidates) {
    if (isWhitelisted(c.src_ip, cfg.whitelistExtra)) {
      skipped.push({ ip: c.src_ip, reason: 'whitelisted' });
      continue;
    }
    // Skip if already actively blocked (status='active' and not expired)
    const existing = await query(
      `SELECT 1 FROM brute_force_blocks
        WHERE ip = $1 AND status = 'active' AND expires_at > NOW() LIMIT 1`,
      [c.src_ip]
    );
    if (existing.rows.length) {
      skipped.push({ ip: c.src_ip, reason: 'already blocked' });
      continue;
    }
    const result = await blockIp({
      ip: c.src_ip,
      attempts: c.attempts,
      categories: c.categories,
      firstSeen: c.first_seen,
    }, cfg);
    if (result.ok) blocked.push(result);
    else skipped.push({ ip: c.src_ip, reason: result.reason });
  }

  // Cleanup: mark expired rows
  await query(
    `UPDATE brute_force_blocks SET status = 'expired'
      WHERE status = 'active' AND expires_at <= NOW()`
  );

  return { blocked: blocked.length, skipped: skipped.length, candidates: candidates.length };
}

async function listBlocks({ status, limit = 200 } = {}) {
  const where = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  const r = await query(
    `SELECT id, ip, attempts, categories, first_seen, blocked_at, expires_at,
            unblocked_at, unblocked_by, mt_id, status
       FROM brute_force_blocks ${where}
       ORDER BY blocked_at DESC
       LIMIT ${Number(limit) || 200}`,
    params
  );
  return r.rows;
}

async function unblockIp(ip, actor) {
  const cfg = await getConfig();
  // Find active row
  const r = await query(
    `SELECT id, mt_id FROM brute_force_blocks
      WHERE ip = $1 AND status = 'active' ORDER BY blocked_at DESC LIMIT 1`,
    [ip]
  );
  if (!r.rows.length) return { ok: false, error: 'not found or already unblocked' };
  const { id, mt_id } = r.rows[0];

  // Remove from MikroTik — look up by list+address if mt_id unknown
  try {
    const entries = await mikrotik.getAddressList(cfg.listName);
    const match = entries.find(e => e.address === ip);
    if (match) await mikrotik.removeAddressListEntry(match['.id']);
    else if (mt_id) await mikrotik.removeAddressListEntry(mt_id).catch(() => {});
  } catch (err) {
    console.error(`unblock: failed to remove ${ip} from MikroTik: ${err.message}`);
  }

  await query(
    `UPDATE brute_force_blocks
        SET status = 'unblocked', unblocked_at = NOW(), unblocked_by = $1
      WHERE id = $2`,
    [actor || null, id]
  );
  return { ok: true };
}

module.exports = { evaluate, listBlocks, unblockIp, getConfig, isWhitelisted };
