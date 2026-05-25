const router = require('express').Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { query } = require('../config/db');

router.get('/', auth, async (req, res) => {
  try {
    const r = await query('SELECT id, name, host, port, username, use_ssl, is_default, created_at FROM routers ORDER BY id');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { name, host, port = 443, username, password, use_ssl = true, is_default = false } = req.body;
  try {
    if (is_default) await query('UPDATE routers SET is_default=false');
    const r = await query(
      'INSERT INTO routers (name, host, port, username, password, use_ssl, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, host',
      [name, host, port, username, password, use_ssl, is_default]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/default', auth, adminOnly, async (req, res) => {
  try {
    await query('UPDATE routers SET is_default=false');
    await query('UPDATE routers SET is_default=true WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM routers WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
