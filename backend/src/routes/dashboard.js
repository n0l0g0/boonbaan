const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');
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

module.exports = router;
