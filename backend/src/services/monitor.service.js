const mikrotik = require('./mikrotik');
const { notify } = require('./notification');
const { query } = require('../config/db');
const { getMikrotikClient } = require('../config/mikrotik');

let WARNING = Number(process.env.THRESHOLD_WARNING) || 80;
let CRITICAL = Number(process.env.THRESHOLD_CRITICAL) || 90;
// Multi-WAN: list of { name, bandwidth_mbps, label }
let WAN_LIST = [{ name: process.env.WAN_INTERFACE || 'ether1', bandwidth_mbps: Number(process.env.WAN_BANDWIDTH_MBPS) || 100, label: 'WAN' }];

// Reload thresholds + WAN list from DB settings at runtime
async function loadSettings() {
  try {
    const r = await query(`SELECT key, value FROM settings WHERE key IN ('threshold_warning','threshold_critical','wan_interfaces','wan_bandwidth_mbps','wan_interface')`);
    let parsedList = null, legacyIf = null, legacyBw = null;
    for (const row of r.rows) {
      if (row.key === 'threshold_warning') WARNING = Number(row.value);
      if (row.key === 'threshold_critical') CRITICAL = Number(row.value);
      if (row.key === 'wan_interfaces') {
        try { parsedList = JSON.parse(row.value); } catch { /* invalid JSON, ignore */ }
      }
      if (row.key === 'wan_interface') legacyIf = row.value;
      if (row.key === 'wan_bandwidth_mbps') legacyBw = Number(row.value);
    }
    if (Array.isArray(parsedList) && parsedList.length) {
      WAN_LIST = parsedList.filter(w => w && w.name).map(w => ({
        name: w.name, bandwidth_mbps: Number(w.bandwidth_mbps) || 100, label: w.label || w.name,
      }));
    } else if (legacyIf) {
      WAN_LIST = [{ name: legacyIf, bandwidth_mbps: legacyBw || 100, label: legacyIf }];
    }
  } catch { /* DB not ready yet, use env defaults */ }
}

// Cooldown: prevent alert spam (5 min per key)
const lastAlert = {};
function canAlert(key) {
  const now = Date.now();
  if (!lastAlert[key] || now - lastAlert[key] > 5 * 60 * 1000) {
    lastAlert[key] = now;
    return true;
  }
  return false;
}

async function checkThreshold(key, value, label) {
  if (value >= CRITICAL && canAlert(`${key}_critical`)) {
    await notify('critical', `${label} Critical`, `${label} is at ${value.toFixed(1)}% (threshold: ${CRITICAL}%)`);
  } else if (value >= WARNING && canAlert(`${key}_warning`)) {
    await notify('warning', `${label} Warning`, `${label} is at ${value.toFixed(1)}% (threshold: ${WARNING}%)`);
  }
}

async function pollResources() {
  const res = await mikrotik.getResource();
  const cpu = Number(res['cpu-load']) || 0;
  const totalMem = Number(res['total-memory']) || 1;
  const freeMem = Number(res['free-memory']) || 0;
  const totalDisk = Number(res['total-hdd-space']) || 1;
  const freeDisk = Number(res['free-hdd-space']) || 0;

  const memPct = ((totalMem - freeMem) / totalMem) * 100;
  const diskPct = ((totalDisk - freeDisk) / totalDisk) * 100;

  await Promise.all([
    checkThreshold('cpu', cpu, 'CPU'),
    checkThreshold('memory', memPct, 'Memory'),
    checkThreshold('disk', diskPct, 'Disk'),
  ]);

  return { cpu, memPct: +memPct.toFixed(1), diskPct: +diskPct.toFixed(1), uptime: res.uptime, version: res.version };
}

// Per-WAN previous byte counters for delta calculation
const prevBytesMap = new Map(); // name -> { rxByte, txByte, ts }

