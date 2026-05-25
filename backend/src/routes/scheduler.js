const router = require('express').Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { query } = require('../config/db');
const { runScheduledTask } = require('../jobs/scheduler');

router.get('/', auth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM scheduled_tasks ORDER BY id');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { name, type, cron_expr, enabled = true } = req.body;
  try {
    const r = await query(
      'INSERT INTO scheduled_tasks (name, type, cron_expr, enabled) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, type, cron_expr, enabled]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', auth, adminOnly, async (req, res) => {
  const { name, cron_expr, enabled } = req.body;
  try {
    await query(
      'UPDATE scheduled_tasks SET name=COALESCE($1,name), cron_expr=COALESCE($2,cron_expr), enabled=COALESCE($3,enabled) WHERE id=$4',
      [name, cron_expr, enabled, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM scheduled_tasks WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Run task immediately
router.post('/:id/run', auth, adminOnly, async (req, res) => {
  try {
    const r = await query('SELECT * FROM scheduled_tasks WHERE id=$1', [req.params.id]);
    const task = r.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const result = await runScheduledTask(task);
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
