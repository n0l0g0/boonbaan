const router = require('express').Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');
const { query } = require('../config/db');
const { validatePassword } = require('../utils/passwordPolicy');
const { sendEmail, getSetting } = require('../services/notification');
const { logPasswordEvent } = require('../services/auditLog');

const TOKEN_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function issueResetToken(mtId) {
  const secrets = await mikrotik.getPppSecrets();
  const u = secrets.find(x => x['.id'] === mtId);
  if (!u) return { error: 'user not found', status: 404 };
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await query(
    `UPDATE vpn_password_reset_tokens
        SET used_at = NOW()
      WHERE username = $1 AND used_at IS NULL`,
    [u.name]
  );
  await query(
    `INSERT INTO vpn_password_reset_tokens (token, username, mt_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, u.name, u['.id'], expiresAt]
  );
  return { token, user: u, expiresAt };
}

async function resolveBaseUrl(req) {
  const fromDb = await getSetting('public_base_url');
  return (fromDb || process.env.PUBLIC_BASE_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '');
}

router.get('/secrets', auth, async (req, res) => {
  try { res.json(await mikrotik.getPppSecrets()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/secrets', auth, async (req, res) => {
  try { res.json(await mikrotik.addPppSecret(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/secrets/:id', auth, async (req, res) => {
  try {
    const result = await mikrotik.updatePppSecret(req.params.id, req.body);
    if (req.body?.password) {
      const secrets = await mikrotik.getPppSecrets();
      const u = secrets.find(x => x['.id'] === req.params.id);
      if (u?.name) {
        await mikrotik.kickPppByUser(u.name).catch(() => {});
        await logPasswordEvent({ req, service: 'vpn', action: 'admin_changed_password', target: u.name });
      }
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/secrets/:id', auth, async (req, res) => {
  try { await mikrotik.removePppSecret(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/active', auth, async (req, res) => {
  try { res.json(await mikrotik.getPppActive()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/server', auth, async (req, res) => {
  try {
    const [l2tp, pptp] = await Promise.allSettled([mikrotik.getL2tpServer(), mikrotik.getPptpServer()]);
    res.json({ l2tp: l2tp.value, pptp: pptp.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: generate a single-use reset link for a VPN user (TTL 10 min)
router.post('/secrets/:id/reset-token', auth, async (req, res) => {
  try {
    const r = await issueResetToken(req.params.id);
    if (r.error) return res.status(r.status).json({ error: r.error });
    await logPasswordEvent({ req, service: 'vpn', action: 'reset_link_generated', target: r.user.name });
    res.json({ token: r.token, username: r.user.name, expires_at: r.expiresAt.toISOString(), ttl_ms: TOKEN_TTL_MS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: generate reset link and email it (TTL 10 min)
router.post('/secrets/:id/send-reset-email', auth, async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email ไม่ถูกต้อง' });

    const r = await issueResetToken(req.params.id);
    if (r.error) return res.status(r.status).json({ error: r.error });

    const baseUrl = await resolveBaseUrl(req);
    const url = `${baseUrl}/reset-vpn/${r.token}`;
    const minutes = Math.round(TOKEN_TTL_MS / 60000);
    const subject = `รีเซ็ตรหัสผ่าน VPN — ${r.user.name}`;
    const text = [
      `สวัสดีครับ/ค่ะ`,
      ``,
      `เราได้รับคำขอรีเซ็ตรหัสผ่าน VPN สำหรับ username: ${r.user.name}`,
      `กรุณาคลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ ${minutes} นาที):`,
      ``,
      url,
      ``,
      `หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
    ].join('\n');
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
        <p>สวัสดีครับ/ค่ะ</p>
        <p>เราได้รับคำขอรีเซ็ตรหัสผ่าน VPN สำหรับ username: <strong>${r.user.name}</strong></p>
        <p>กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ <strong>${minutes} นาที</strong>):</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#1677ff;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
            ตั้งรหัสผ่านใหม่
          </a>
        </p>
        <p>หรือคัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>
          <a href="${url}">${url}</a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#888;font-size:12px">หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
      </div>
    `;

    const ok = await sendEmail(subject, text, { to: email, html, force: true, rawSubject: true });
    if (!ok) {
      await logPasswordEvent({ req, service: 'vpn', action: 'reset_email_sent', target: r.user.name, status: 'failed', details: { email } });
      return res.status(500).json({ error: 'ส่งอีเมลไม่สำเร็จ — กรุณาตรวจสอบการตั้งค่า SMTP' });
    }
    await logPasswordEvent({ req, service: 'vpn', action: 'reset_email_sent', target: r.user.name, details: { email } });

    res.json({ ok: true, email, username: r.user.name, expires_at: r.expiresAt.toISOString(), ttl_ms: TOKEN_TTL_MS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public: validate token
router.get('/reset/:token', async (req, res) => {
  try {
    const r = await query(
      `SELECT username, expires_at, used_at
         FROM vpn_password_reset_tokens
        WHERE token = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'invalid' });
    const row = r.rows[0];
    if (row.used_at) return res.status(410).json({ error: 'used' });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'expired' });
    res.json({ username: row.username, expires_at: row.expires_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public: consume token + change password
router.post('/reset/:token', async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'missing fields' });
    const issues = validatePassword(newPassword);
    if (issues.length) return res.status(400).json({ error: 'password ไม่ผ่านเงื่อนไข: ' + issues.join(', ') });

    const r = await query(
      `SELECT username, mt_id, expires_at, used_at
         FROM vpn_password_reset_tokens
        WHERE token = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'invalid' });
    const row = r.rows[0];
    if (row.used_at) return res.status(410).json({ error: 'used' });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'expired' });

    const secrets = await mikrotik.getPppSecrets();
    const u = secrets.find(x => x.name === row.username);
    if (!u) return res.status(404).json({ error: 'VPN user หายไป' });

    await mikrotik.updatePppSecret(u['.id'], { password: newPassword });
    await mikrotik.kickPppByUser(u.name).catch(() => {});
    await query(
      `UPDATE vpn_password_reset_tokens SET used_at = NOW() WHERE token = $1`,
      [req.params.token]
    );
    await logPasswordEvent({ req, service: 'vpn', action: 'user_reset_via_link', target: u.name });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
