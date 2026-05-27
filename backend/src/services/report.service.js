const { query } = require('../config/db');
const { sendEmail, sendGoogleChat, getSettings } = require('./notification');
const { uploadFile, generateFileName } = require('./gdrive');
const { getHistoryForDate, getHistoryForMonth } = require('./siteusage.service');

function mbps(bps) {
  return (Number(bps) / 1e6).toFixed(2);
}

function fmtDate(d) {
  return new Date(d).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ── Security data builder ─────────────────────────────────────────────────────

async function buildSecurityData(start, end) {
  const [alertsByLevel, loginFailures, topFailIPs, criticalLogs, recentAlerts] = await Promise.all([
    // Count alerts by level
    query(`SELECT level, COUNT(*) cnt FROM alert_history
           WHERE created_at >= $1 AND created_at < $2 GROUP BY level ORDER BY cnt DESC`, [start, end]),
    // Login failure count
    query(`SELECT COUNT(*) cnt FROM router_logs
           WHERE collected_at >= $1 AND collected_at < $2
             AND (topics LIKE '%critical%' OR topics LIKE '%error%')
             AND message ILIKE '%login failure%'`, [start, end]),
    // Top IPs with login failures
    query(`SELECT src_ip, COUNT(*) cnt FROM router_logs
           WHERE collected_at >= $1 AND collected_at < $2
             AND (topics LIKE '%critical%' OR topics LIKE '%error%')
             AND message ILIKE '%login failure%'
             AND src_ip IS NOT NULL
           GROUP BY src_ip ORDER BY cnt DESC LIMIT 5`, [start, end]),
    // All critical/error log events (non-login)
    query(`SELECT log_time, message, topics FROM router_logs
           WHERE collected_at >= $1 AND collected_at < $2
             AND (topics LIKE '%critical%' OR topics LIKE '%error%')
             AND message NOT ILIKE '%login failure%'
           ORDER BY log_time DESC LIMIT 5`, [start, end]),
    // Recent top alert subjects
    query(`SELECT subject, level, COUNT(*) cnt FROM alert_history
           WHERE created_at >= $1 AND created_at < $2
           GROUP BY subject, level ORDER BY cnt DESC LIMIT 5`, [start, end]),
  ]);

  return {
    alertsByLevel: alertsByLevel.rows,
    loginFailureCount: Number(loginFailures.rows[0]?.cnt) || 0,
    topFailIPs: topFailIPs.rows,
    criticalLogs: criticalLogs.rows,
    recentAlerts: recentAlerts.rows,
  };
}

// ── Daily Report ──────────────────────────────────────────────────────────────

async function buildDailyData() {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = now;

  const [bw, alerts, blocked] = await Promise.all([
    query(`SELECT ROUND(AVG(rx_bps)) rx, ROUND(AVG(tx_bps)) tx, ROUND(MAX(rx_bps)) peak_rx, ROUND(MAX(tx_bps)) peak_tx
           FROM bandwidth_history WHERE recorded_at >= $1 AND recorded_at < $2`, [start, end]),
    query(`SELECT COUNT(*) cnt FROM alert_history WHERE created_at >= $1 AND created_at < $2`, [start, end]),
    query(`SELECT COUNT(*) cnt FROM blocked_access_log WHERE detected_at >= $1 AND detected_at < $2`, [start, end]),
  ]);

  // Pull current device breakdown (snapshot at report time)
  let devices = { total: 0, active: 0, breakdown: [] };
  try {
    const { deviceBreakdown } = require('./devices.service');
    const d = await deviceBreakdown();
    devices = { total: d.total, active: d.active, breakdown: d.breakdown };
  } catch { /* router unreachable — skip device section */ }

  return {
    date: now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' }),
    bw: bw.rows[0] || {},
    alertCount: Number(alerts.rows[0]?.cnt) || 0,
    blockedCount: Number(blocked.rows[0]?.cnt) || 0,
    devices,
  };
}

const EMAIL_BASE = `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5">
<tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
{{CONTENT}}
<tr><td style="padding:20px 0;text-align:center">
  <p style="margin:0;color:#aaa;font-size:11px">สร้างโดย <b>Boonbaan</b> อัตโนมัติ · ห้ามตอบกลับอีเมลนี้</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

function metricCard(icon, label, value, unit, bg, textColor) {
  return `<td width="50%" style="padding:4px">
    <div style="background:${bg};border-radius:10px;padding:16px 18px">
      <div style="font-size:22px;margin-bottom:4px">${icon}</div>
      <div style="color:${textColor || '#fff'};font-size:11px;opacity:0.85;margin-bottom:2px">${label}</div>
      <div style="color:${textColor || '#fff'};font-size:22px;font-weight:700;line-height:1.1">${value}</div>
      <div style="color:${textColor || '#fff'};font-size:11px;opacity:0.75">${unit}</div>
    </div>
  </td>`;
}

function siteBar(name, pct, color, rank) {
  const barWidth = Math.round(Math.min(pct, 100) * 1.4); // max ~140px bar
  const bg = rank % 2 === 0 ? '#fafafa' : '#fff';
  return `<tr style="background:${bg}">
    <td style="padding:9px 12px;color:#888;font-size:12px;width:24px">${rank}</td>
    <td style="padding:9px 4px">
      <div style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></div>
      <span style="font-size:13px;color:#222;font-weight:500">${name}</span>
    </td>
    <td style="padding:9px 12px;width:160px">
      <table cellpadding="0" cellspacing="0" style="width:100%"><tr>
        <td style="width:${barWidth}px;max-width:140px">
          <div style="height:6px;background:${color};border-radius:3px;width:100%"></div>
        </td>
        <td style="width:8px"></td>
        <td style="white-space:nowrap;font-size:12px;color:#555;font-weight:600">${pct}%</td>
      </tr></table>
    </td>
  </tr>`;
}

function buildSiteBlock(sites) {
  if (!sites || sites.length === 0) return '';
  const rows = sites.slice(0, 10).map((s, i) => siteBar(s.name, s.pct, s.color || '#999', i + 1)).join('');
  return `
<tr><td style="padding:8px 0 0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07)">
    <tr style="background:linear-gradient(90deg,#0050b3,#1677ff)">
      <td colspan="3" style="padding:12px 16px;color:#fff;font-weight:700;font-size:14px">
        🌐 เว็บไซต์ที่ใช้มากสุด (Top 10)
      </td>
    </tr>
    ${rows}
    <tr><td colspan="3" style="height:4px"></td></tr>
  </table>
</td></tr>`;
}

const LEVEL_META = {
  critical: { color: '#ff4d4f', bg: '#fff1f0', border: '#ffa39e', icon: '🔴', label: 'Critical' },
  warning:  { color: '#fa8c16', bg: '#fff7e6', border: '#ffd591', icon: '🟠', label: 'Warning' },
  info:     { color: '#1677ff', bg: '#e6f4ff', border: '#91caff', icon: '🔵', label: 'Info' },
};

function buildSecurityBlock(sec) {
  const totalAlerts = sec.alertsByLevel.reduce((s, r) => s + Number(r.cnt), 0);
  const hasDanger = sec.loginFailureCount > 0 || sec.criticalLogs.length > 0;
  const headerBg = hasDanger
    ? 'linear-gradient(90deg,#820014,#cf1322)'
    : 'linear-gradient(90deg,#135200,#389e0d)';
  const headerIcon = hasDanger ? '⚠️' : '✅';
  const headerText = hasDanger ? 'พบเหตุการณ์ที่ต้องตรวจสอบ' : 'ไม่พบเหตุการณ์อันตราย';

  // Alert level badges
  const levelBadges = sec.alertsByLevel.length
    ? sec.alertsByLevel.map(r => {
        const m = LEVEL_META[r.level] || LEVEL_META.info;
        return `<td style="padding:4px">
          <div style="background:${m.bg};border:1px solid ${m.border};border-radius:8px;padding:10px 14px;text-align:center;min-width:70px">
            <div style="font-size:18px;font-weight:800;color:${m.color}">${r.cnt}</div>
            <div style="font-size:11px;color:${m.color};font-weight:600">${m.icon} ${m.label}</div>
          </div></td>`;
      }).join('')
    : `<td><div style="color:#888;font-size:12px;padding:8px">ไม่มีการแจ้งเตือน</div></td>`;

  // Login failure block
  const loginBlock = sec.loginFailureCount > 0 ? `
    <tr><td style="padding:4px 0 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff2f0;border:1px solid #ffccc7;border-radius:8px;overflow:hidden">
        <tr style="background:#ff4d4f">
          <td style="padding:8px 14px;color:#fff;font-weight:700;font-size:13px">
            🔑 Login Failure — ${sec.loginFailureCount} ครั้ง
          </td>
        </tr>
        ${sec.topFailIPs.length ? sec.topFailIPs.map((row, i) => `
          <tr style="background:${i % 2 ? '#fff' : '#fff2f0'}">
            <td style="padding:7px 14px;font-size:12px;color:#333">
              <b style="color:#cf1322">${row.src_ip}</b>
              <span style="color:#888;margin-left:8px">${row.cnt} ครั้ง</span>
            </td>
          </tr>`).join('') : `<tr><td style="padding:8px 14px;font-size:12px;color:#888">ไม่ระบุ IP</td></tr>`}
      </table>
    </td></tr>` : '';

  // Recent alerts
  const alertRows = sec.recentAlerts.length
    ? sec.recentAlerts.map((r, i) => {
        const m = LEVEL_META[r.level] || LEVEL_META.info;
        return `<tr style="background:${i % 2 ? '#fff' : '#fafafa'}">
          <td style="padding:7px 12px;width:20px">${m.icon}</td>
          <td style="padding:7px 4px;font-size:12px;color:#333">${r.subject}</td>
          <td style="padding:7px 12px;text-align:right;font-size:12px;font-weight:600;color:${m.color}">${r.cnt}x</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:10px 12px;color:#888;font-size:12px">ไม่มีการแจ้งเตือน</td></tr>`;

  // Critical system logs
  const critBlock = sec.criticalLogs.length ? `
    <tr><td style="padding:8px 0 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #ffccc7;border-radius:8px;overflow:hidden">
        <tr style="background:#ff7875">
          <td style="padding:7px 14px;color:#fff;font-weight:700;font-size:12px">⚡ System Critical Logs</td>
        </tr>
        ${sec.criticalLogs.map((r, i) => `
          <tr style="background:${i % 2 ? '#fff' : '#fff9f9'}">
            <td style="padding:6px 14px">
              <div style="font-size:11px;color:#cf1322;font-family:monospace">${r.message?.slice(0, 90)}${r.message?.length > 90 ? '…' : ''}</div>
              <div style="font-size:10px;color:#aaa;margin-top:2px">${r.log_time ? new Date(r.log_time).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : ''}</div>
            </td>
          </tr>`).join('')}
      </table>
    </td></tr>` : '';

  return `
<tr><td style="padding:8px 0 0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07)">
    <tr style="background:${headerBg}">
      <td style="padding:12px 16px;color:#fff;font-weight:700;font-size:14px">
        ${headerIcon} ความปลอดภัย — ${headerText}
      </td>
    </tr>
    <tr><td style="padding:12px 12px 4px">
      <div style="font-size:11px;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">การแจ้งเตือนทั้งหมด ${totalAlerts} รายการ</div>
      <table cellpadding="0" cellspacing="0"><tr>${levelBadges}</tr></table>
    </td></tr>
    ${loginBlock}
    <tr><td style="padding:8px 0 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #f0f0f0">
        <tr style="background:#f5f5f5">
          <td colspan="3" style="padding:7px 12px;font-size:12px;font-weight:700;color:#555">📋 การแจ้งเตือนที่เกิดบ่อย</td>
        </tr>
        ${alertRows}
      </table>
    </td></tr>
    ${critBlock}
    <tr><td style="height:12px"></td></tr>
  </table>
</td></tr>`;
}

