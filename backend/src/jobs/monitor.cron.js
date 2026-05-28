const cron = require('node-cron');
const { collectAll } = require('../services/monitor.service');
const { pollProxyDenyLogs } = require('../services/proxylog.service');
const { pollFirewallDropLogs } = require('../services/firewalllog.service');
const { collectLogs } = require('../services/logcollector.service');
const { sendDailyReport, sendMonthlyReport, uploadDailyLogToDrive } = require('../services/report.service');
const { getSettings } = require('../services/notification');
const { collectSnapshot, cleanup: cleanupSiteUsage } = require('../services/siteusage.service');
const { recordDeviceSnapshot } = require('../services/devices.service');
const { sampleDeviceUsage, cleanupOldUsage } = require('../services/deviceusage.service');
const { evaluateRules } = require('../services/alerts.service');
const { evaluate: evaluateBruteForce } = require('../services/bruteforce.service');
const { pollHotspotNotify } = require('../services/hotspot.notify.service');
const { pollVpnNotify } = require('../services/vpn.notify.service');

let latestStats = null;
let io = null;

function setSocketIo(socketIo) {
  io = socketIo;
}

function getLatestStats() {
  return latestStats;
}

function startMonitorCron() {
  const TZ = 'Asia/Bangkok';

  // System resources + bandwidth every 10s
  cron.schedule('*/10 * * * * *', async () => {
    try {
      latestStats = await collectAll();
      if (io) io.emit('monitor:update', latestStats);
      // Evaluate custom alert rules against latest stats
      evaluateRules(latestStats).catch(e => console.error('Alert eval error:', e.message));
    } catch (err) {
      console.error('Monitor cron error:', err.message);
    }
  });

  // Brute-force auto-block evaluator every 30s — scans recent auth_failure logs
  cron.schedule('*/30 * * * * *', async () => {
    try { await evaluateBruteForce(); }
    catch (err) { console.error('Brute-force eval error:', err.message); }
  });

  // Hotspot login/logout Google Chat notifications every 30s
  cron.schedule('*/30 * * * * *', async () => {
    try { await pollHotspotNotify(); }
    catch (err) { console.error('Hotspot notify error:', err.message); }
  });

  // VPN login/logout Google Chat notifications every 30s
  cron.schedule('*/30 * * * * *', async () => {
    try { await pollVpnNotify(); }
    catch (err) { console.error('VPN notify error:', err.message); }
  });

  // Device history snapshot every 5 min — tracks who connects/disconnects
  cron.schedule('*/5 * * * *', async () => {
    try { await recordDeviceSnapshot(); }
    catch (err) { console.error('Device history error:', err.message); }
  }, { timezone: TZ });

  // Cleanup device_history older than 30 days — runs daily at 3:10 AM
  cron.schedule('10 3 * * *', async () => {
    try { await require('../config/db').query(`DELETE FROM device_history WHERE seen_at < NOW() - INTERVAL '30 days'`); }
    catch (err) { console.error('Device history cleanup error:', err.message); }
  }, { timezone: TZ });

  // Per-device traffic sampling — every 30s. Computes byte deltas from conntrack
  // and aggregates into device_usage_daily.
  cron.schedule('*/30 * * * * *', async () => {
    try { await sampleDeviceUsage(); }
    catch (err) { console.error('Device usage sample error:', err.message); }
  });

  // Daily cleanup of usage rows older than 90 days — 3:15 AM
  cron.schedule('15 3 * * *', async () => {
    try { await cleanupOldUsage(); }
    catch (err) { console.error('Device usage cleanup error:', err.message); }
  }, { timezone: TZ });

  // Proxy deny log polling every 60s (captures HTTP web-proxy denies)
  cron.schedule('*/60 * * * * *', async () => {
    try {
      await pollProxyDenyLogs(io);
    } catch (err) {
      console.error('Proxy log cron error:', err.message);
    }
  });

  // Firewall drop log polling every 30s (captures HTTPS/TCP/UDP blocks via WF-DROP/WF-SNI)
  cron.schedule('*/30 * * * * *', async () => {
    try { await pollFirewallDropLogs(io); }
    catch (err) { console.error('Firewall log cron error:', err.message); }
  });

  // Collect & store MikroTik logs every 10s, emit new ones via socket
  cron.schedule('*/10 * * * * *', async () => {
    try {
      await collectLogs(io);
    } catch (err) {
      console.error('Log collector cron error:', err.message);
    }
  });

  // Standalone Drive log upload — runs every minute, checks configured time (default 00:00)
  let lastDriveLogRun = '';
  cron.schedule('* * * * *', async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
      const currentTime = `${parts.hour}:${parts.minute}`;
      const todayKey = `${parts.year}-${parts.month}-${parts.day}`;

      const { getSettings } = require('../services/notification');
      const s = await getSettings(['gdrive_logs_enabled', 'gdrive_logs_upload_time']);
      const uploadTime = s.gdrive_logs_upload_time || '00:00';

      if (s.gdrive_logs_enabled === 'true' && currentTime === uploadTime && lastDriveLogRun !== todayKey) {
        lastDriveLogRun = todayKey;
        await uploadDailyLogToDrive().catch(e => console.error('Drive log upload error:', e.message));
      }
    } catch (err) { console.error('Drive log cron error:', err.message); }
  }, { timezone: TZ });

  // Check report schedule every minute (reads time setting from DB dynamically)
  // Use Asia/Bangkok timezone so schedule matches user expectation regardless of server TZ
  let lastDailyRun = '';
  let lastMonthlyRun = '';
  cron.schedule('* * * * *', async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
      const currentTime = `${parts.hour}:${parts.minute}`;
      const currentDay = Number(parts.day);
      const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
      const monthKey = `${parts.year}-${parts.month}`;

      const s = await getSettings([
        'report_daily_enabled', 'report_daily_time',
        'report_monthly_enabled', 'report_monthly_time', 'report_monthly_day',
      ]);

      if (s.report_daily_enabled === 'true' && currentTime === (s.report_daily_time || '08:00') && lastDailyRun !== todayKey) {
        lastDailyRun = todayKey;
        await sendDailyReport().catch(e => console.error('Daily report error:', e.message));
      }

      const monthlyDay = Number(s.report_monthly_day) || 1;
      if (s.report_monthly_enabled === 'true' && currentTime === (s.report_monthly_time || '08:00') && currentDay === monthlyDay && lastMonthlyRun !== monthKey) {
        lastMonthlyRun = monthKey;
        await sendMonthlyReport().catch(e => console.error('Monthly report error:', e.message));
      }
    } catch (err) { console.error('Report schedule error:', err.message); }
  }, { timezone: TZ });

  // Site usage snapshot every 5 minutes — DNS cache entries expire by TTL, so frequent
  // sampling avoids missing short-lived visits. 288 snapshots/day × ~2 years ≈ manageable.
  cron.schedule('*/5 * * * *', async () => {
    try { await collectSnapshot(); }
    catch (err) { console.error('Site usage snapshot error:', err.message); }
  }, { timezone: TZ });

  // Cleanup site usage data older than 2 years — runs at 3:05 AM Bangkok time
  cron.schedule('5 3 * * *', async () => {
    try { await cleanupSiteUsage(); }
    catch (err) { console.error('Site usage cleanup error:', err.message); }
  }, { timezone: TZ });

  console.log('Monitor cron started (resources: 10s, proxy/logs: 60s, logs: 10s, site-usage: 5m)');
}

module.exports = { startMonitorCron, setSocketIo, getLatestStats };