async function pollSingleWan(c, wan, now) {
  try {
    const iface = await c.get(`/interface/${encodeURIComponent(wan.name)}`).then(r => r.data);
    const rxByte = Number(iface['rx-byte']) || 0;
    const txByte = Number(iface['tx-byte']) || 0;
    const prev = prevBytesMap.get(wan.name);
    let rxBps = 0, txBps = 0;
    if (prev && now > prev.ts) {
      const dtSec = (now - prev.ts) / 1000;
      rxBps = Math.max(0, (rxByte - prev.rxByte) / dtSec) * 8;
      txBps = Math.max(0, (txByte - prev.txByte) / dtSec) * 8;
    }
    prevBytesMap.set(wan.name, { rxByte, txByte, ts: now });

    const cap = (wan.bandwidth_mbps || 100) * 1_000_000;
    const rxPct = (rxBps / cap) * 100;
    const txPct = (txBps / cap) * 100;
    const online = iface.running === 'true';

    if (rxPct >= CRITICAL && canAlert(`bw_rx_${wan.name}_critical`)) {
      await notify('critical', `${wan.label} RX Critical`, `RX is at ${rxPct.toFixed(1)}% of ${wan.bandwidth_mbps} Mbps`);
    } else if (rxPct >= WARNING && canAlert(`bw_rx_${wan.name}_warning`)) {
      await notify('warning', `${wan.label} RX Warning`, `RX is at ${rxPct.toFixed(1)}% of ${wan.bandwidth_mbps} Mbps`);
    }

    return {
      name: wan.name, label: wan.label, bandwidth_mbps: wan.bandwidth_mbps,
      rxBps: Math.round(rxBps), txBps: Math.round(txBps),
      rxPct: +rxPct.toFixed(1), txPct: +txPct.toFixed(1), online,
    };
  } catch {
    return {
      name: wan.name, label: wan.label, bandwidth_mbps: wan.bandwidth_mbps,
      rxBps: 0, txBps: 0, rxPct: 0, txPct: 0, online: false,
    };
  }
}

async function pollBandwidth() {
  try {
    const c = await getMikrotikClient.fromDB();
    const now = Date.now();
    const wans = await Promise.all(WAN_LIST.map(w => pollSingleWan(c, w, now)));

    const totalRx = wans.reduce((s, w) => s + w.rxBps, 0);
    const totalTx = wans.reduce((s, w) => s + w.txBps, 0);
    const totalCap = WAN_LIST.reduce((s, w) => s + (w.bandwidth_mbps || 0), 0) * 1_000_000 || 1;
    const rxPct = (totalRx / totalCap) * 100;
    const txPct = (totalTx / totalCap) * 100;

    await query(
      `INSERT INTO bandwidth_history (rx_bps, tx_bps, rx_pct, tx_pct) VALUES ($1, $2, $3, $4)`,
      [totalRx, totalTx, +rxPct.toFixed(2), +txPct.toFixed(2)]
    ).catch(() => {});
    query(`DELETE FROM bandwidth_history WHERE recorded_at < NOW() - INTERVAL '7 days'`).catch(() => {});

    return { rxBps: totalRx, txBps: totalTx, rxPct: +rxPct.toFixed(1), txPct: +txPct.toFixed(1), wans };
  } catch {
    return { rxBps: 0, txBps: 0, rxPct: 0, txPct: 0, wans: [] };
  }
}

async function pollAps() {
  try { return await mikrotik.getCapsmanRegistrations(); }
  catch { return []; }
}

// Track previous WAN online state for Up/Down edge detection
const wanOnlineState = new Map(); // name -> boolean

async function pollIspStatus() {
  try {
    const c = await getMikrotikClient.fromDB();
    const wans = await Promise.all(WAN_LIST.map(async wan => {
      try {
        const iface = await c.get(`/interface/${encodeURIComponent(wan.name)}`).then(r => r.data);
        const online = iface.running === 'true';
        const prev = wanOnlineState.get(wan.name);

        if (prev !== undefined) {
          if (!online && prev) {
            // Transition: UP → DOWN
            await notify('critical', `${wan.label} Down`, `Interface ${wan.name} is not running`);
          } else if (online && !prev) {
            // Transition: DOWN → UP
            await notify('warning', `${wan.label} Up`, `Interface ${wan.name} is back online ✅`);
          }
        }
        wanOnlineState.set(wan.name, online);

        return { name: wan.name, label: wan.label, online };
      } catch {
        return { name: wan.name, label: wan.label, online: false };
      }
    }));
    return { online: wans.some(w => w.online), wans };
  } catch {
    return { online: false, wans: [] };
  }
}

async function collectAll() {
  await loadSettings();
  const [resources, bandwidth, aps, isp] = await Promise.allSettled([
    pollResources(),
    pollBandwidth(),
    pollAps(),
    pollIspStatus(),
  ]);
  return {
    resources: resources.status === 'fulfilled' ? resources.value : null,
    bandwidth: bandwidth.status === 'fulfilled' ? bandwidth.value : null,
    aps: aps.status === 'fulfilled' ? aps.value : [],
    isp: isp.status === 'fulfilled' ? isp.value : null,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { collectAll, pollResources, pollBandwidth };