// Render device breakdown block — counts by type with colored progress bars
function buildDeviceBlock(devices) {
  if (!devices || !devices.active) return '';
  const TYPE_META = {
    mobile:   { label: '📱 Mobile',   color: '#1677ff' },
    computer: { label: '💻 Computer', color: '#52c41a' },
    iot:      { label: '☁️ IoT/TV',   color: '#faad14' },
    network:  { label: '🔌 Network',  color: '#722ed1' },
    unknown:  { label: '❔ Unknown',  color: '#8c8c8c' },
  };
  const rows = devices.breakdown.map(b => {
    const meta = TYPE_META[b.type] || TYPE_META.unknown;
    const barWidth = Math.max(2, Math.min(100, b.pct));
    return `
      <tr>
        <td style="padding:6px 12px;font-size:13px;color:#333;width:32%">${meta.label}</td>
        <td style="padding:6px 8px;width:48%">
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            <td style="background:#f0f0f0;height:8px;border-radius:4px;overflow:hidden">
              <table cellpadding="0" cellspacing="0" width="${barWidth}%" style="height:8px"><tr>
                <td style="background:${meta.color};height:8px;border-radius:4px;font-size:0">&nbsp;</td>
              </tr></table>
            </td>
          </tr></table>
        </td>
        <td style="padding:6px 12px;text-align:right;font-size:13px;color:${meta.color};font-weight:600;width:20%">
          ${b.count} <span style="color:#aaa;font-weight:400;font-size:11px">(${b.pct}%)</span>
        </td>
      </tr>`;
  }).join('');

  return `
<tr><td style="padding:8px 0 16px">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #f0f0f0">
    <tr style="background:#fafafa">
      <td colspan="3" style="padding:10px 12px">
        <div style="font-size:13px;font-weight:700;color:#333">📡 อุปกรณ์ที่เชื่อมต่อ</div>
        <div style="font-size:11px;color:#888;margin-top:2px">${devices.active} เครื่อง active จาก ${devices.total} เครื่องทั้งหมด</div>
      </td>
    </tr>
    ${rows}
  </table>
</td></tr>`;
}

