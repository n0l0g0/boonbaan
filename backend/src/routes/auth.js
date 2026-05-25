const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../config/db');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Seed admin from env if no users exist yet
async function ensureAdminUser() {
  try {
    const r = await query('SELECT COUNT(*) FROM users');
    if (Number(r.rows[0].count) === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASS || 'admin123', 10);
      await query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
        [process.env.ADMIN_USER || 'admin', hash]
      );
    }
  } catch { /* DB not ready */ }
}
ensureAdminUser();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await query('SELECT * FROM users WHERE username=$1', [username]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google OAuth login
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No credential' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Enforce allowed email domain
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
      return res.status(403).json({ error: `อนุญาตเฉพาะ @${allowedDomain} เท่านั้น` });
    }

    // Find or create user
    let user = (await query('SELECT * FROM users WHERE google_id=$1', [googleId])).rows[0];

    if (!user) {
      // Check if email already exists (link account)
      user = (await query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
      if (user) {
        await query('UPDATE users SET google_id=$1, avatar=$2 WHERE id=$3', [googleId, picture, user.id]);
        user.google_id = googleId;
      } else {
        // Auto-create new user as viewer (first user ever becomes admin)
        const countRes = await query('SELECT COUNT(*) FROM users');
        const role = Number(countRes.rows[0].count) === 0 ? 'admin' : 'viewer';
        const username = name || email.split('@')[0];
        const r = await query(
          `INSERT INTO users (username, password_hash, role, google_id, email, avatar)
           VALUES ($1, '', $2, $3, $4, $5) RETURNING *`,
          [username, role, googleId, email, picture]
        );
        user = r.rows[0];
      }
    } else {
      // Update avatar in case it changed
      await query('UPDATE users SET avatar=$1, email=$2 WHERE id=$3', [picture, email, user.id]);
    }

    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, username: user.username, role: user.role, avatar: picture });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// Change own password — requires current password
router.post('/change-password', require('../middleware/auth'), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  const { validatePassword } = require('../utils/passwordPolicy');
  const pwErrors = validatePassword(newPassword);
  if (pwErrors.length) return res.status(400).json({ error: 'รหัสผ่านไม่ผ่านนโยบาย', missing: pwErrors });

  try {
    const r = await query('SELECT id, password_hash FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.password_hash) return res.status(400).json({ error: 'บัญชีนี้ล็อกอินด้วย Google เท่านั้น ไม่มีรหัสผ่านให้เปลี่ยน' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
