const { query } = require('../config/db');

// Best-effort audit log: never throws — auditing must not break the user-facing flow.
async function logPasswordEvent({ req, service, action, target, status = 'success', details = null }) {
  try {
    const actor = req?.user?.username || null;
    const ip = req
      ? (req.headers?.['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null)
      : null;
    await query(
      `INSERT INTO password_audit_log (service, action, target_username, actor_username, actor_ip, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [service, action, target, actor, ip, status, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('audit log insert failed:', err.message);
  }
}

module.exports = { logPasswordEvent };