function buildDailyHtml(d, sites, sec) {
  const alertColor = d.alertCount > 0 ? '#ff4d4f' : '#52c41a';
  const blockColor  = d.blockedCount > 0 ? '#ff7875' : '#52c41a';

  const content = `
<tr><td>
  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#003eb3 0%,#1677ff 100%);border-radius:14px 14px 0 0">
    <tr>
      <td style="padding:28px 28px 22px">
        <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-bottom:4px;letter-spacing:1px;text-transform:uppercase">Boonbaan</div>
        <div style="font-size:26px;font-weight:800;color:#fff;line-height:1.2">📊 รายงานประจำวัน</div>
        <div style="font-size:15px;color:rgba(255,255,255,0.85);margin-top:6px">${d.date}</div>
      </td>
    </tr>
  </table>

  <!-- Metric cards -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px">
    <tr><td style="padding:16px 0 8px"><table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${metricCard('⬇️', 'เฉลี่ย Download', mbps(d.bw.rx), 'Mbps', 'linear-gradient(135deg,#0958d9,#4096ff)')}
      ${metricCard('⬆️', 'เฉลี่ย Upload', mbps(d.bw.tx), 'Mbps', 'linear-gradient(135deg,#389e0d,#73d13d)')}
    </tr><tr>
      ${metricCard('📈', 'Peak Download', mbps(d.bw.peak_rx), 'Mbps', 'linear-gradient(135deg,#531dab,#9254de)')}
      ${metricCard('📉', 'Peak Upload', mbps(d.bw.peak_tx), 'Mbps', 'linear-gradient(135deg,#08979c,#36cfc9)')}
    </tr></table></td></tr>

    <!-- Alerts & Blocked row -->
    <tr><td style="padding:4px 0 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${metricCard('🔔', 'การแจ้งเตือน', d.alertCount, 'ครั้ง', d.alertCount > 0 ? 'linear-gradient(135deg,#d4380d,#ff7a45)' : 'linear-gradient(135deg,#237804,#52c41a)')}
      ${metricCard('🚫', 'เว็บที่ถูก Block', d.blockedCount, 'ครั้ง', d.blockedCount > 0 ? 'linear-gradient(135deg,#820014,#ff4d4f)' : 'linear-gradient(135deg,#237804,#52c41a)')}
    </tr></table></td></tr>
  </table>

  <!-- Connected devices breakdown -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px 0">
    ${buildDeviceBlock(d.devices)}
  </table>

  <!-- Security -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px 0">
    ${buildSecurityBlock(sec)}
  </table>

  <!-- Site usage -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px 16px">
    ${buildSiteBlock(sites)}
  </table>

  <!-- Footer bar -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#001d66;border-radius:0 0 14px 14px">
    <tr><td style="padding:14px 24px">
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px">
        สร้างเมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · MikroTik Network Manager
      </p>
    </td></tr>
  </table>
</td></tr>`;

  return EMAIL_BASE.replace('{{CONTENT}}', content);
}

