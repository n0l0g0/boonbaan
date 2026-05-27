const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const { getMikrotikClient } = require('../config/mikrotik');
const { testSmtp, sendEmail } = require('../services/notification');
const { testDriveConnection, uploadFile, generateAuthUrl, exchangeCode, getGDriveConfig } = require('../services/gdrive');

router.get('/', auth, async (req, res) => {
  try {
    const r = await query('SELECT key, value, updated_at FROM settings ORDER BY key');
    const settings = Object.fromEntries(r.rows.map(row => [row.key, row.value]));
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/', auth, async (req, res) => {
  const updates = req.body; // { key: value, ... }
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Body must be an object of key:value pairs' });
  }
  try {
    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Test MikroTik connection with given (or saved) credentials
router.post('/test-mikrotik', auth, async (req, res) => {
  try {
    const { host, port, user, pass, ssl } = req.body;
    const cfg = {
      host: host || process.env.MIKROTIK_HOST,
      port: port || process.env.MIKROTIK_PORT || '443',
      user: user || process.env.MIKROTIK_USER,
      pass: pass || process.env.MIKROTIK_PASS,
      ssl:  ssl !== undefined ? ssl === true || ssl === 'true' : process.env.MIKROTIK_SSL === 'true',
    };
    const mk = getMikrotikClient(cfg);
    const info = await mk.get('/system/identity').then(r => r.data);
    const resource = await mk.get('/system/resource').then(r => r.data);
    res.json({
      ok: true,
      identity: info.name,
      version: resource.version,
      uptime: resource.uptime,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /settings/test-smtp — verify SMTP connection
router.post('/test-smtp', auth, async (req, res) => {
  try {
    const { host, port, user, pass, secure, to } = req.body;
    if (!host || !user) return res.status(400).json({ error: 'host และ user จำเป็น' });
    await testSmtp({ host, port, user, pass, secure });
    // Send test email
    if (to) {
      const transport = require('nodemailer').createTransport({
        host, port: Number(port) || 587, secure: secure === true || secure === 'true',
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
      });
      await transport.sendMail({
        from: `"Boonbaan" <${user}>`,
        to,
        subject: '[Boonbaan] ทดสอบการส่ง Email',
        html: '<p>✅ การตั้งค่า SMTP สำเร็จ — ระบบสามารถส่ง Email ได้</p>',
        text: 'การตั้งค่า SMTP สำเร็จ',
      });
    }
    res.json({ ok: true, message: to ? `ส่ง email ทดสอบถึง ${to} สำเร็จ` : 'SMTP เชื่อมต่อสำเร็จ' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /settings/test-gdrive — verify Google Drive credentials
router.post('/test-gdrive', auth, async (req, res) => {
  try {
    const { credentials, folderId } = req.body;
    if (!credentials) return res.status(400).json({ error: 'กรุณาใส่ Credentials JSON' });
    const cfg = await getGDriveConfig();
    const result = await testDriveConnection(credentials, folderId, cfg.refreshToken);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /settings/gdrive/status — check OAuth2 connection status
router.get('/gdrive/status', auth, async (req, res) => {
  try {
    const cfg = await getGDriveConfig();
    if (!cfg.credentials) return res.json({ connected: false, type: null });
    const credJson = JSON.parse(cfg.credentials);
    if (credJson.type === 'service_account') {
      // Auto-enable — service accounts don't go through OAuth callback
      await query("INSERT INTO settings (key, value, updated_at) VALUES ('gdrive_enabled', 'true', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()").catch(() => {});
      return res.json({ connected: true, type: 'service_account', email: credJson.client_email });
    }
    const web = credJson.web || credJson.installed;
    res.json({ connected: !!cfg.refreshToken, type: 'oauth2', clientId: web?.client_id, hasToken: !!cfg.refreshToken });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /settings/gdrive/auth — start OAuth2 flow (redirect to Google)
router.get('/gdrive/auth', async (req, res) => {
  try {
    const cfg = await getGDriveConfig();
    if (!cfg.credentials) return res.status(400).send('กรุณาบันทึก credentials ก่อน');
    // Use redirect_uris[0] from the credentials JSON (exact match with Google Cloud Console)
    const credJson = JSON.parse(cfg.credentials);
    const web = credJson.web || credJson.installed;
    const redirectUri = web?.redirect_uris?.[0];
    if (!redirectUri) return res.status(400).send('ไม่พบ redirect_uris ใน credentials JSON');
    const url = await generateAuthUrl(cfg.credentials, redirectUri);
    res.redirect(url);
  } catch (err) { res.status(500).send(err.message); }
});

// GET /settings/gdrive/callback — handle OAuth2 callback from Google
router.get('/gdrive/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/#/settings?gdrive=error&msg=${encodeURIComponent(error)}`);
  try {
    const cfg = await getGDriveConfig();
    // Use same redirect_uris[0] from credentials (must match exactly)
    const credJson = JSON.parse(cfg.credentials);
    const web = credJson.web || credJson.installed;
    const redirectUri = web?.redirect_uris?.[0];
    const tokens = await exchangeCode(cfg.credentials, code, redirectUri);
    if (tokens.refresh_token) {
      await query("INSERT INTO settings (key, value, updated_at) VALUES ('gdrive_refresh_token', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [tokens.refresh_token]);
      await query("INSERT INTO settings (key, value, updated_at) VALUES ('gdrive_enabled', 'true', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()");
    }
    res.redirect(`/#/settings?gdrive=connected`);
  } catch (err) {
    res.redirect(`/#/settings?gdrive=error&msg=${encodeURIComponent(err.message)}`);
  }
});

// DELETE /settings/gdrive/disconnect — revoke OAuth2 token
router.delete('/gdrive/disconnect', auth, async (req, res) => {
  try {
    await query("DELETE FROM settings WHERE key = 'gdrive_refresh_token'");
    await query("INSERT INTO settings (key, value, updated_at) VALUES ('gdrive_enabled', 'false', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = NOW()");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /settings/send-report-now — trigger report immediately
router.post('/send-report-now', auth, async (req, res) => {
  try {
    const { type = 'daily' } = req.body; // 'daily' | 'monthly'
    const reportService = require('../services/report.service');
    if (type === 'monthly') await reportService.sendMonthlyReport();
    else await reportService.sendDailyReport();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
