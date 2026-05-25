const nodemailer = require('nodemailer');
const axios = require('axios');
const { query } = require('../config/db');
const { sendLineNotify } = require('./linenotify');

async function getSetting(key) {
  try {
    const r = await query('SELECT value FROM settings WHERE key = $1', [key]);
    return r.rows[0]?.value || null;
  } catch { return null; }
}

async function getSettings(keys) {
  try {
    const r = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    return Object.fromEntries(r.rows.map(row => [row.key, row.value]));
  } catch { return {}; }
}

// Build a fresh transporter from DB settings each call (supports runtime config changes)
async function createTransporter() {
  const s = await getSettings(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure']);
  const host = s.smtp_host || process.env.SMTP_HOST;
  const user = s.smtp_user || process.env.SMTP_USER;
  const pass = s.smtp_pass || process.env.SMTP_PASS;
  if (!host || !user) return null;
  return nodemailer.createTransport({
    host,
    port: Number(s.smtp_port || process.env.SMTP_PORT) || 587,
    secure: s.smtp_secure === 'true',
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

async function sendEmail(subject, body, options = {}) {
  const s = await getSettings(['alert_email_enabled', 'smtp_from', 'smtp_to']);
  const enabled = options.force || s.alert_email_enabled !== 'false';
  if (!enabled) return false;
  const to = options.to || s.smtp_to || process.env.ALERT_EMAIL_TO;
  if (!to) return false;
  try {
    const transport = await createTransporter();
    if (!transport) return false;
    const from = s.smtp_from || s.smtp_user || process.env.SMTP_USER;
    await transport.sendMail({
      from: `"Boonbaan" <${from}>`,
      to,
      subject: options.rawSubject ? subject : `[MikroTik Alert] ${subject}`,
      html: options.html || body.replace(/\n/g, '<br>'),
      text: body,
    });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

async function testSmtp(cfg) {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: cfg.secure === true || cfg.secure === 'true',
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: false },
  });
  await transport.verify();
  return true;
}

async function sendGoogleChat(text) {
  const s = await getSettings(['alert_chat_enabled', 'google_chat_webhook']);
  if (s.alert_chat_enabled === 'false') return false;
  const webhook = s.google_chat_webhook || process.env.GOOGLE_CHAT_WEBHOOK;
  if (!webhook) return false;
  try {
    await axios.post(webhook, { text });
    return true;
  } catch (err) {
    console.error('Google Chat send failed:', err.message);
    return false;
  }
}

async function notify(level, subject, body) {
  const emoji = level === 'critical' ? '🔴' : '🟡';
  const message = `${emoji} *${subject}*\n${body}`;

  const [emailOk, chatOk] = await Promise.all([
    sendEmail(subject, body),
    sendGoogleChat(message),
    sendLineNotify(`${emoji} ${subject}\n${body}`),
  ]);

  query(
    `INSERT INTO alert_history (level, subject, body, notified_email, notified_chat) VALUES ($1, $2, $3, $4, $5)`,
    [level, subject, body, emailOk, chatOk]
  ).catch(() => {});
}

module.exports = { notify, sendEmail, sendGoogleChat, testSmtp, getSetting, getSettings };
