const mikrotik = require('./mikrotik');
const { sendGoogleChat, getSettings } = require('./notification');

// previous active PPP session map: name -> session object
let prevActive = null;

function thaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

async function pollVpnNotify() {
  const s = await getSettings(['alert_chat_enabled', 'google_chat_webhook', 'vpn_notify_enabled']);
  if (s.vpn_notify_enabled === 'false') return;
  if (s.alert_chat_enabled === 'false') return;
  if (!s.google_chat_webhook) return;

  try {
    const sessions = await mikrotik.getPppActive();
    const current = new Map(sessions.map(sess => [sess.name, sess]));

    if (prevActive !== null) {
      const promises = [];

      // Login: appeared in current but not in prev
      for (const [name, sess] of current) {
        if (!prevActive.has(name)) {
          const msg =
            `🟢 *VPN Login*\n` +
            `👤 User: \`${name}\`\n` +
            `🔌 Service: ${sess.service || '-'}\n` +
            `🌐 IP: ${sess.address || '-'}\n` +
            `📞 Caller: ${sess['caller-id'] || '-'}\n` +
            `🕐 ${thaiTime()}`;
          promises.push(sendGoogleChat(msg).catch(() => {}));
        }
      }

      // Logout: was in prev but not in current
      for (const [name, sess] of prevActive) {
        if (!current.has(name)) {
          const msg =
            `🔴 *VPN Logout*\n` +
            `👤 User: \`${name}\`\n` +
            `🔌 Service: ${sess.service || '-'}\n` +
            `🌐 IP: ${sess.address || '-'}\n` +
            `⏱️ Uptime: ${sess.uptime || '-'}\n` +
            `🕐 ${thaiTime()}`;
          promises.push(sendGoogleChat(msg).catch(() => {}));
        }
      }

      if (promises.length) await Promise.all(promises);
    }

    prevActive = current;
  } catch (err) {
    console.error('VPN notify poll error:', err.message);
  }
}

function resetState() { prevActive = null; }

module.exports = { pollVpnNotify, resetState };
