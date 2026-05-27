const mikrotik = require('./mikrotik');
const { sendGoogleChat, getSettings } = require('./notification');

// previous active session map: user -> { address, 'mac-address' }
let prevActive = null;

function thaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

async function pollHotspotNotify() {
  // Respect the global Google Chat toggle
  const s = await getSettings(['alert_chat_enabled', 'google_chat_webhook', 'hotspot_notify_enabled']);
  if (s.hotspot_notify_enabled === 'false') return;
  if (s.alert_chat_enabled === 'false') return;
  if (!s.google_chat_webhook) return;

  try {
    const sessions = await mikrotik.getHotspotActive();
    const current = new Map(sessions.map(sess => [sess.user, sess]));

    if (prevActive !== null) {
      const promises = [];

      // Login: appeared in current but not in prev
      for (const [user, sess] of current) {
        if (!prevActive.has(user)) {
          const msg =
            `🟢 *Hotspot Login*\n` +
            `👤 User: \`${user}\`\n` +
            `🌐 IP: ${sess.address || '-'}\n` +
            `📡 MAC: ${sess['mac-address'] || '-'}\n` +
            `🕐 ${thaiTime()}`;
          promises.push(sendGoogleChat(msg).catch(() => {}));
        }
      }

      // Logout: was in prev but not in current
      for (const [user, sess] of prevActive) {
        if (!current.has(user)) {
          const msg =
            `🔴 *Hotspot Logout*\n` +
            `👤 User: \`${user}\`\n` +
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
    console.error('Hotspot notify poll error:', err.message);
  }
}

// Allow external reset (e.g. on test/restart)
function resetState() { prevActive = null; }

module.exports = { pollHotspotNotify, resetState };