function buildDailyText(d) {
  const deviceLines = d.devices?.breakdown?.length
    ? `\nอุปกรณ์เชื่อมต่อ: ${d.devices.active}/${d.devices.total} active\n` +
      d.devices.breakdown.map(b => `  · ${b.label}: ${b.count} (${b.pct}%)`).join('\n')
    : '';
  return `รายงานประจำวัน — ${d.date}
เฉลี่ย Download: ${mbps(d.bw.rx)} Mbps | Upload: ${mbps(d.bw.tx)} Mbps
Peak Download: ${mbps(d.bw.peak_rx)} Mbps | Peak Upload: ${mbps(d.bw.peak_tx)} Mbps
การแจ้งเตือน: ${d.alertCount} ครั้ง
การเข้าเว็บที่ถูก Block: ${d.blockedCount} ครั้ง${deviceLines}`;
}

async function sendDailyReport() {
  const s = await getSettings(['report_daily_enabled', 'smtp_to', 'report_recipients', 'gdrive_logs_enabled']);
  if (s.report_daily_enabled !== 'true') return;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const [d, sites, sec] = await Promise.all([
    buildDailyData(),
    getHistoryForDate(todayStr).catch(() => []),
    buildSecurityData(dayStart, now).catch(() => ({ alertsByLevel: [], loginFailureCount: 0, topFailIPs: [], criticalLogs: [], recentAlerts: [] })),
  ]);
  const html = buildDailyHtml(d, sites, sec);
  const text = buildDailyText(d);
  const to = s.report_recipients || s.smtp_to;

  await sendEmail(`รายงานประจำวัน — ${d.date}`, text, { html, to, rawSubject: true, force: true });

  // Upload log CSV to Google Drive if enabled
  if (s.gdrive_logs_enabled === 'true') {
    try {
      const rows = await query(`SELECT detected_at, src_ip, dst_host FROM blocked_access_log WHERE detected_at >= NOW() - INTERVAL '1 day' ORDER BY detected_at DESC`);
      const csv = ['เวลา,IP ต้นทาง,เว็บไซต์', ...rows.rows.map(r => `${fmtDate(r.detected_at)},${r.src_ip},${r.dst_host}`)].join('\n');
      const fname = generateFileName('blocked-log-daily', 'csv');
      const driveFile = await uploadFile(csv, fname, 'text/csv');
      if (driveFile) {
        const ts = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
        sendGoogleChat(
          `📋 *Blocked Log รายวัน อัปโหลดสำเร็จ*\n` +
          `📄 ไฟล์: \`${fname}\`\n` +
          `🚫 รายการ Block: ${rows.rows.length} รายการ\n` +
          `🔗 ${driveFile.webViewLink}\n` +
          `🕐 ${ts}`
        ).catch(() => {});
      }
    } catch (e) { console.error('GDrive upload failed:', e.message); }
  }
}

