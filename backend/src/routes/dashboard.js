const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');
const { query } = require('../config/db');
const { getMikrotikClient } = require('../config/mikrotik');
const {
  SITE_CATEGORIES, categorize,
  getHistoryForDate, getDrilldownForDate, getAvailableDates,
} = require('../services/siteusage.service');

// GET /dashboard/site-stats — real-time DNS cache breakdown
router.get('/site-stats', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const cache = await mk.get('/ip/dns/cache').then(r => r.data).catch(() => []);

    const counts = {};
    for (const entry of cache) {
      if (entry.static === 'true') continue;
      const cat = categorize(entry.name || '');
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
    const known = SITE_CATEGORIES
      .filter(c => counts[c.name])
      .map(c => ({ name: c.name, value: counts[c.name], color: c.color, logo: c.logo, pct: +((counts[c.name] / total) * 100).toFixed(1) }))
      .sort((a, b) => b.value - a.value);

    const other = counts['อื่นๆ'] || 0;
    if (other) known.push({ name: 'อื่นๆ', value: other, color: '#bfbfbf', pct: +((other / total) * 100).toFixed(1) });

    res.json({ data: known, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /dashboard/site-stats/history?date=YYYY-MM-DD
router.get('/site-stats/history', auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const data = await getHistoryForDate(date);
    const total = data.reduce((s, d) => s + d.value, 0);
    res.json({ data, total, date });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /dashboard/site-stats/drilldown?category=Google&date=YYYY-MM-DD
router.get('/site-stats/drilldown', auth, async (req, res) => {
  try {
    const { category, date } = req.query;
    if (!category) return res.status(400).json({ error: 'category required' });
    const d = date || new Date().toISOString().slice(0, 10);
    const domains = await getDrilldownForDate(category, d);
    res.json({ category, date: d, domains });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /dashboard/site-stats/dates — available dates with data
router.get('/site-stats/dates', auth, async (req, res) => {
  try {
    const dates = await getAvailableDates();
    res.json({ dates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', auth, async (req, res) => {
  try {
    const [resource, identity, interfaces, hotspotActive] = await Promise.allSettled([
      mikrotik.getResource(),
      mikrotik.getIdentity(),
      mikrotik.getInterfaces(),
      mikrotik.getHotspotActive(),
    ]);

    const r = resource.value || {};
    const totalMem = Number(r['total-memory']) || 1;
    const freeMem = Number(r['free-memory']) || 0;

    res.json({
      identity: identity.value?.name || 'MikroTik',
      uptime: r.uptime,
      version: r.version,
      cpu: Number(r['cpu-load']) || 0,
      memoryUsedPct: +(((totalMem - freeMem) / totalMem) * 100).toFixed(1),
      totalMemory: totalMem,
      freeMemory: freeMem,
      interfaces: (interfaces.value || []).length,
      hotspotActiveCount: (hotspotActive.value || []).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/security-pulse?hours=24 — threat overview from logs + audit
router.get('/security-pulse', auth, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);

    const [bySeverity, topAttackers, recentAudit, byCategory] = await Promise.all([
      query(
        `SELECT severity, COUNT(*)::int AS count
           FROM router_logs
          WHERE collected_at > NOW() - ($1::int * INTERVAL '1 hour')
            AND severity IN ('critical','high','medium')
          GROUP BY severity`,
        [hours]
      ),
      query(
        `SELECT src_ip, COUNT(*)::int AS attempts, MAX(collected_at) AS last_seen
           FROM router_logs
          WHERE collected_at > NOW() - ($1::int * INTERVAL '1 hour')
            AND category IN ('auth_failure','vpn_auth_failure','hotspot_auth_failure')
            AND src_ip IS NOT NULL
          GROUP BY src_ip
          ORDER BY attempts DESC
          LIMIT 5`,
        [hours]
      ),
      query(
        `SELECT created_at, service, action, target_username, actor_username
           FROM password_audit_log
          WHERE created_at > NOW() - ($1::int * INTERVAL '1 hour')
          ORDER BY created_at DESC
          LIMIT 10`,
        [hours]
      ),
      query(
        `SELECT category, COUNT(*)::int AS count
           FROM router_logs
          WHERE collected_at > NOW() - ($1::int * INTERVAL '1 hour')
            AND severity IN ('critical','high','medium')
            AND category IS NOT NULL
          GROUP BY category
          ORDER BY count DESC
          LIMIT 6`,
        [hours]
      ),
    ]);

    const counts = Object.fromEntries(bySeverity.rows.map(r => [r.severity, r.count]));
    res.json({
      hours,
      critical: counts.critical || 0,
      high: counts.high || 0,
      medium: counts.medium || 0,
      topAttackers: topAttackers.rows,
      recentAudit: recentAudit.rows,
      topCategories: byCategory.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /dashboard/active-sessions — combined hotspot + VPN active sessions
router.get('/active-sessions', auth, async (req, res) => {
  try {
    const [hs, ppp] = await Promise.allSettled([
      mikrotik.getHotspotActive(),
      mikrotik.getPppActive(),
    ]);
    res.json({
      hotspot: (hs.value || []).map(s => ({
        user: s.user, ip: s.address, mac: s['mac-address'], uptime: s.uptime,
        bytes_in: Number(s['bytes-in']) || 0, bytes_out: Number(s['bytes-out']) || 0,
      })),
      vpn: (ppp.value || []).map(s => ({
        user: s.name, service: s.service, address: s.address,
        caller_id: s['caller-id'], uptime: s.uptime,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /dashboard/top-talkers?date=YYYY-MM-DD&limit=10 — devices using most bandwidth
router.get('/top-talkers', auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const r = await query(
      `SELECT mac, hostname, ip, type, vendor, rx_bytes, tx_bytes, total_bytes
         FROM device_usage_daily
        WHERE day = $1
        ORDER BY total_bytes DESC
        LIMIT $2`,
      [date, limit]
    );
    res.json({ date, rows: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
