const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');

const ALLOWED_SERVICES = ['hotspot', 'vpn'];
const ALLOWED_ACTIONS = [
  'admin_changed_password',
  'reset_link_generated',
  'reset_email_sent',
  'user_reset_via_link',
];

router.get('/password', auth, async (req, res) => {
  try {
    const { service, action, target, actor, status, since, until } = req.query;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);

    const where = [];
    const params = [];
    const push = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

    if (service && ALLOWED_SERVICES.includes(service)) push('service = ?', service);
    if (action && ALLOWED_ACTIONS.includes(action)) push('action = ?', action);
    if (target) push('target_username ILIKE ?', `%${target}%`);
    if (actor) push('actor_username ILIKE ?', `%${actor}%`);
    if (status) push('status = ?', status);
    if (since) push('created_at >= ?', since);
    if (until) push('created_at <= ?', until);

    const sql = `
      SELECT id, created_at, service, action, target_username, actor_username, actor_ip, status, details
        FROM password_audit_log
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC
       LIMIT ${limit}`;
    const r = await query(sql, params);
    res.json({ rows: r.rows, limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
