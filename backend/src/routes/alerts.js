const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const { METRICS, COMPARATORS } = require('../services/alerts.service');

router.get('/metrics', auth, (req, res) => {
  res.json({ metrics: METRICS, comparators: COMPARATORS });
});

router.get('/rules', auth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM alert_rules ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules', auth, async (req, res) => {
  const { name, metric, comparator, threshold, duration_minutes = 0, severity = 'warning', enabled = true } = req.body;
  if (!name || !metric || !comparator || threshold === undefined) {
    return res.status(400).json({ error: 'name, metric, comparator, threshold required' });
  }
  if (!METRICS[metric]) return res.status(400).json({ error: 'invalid metric' });
  if (!COMPARATORS.includes(comparator)) return res.status(400).json({ error: 'invalid comparator' });
  try {
    const r = await query(
      `INSERT INTO alert_rules (name, metric, comparator, threshold, duration_minutes, severity, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, metric, comparator, Number(threshold), Number(duration_minutes) || 0, severity, !!enabled]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/rules/:id', auth, async (req, res) => {
  const fields = ['name', 'metric', 'comparator', 'threshold', 'duration_minutes', 'severity', 'enabled'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      params.push(req.body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });
  params.push(req.params.id);
  try {
    const r = await query(`UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (r.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:id', auth, async (req, res) => {
  try {
    await query('DELETE FROM alert_rules WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
