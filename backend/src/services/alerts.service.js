const { query } = require('../config/db');
const { notify } = require('./notification');
const { listConnectedDevices } = require('./devices.service');

// Available metrics that custom alert rules can monitor
const METRICS = {
  cpu:           { label: 'CPU %',             unit: '%' },
  memory:        { label: 'Memory %',          unit: '%' },
  disk:          { label: 'Disk %',            unit: '%' },
  rx_pct:        { label: 'WAN RX %',          unit: '%' },
  tx_pct:        { label: 'WAN TX %',          unit: '%' },
  device_total:  { label: 'Total devices',     unit: '' },
  device_mobile: { label: 'Mobile devices',    unit: '' },
  device_computer: { label: 'Computer devices', unit: '' },
  device_iot:    { label: 'IoT devices',       unit: '' },
  device_unknown: { label: 'Unknown devices',  unit: '' },
};

const COMPARATORS = ['>', '>=', '<', '<=', '=='];

function compare(value, op, threshold) {
  switch (op) {
    case '>':  return value >  threshold;
    case '>=': return value >= threshold;
    case '<':  return value <  threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    default:   return false;
  }
}

// Track when a rule first started matching (for duration_minutes support)
const ruleMatchSince = new Map(); // ruleId -> timestamp ms

async function evaluateRules(stats) {
  const r = await query('SELECT * FROM alert_rules WHERE enabled = true');
  if (r.rows.length === 0) return;

  // Lazy-load device counts only when needed
  let deviceCounts = null;
  async function getDeviceCounts() {
    if (deviceCounts) return deviceCounts;
    try {
      const devices = await listConnectedDevices();
      const active = devices.filter(d => d.active);
      deviceCounts = { total: active.length, mobile: 0, computer: 0, iot: 0, unknown: 0, network: 0 };
      for (const d of active) deviceCounts[d.type] = (deviceCounts[d.type] || 0) + 1;
    } catch { deviceCounts = {}; }
    return deviceCounts;
  }

  for (const rule of r.rows) {
    let value;
    switch (rule.metric) {
      case 'cpu':    value = stats.resources?.cpu; break;
      case 'memory': value = stats.resources?.memPct; break;
      case 'disk':   value = stats.resources?.diskPct; break;
      case 'rx_pct': value = stats.bandwidth?.rxPct; break;
      case 'tx_pct': value = stats.bandwidth?.txPct; break;
      case 'device_total':    { const c = await getDeviceCounts(); value = c.total; break; }
      case 'device_mobile':   { const c = await getDeviceCounts(); value = c.mobile; break; }
      case 'device_computer': { const c = await getDeviceCounts(); value = c.computer; break; }
      case 'device_iot':      { const c = await getDeviceCounts(); value = c.iot; break; }
      case 'device_unknown':  { const c = await getDeviceCounts(); value = c.unknown; break; }
      default: continue;
    }
    if (value === undefined || value === null) continue;

    const matches = compare(Number(value), rule.comparator, Number(rule.threshold));
    const durationMs = (rule.duration_minutes || 0) * 60_000;
    const now = Date.now();

    if (matches) {
      if (!ruleMatchSince.has(rule.id)) ruleMatchSince.set(rule.id, now);
      const matchedFor = now - ruleMatchSince.get(rule.id);

      if (matchedFor >= durationMs) {
        // Cooldown: 10 min between fires for the same rule
        const lastFire = rule.last_triggered ? new Date(rule.last_triggered).getTime() : 0;
        if (now - lastFire >= 10 * 60_000) {
          const metricInfo = METRICS[rule.metric] || { label: rule.metric, unit: '' };
          const msg = `${metricInfo.label} = ${Number(value).toFixed(1)}${metricInfo.unit} (rule: ${rule.comparator} ${rule.threshold}${metricInfo.unit}${rule.duration_minutes ? ` for ${rule.duration_minutes}m` : ''})`;
          await notify(rule.severity || 'warning', `Alert: ${rule.name}`, msg).catch(() => {});
          await query('UPDATE alert_rules SET last_triggered = NOW() WHERE id = $1', [rule.id]).catch(() => {});
        }
      }
    } else {
      ruleMatchSince.delete(rule.id);
    }
  }
}

module.exports = { METRICS, COMPARATORS, evaluateRules };