// ── Monthly Report ────────────────────────────────────────────────────────────

async function buildMonthlyData() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthName = start.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });

  const [bw, alerts, blocked, topBlocked] = await Promise.all([
    query(`SELECT ROUND(AVG(rx_bps)) rx, ROUND(AVG(tx_bps)) tx, ROUND(MAX(rx_bps)) peak_rx, ROUND(MAX(tx_bps)) peak_tx
           FROM bandwidth_history WHERE recorded_at >= $1 AND recorded_at < $2`, [start, end]),
    query(`SELECT level, COUNT(*) cnt FROM alert_history WHERE created_at >= $1 AND created_at < $2 GROUP BY level`, [start, end]),
    query(`SELECT COUNT(*) cnt FROM blocked_access_log WHERE detected_at >= $1 AND detected_at < $2`, [start, end]),
    query(`SELECT dst_host, COUNT(*) cnt FROM blocked_access_log WHERE detected_at >= $1 AND detected_at < $2 GROUP BY dst_host ORDER BY cnt DESC LIMIT 5`, [start, end]),
  ]);

  return { monthName, start, end, bw: bw.rows[0] || {}, alerts: alerts.rows, blockedTotal: Number(blocked.rows[0]?.cnt) || 0, topBlocked: topBlocked.rows };
}

