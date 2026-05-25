const router = require('express').Router();
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { query } = require('../config/db');
const { validatePassword } = require('../utils/passwordPolicy');

router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const r = await query('SELECT id, username, role, created_at, last_login FROM users ORDER BY id');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { username, password, role = 'viewer' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const pwErrors = validatePassword(password);
  if (pwErrors.length) return res.status(400).json({ error: 'รหัสผ่านไม่ผ่านนโยบาย', missing: pwErrors });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hash, role]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, adminOnly, async (req, res) => {
  const { password, role } = req.body;
  try {
    if (password) {
      const pwErrors = validatePassword(password);
      if (pwErrors.length) return res.status(400).json({ error: 'รหัสผ่านไม่ผ่านนโยบาย', missing: pwErrors });
      const hash = await bcrypt.hash(password, 10);
      await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    }
    if (role) await query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
