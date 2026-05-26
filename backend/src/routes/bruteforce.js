const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const bf = require('../services/bruteforce.service');

router.get('/blocks', auth, async (req, res) => {
  try { res.json(await bf.listBlocks({ status: req.query.status })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', auth, async (req, res) => {
  try {
    const cfg = await bf.getConfig();
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/settings', auth, async (req, res) => {
  try {
    const allowed = {
      bf_enabled: v => String(!!v),
      bf_window_min: v => String(Math.max(1, Math.min(1440, Number(v) || 10))),
      bf_threshold: v => String(Math.max(2, Math.min(1000, Number(v) || 5))),
      bf_block_duration_min: v => String(Math.max(1, Math.min(60 * 24 * 30, Number(v) || 60))),
      bf_address_list: v => String(v || 'auto_blacklist').slice(0, 64),
      bf_whitelist_extra: v => String(v || '').slice(0, 1000),
    };
    const updates = [];
    for (const [key, transform] of Object.entries(allowed)) {
      if (key in req.body) updates.push([key, transform(req.body[key])]);
    }
    for (const [key, value] of updates) {
      await query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }
    res.json(await bf.getConfig());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/unblock', auth, async (req, res) => {
  try {
    const ip = (req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip required' });
    const r = await bf.unblockIp(ip, req.user?.username);
    if (!r.ok) return res.status(404).json(r);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/evaluate', auth, async (req, res) => {
  try { res.json(await bf.evaluate()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