const ALERT_LEVEL_COLOR = { critical: '#ff4d4f', warning: '#faad14', info: '#1677ff' };

function buildMonthlyHtml(d, sites, sec) {
  const alertSummary = d.alerts.length
    ? d.alerts.map(a => {
        const c = ALERT_LEVEL_COLOR[a.level] || '#888';
        return `<td style="padding:4px">
          <div style="background:${c}18;border:1px solid ${c}40;border-radius:8px;padding:12px 16px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:${c}">${a.cnt}</div>
            <div style="font-size:11px;color:#555;text-transform:capitalize">${a.level}</div>
          </div></td>`;
      }).join('')
    : `<td><div style="color:#888;font-size:13px;padding:12px">ไม่มีการแจ้งเตือนในเดือนนี้</div></td>`;

  const topBlockedRows = d.topBlocked.length
    ? d.topBlocked.map((r, i) => `
        <tr style="background:${i % 2 ? '#fff' : '#fafafa'}">
          <td style="padding:8px 12px;color:#888;font-size:12px">${i + 1}</td>
          <td style="padding:8px 4px;font-size:13px;color:#222">${r.dst_host}</td>
          <td style="padding:8px 12px;text-align:right;font-size:13px;font-weight:600;color:#ff4d4f">${r.cnt} ครั้ง</td>
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#888;font-size:13px">ไม่มีการ Block ในเดือนนี้</td></tr>`;

  const content = `
<tr><td>
  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#391085 0%,#722ed1 100%);border-radius:14px 14px 0 0">
    <tr>
      <td style="padding:28px 28px 22px">
        <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-bottom:4px;letter-spacing:1px;text-transform:uppercase">Boonbaan</div>
        <div style="font-size:26px;font-weight:800;color:#fff;line-height:1.2">📅 รายงานประจำเดือน</div>
        <div style="font-size:15px;color:rgba(255,255,255,0.85);margin-top:6px">${d.monthName}</div>
      </td>
    </tr>
  </table>

  <!-- Bandwidth cards -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px">
    <tr><td style="padding:16px 0 4px">
      <div style="font-size:13px;font-weight:700;color:#555;letter-spacing:0.5px;padding:0 4px 8px;text-transform:uppercase">📶 Bandwidth</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${metricCard('⬇️', 'เฉลี่ย Download', mbps(d.bw.rx), 'Mbps', 'linear-gradient(135deg,#0958d9,#4096ff)')}
        ${metricCard('⬆️', 'เฉลี่ย Upload', mbps(d.bw.tx), 'Mbps', 'linear-gradient(135deg,#389e0d,#73d13d)')}
      </tr><tr>
        ${metricCard('📈', 'Peak Download', mbps(d.bw.peak_rx), 'Mbps', 'linear-gradient(135deg,#531dab,#9254de)')}
        ${metricCard('📉', 'Peak Upload', mbps(d.bw.peak_tx), 'Mbps', 'linear-gradient(135deg,#08979c,#36cfc9)')}
      </tr></table>
    </td></tr>

    <!-- Blocked summary card -->
    <tr><td style="padding:8px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(90deg,#820014,#cf1322);border-radius:10px">
        <tr>
          <td style="padding:14px 20px;color:#fff">
            <span style="font-size:28px;font-weight:800">${d.blockedTotal}</span>
            <span style="font-size:14px;margin-left:8px;opacity:0.85">ครั้ง — เว็บที่ถูก Block รวมทั้งเดือน</span>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- Alerts -->
    <tr><td style="padding:4px 0 8px">
      <div style="font-size:13px;font-weight:700;color:#555;letter-spacing:0.5px;padding:4px 4px 10px;text-transform:uppercase">🔔 การแจ้งเตือน</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>${alertSummary}</tr></table>
    </td></tr>

    <!-- Top blocked sites -->
    <tr><td style="padding:8px 0 16px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #f0f0f0;border-radius:10px;overflow:hidden">
        <tr style="background:#fff1f0">
          <td colspan="3" style="padding:11px 14px;font-size:13px;font-weight:700;color:#cf1322">🚫 เว็บที่ถูก Block บ่อยสุด (Top 5)</td>
        </tr>
        ${topBlockedRows}
      </table>
    </td></tr>
  </table>

  <!-- Security -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px 0">
    ${buildSecurityBlock(sec)}
  </table>

  <!-- Site usage -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:0 12px 16px">
    ${buildSiteBlock(sites)}
  </table>

  <!-- Footer -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#120338;border-radius:0 0 14px 14px">
    <tr><td style="padding:14px 24px">
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:11px">
        สร้างเมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · MikroTik Network Manager
      </p>
    </td></tr>
  </table>
</td></tr>`;

  return EMAIL_BASE.replace('{{CONTENT}}', content);
}

async function sendMonthlyReport() {
  const s = await getSettings(['report_monthly_enabled', 'smtp_to', 'report_recipients', 'gdrive_logs_enabled']);
  if (s.report_monthly_enabled !== 'true') return;

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);
  const [d, sites, sec] = await Promise.all([
    buildMonthlyData(),
    getHistoryForMonth(yearMonth).catch(() => []),
    buildSecurityData(monthStart, monthEnd).catch(() => ({ alertsByLevel: [], loginFailureCount: 0, topFailIPs: [], criticalLogs: [], recentAlerts: [] })),
  ]);
  const html = buildMonthlyHtml(d, sites, sec);
  const text = `รายงานประจำเดือน — ${d.monthName}\nBandwidth เฉลี่ย: DL ${mbps(d.bw.rx)} / UL ${mbps(d.bw.tx)} Mbps\nBlock รวม: ${d.blockedTotal} ครั้ง`;
  const to = s.report_recipients || s.smtp_to;

  await sendEmail(`รายงานประจำเดือน — ${d.monthName}`, text, { html, to, rawSubject: true, force: true });

  // Upload monthly blocked log to Google Drive
  if (s.gdrive_logs_enabled === 'true') {
    try {
      const rows = await query(`SELECT detected_at, src_ip, dst_host FROM blocked_access_log WHERE detected_at >= $1 AND detected_at < $2 ORDER BY detected_at DESC`, [d.start, d.end]);
      const csv = ['เวลา,IP ต้นทาง,เว็บไซต์', ...rows.rows.map(r => `${fmtDate(r.detected_at)},${r.src_ip},${r.dst_host}`)].join('\n');
      const fname = generateFileName('blocked-log-monthly', 'csv');
      const driveFile = await uploadFile(csv, fname, 'text/csv');
      if (driveFile) {
        const ts = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
        sendGoogleChat(
          `📊 *Blocked Log รายเดือน อัปโหลดสำเร็จ*\n` +
          `📅 เดือน: ${d.monthName}\n` +
          `📄 ไฟล์: \`${fname}\`\n` +
          `🚫 รายการ Block: ${rows.rows.length} รายการ\n` +
          `🔗 ${driveFile.webViewLink}\n` +
          `🕐 ${ts}`
        ).catch(() => {});
      }
    } catch (e) { console.error('GDrive monthly upload failed:', e.message); }
  }
}

module.exports = { sendDailyReport, sendMonthlyReport };
