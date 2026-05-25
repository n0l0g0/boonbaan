const { getMikrotikClient } = require('../config/mikrotik');
const { query } = require('../config/db');
const ouiData = require('oui-data');
const dns = require('dns').promises;
const { touchFirstSeen, getFirstSeen } = require('./conntrackFirstSeen');

// Cache reverse DNS lookups (in-memory, no eviction — bounded by unique IPs seen)
const reverseDnsCache = new Map();
const REVERSE_DNS_NEGATIVE_TTL = 10 * 60_000; // remember "no PTR" for 10 min

// Map PTR hostname patterns → friendly service name + favicon source
const FRIENDLY_HOSTS = [
  { re: /\.1e100\.net$/i,             name: 'Google',          favicon: 'google.com' },
  { re: /\.googleusercontent\.com$/i, name: 'Google User',     favicon: 'google.com' },
  { re: /\.googleapis\.com$/i,        name: 'Google API',      favicon: 'google.com' },
  { re: /\.googlevideo\.com$/i,       name: 'YouTube Video',   favicon: 'youtube.com' },
  { re: /\.fbcdn\.net$/i,             name: 'Facebook CDN',    favicon: 'facebook.com' },
  { re: /\.facebook\.com$/i,          name: 'Facebook',        favicon: 'facebook.com' },
  { re: /\.cdninstagram\.com$/i,      name: 'Instagram',       favicon: 'instagram.com' },
  { re: /\.tiktokcdn\.com$/i,         name: 'TikTok CDN',      favicon: 'tiktok.com' },
  { re: /\.tiktokv\.com$/i,           name: 'TikTok',          favicon: 'tiktok.com' },
  { re: /\.ttwstatic\.com$/i,         name: 'TikTok',          favicon: 'tiktok.com' },
  { re: /\.twitter\.com$|\.twimg\.com$|\.t\.co$/i, name: 'Twitter/X', favicon: 'x.com' },
  { re: /\.cloudfront\.net$/i,        name: 'AWS CloudFront',  favicon: 'aws.amazon.com' },
  { re: /\.amazonaws\.com$/i,         name: 'AWS',             favicon: 'aws.amazon.com' },
  { re: /cloudflare\.com$/i,          name: 'Cloudflare',      favicon: 'cloudflare.com' },
  { re: /\.akamai(hd|ized)?\.net$/i,  name: 'Akamai',          favicon: 'akamai.com' },
  { re: /\.fastly\.net$/i,            name: 'Fastly',          favicon: 'fastly.com' },
  { re: /\.nflxvideo\.net$|\.netflix\.com$/i, name: 'Netflix', favicon: 'netflix.com' },
  { re: /\.icloud(-content)?\.com$|\.aaplimg\.com$|\.mzstatic\.com$|\.apple\.com$/i, name: 'Apple', favicon: 'apple.com' },
  { re: /\.microsoft\.com$|\.msftncsi\.com$|\.windows\.com$|\.bing\.com$|\.live\.com$|\.office\.com$/i, name: 'Microsoft', favicon: 'microsoft.com' },
  { re: /\.line(-apps|-scdn)?\.(me|net)$/i, name: 'LINE',     favicon: 'line.me' },
  { re: /\.whatsapp(net)?\.net$|\.wa\.net$/i, name: 'WhatsApp', favicon: 'whatsapp.com' },
  { re: /\.discord(app)?\.com$|\.discord\.gg$/i, name: 'Discord', favicon: 'discord.com' },
  { re: /\.spotify\.com$|\.scdn\.co$/i, name: 'Spotify',       favicon: 'spotify.com' },
  { re: /\.steamcontent\.com$|\.steampowered\.com$/i, name: 'Steam', favicon: 'steampowered.com' },
];

// Extract apex domain from hostname (sub.example.com → example.com)
function extractBaseDomain(hostname) {
  if (!hostname) return null;
  const parts = hostname.replace(/\.$/, '').split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

function isPrivateOrSpecialIp(ip) {
  return !ip || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|::1|fe80:|fc|fd)/i.test(ip);
}

async function reverseDns(ip) {
  if (isPrivateOrSpecialIp(ip)) return null;
  const cached = reverseDnsCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const names = await dns.reverse(ip);
    const best = names.sort((a, b) => a.length - b.length)[0] || null;
    reverseDnsCache.set(ip, { value: best, expires: Date.now() + 24 * 3600_000 });
    return best;
  } catch {
    reverseDnsCache.set(ip, { value: null, expires: Date.now() + REVERSE_DNS_NEGATIVE_TTL });
    return null;
  }
}

// Find friendly name + favicon source for a hostname
function friendlyHost(hostname) {
  if (!hostname) return { name: null, favicon: null };
  const match = FRIENDLY_HOSTS.find(f => f.re.test(hostname));
  if (match) return { name: match.name, favicon: match.favicon };
  const base = extractBaseDomain(hostname);
  return { name: null, favicon: base };
}

// Lookup full IEEE OUI database (39k+ vendors)
function lookupVendor(mac) {
  const norm = String(mac).replace(/[:-]/g, '').toUpperCase().slice(0, 6);
  const entry = ouiData[norm];
  if (!entry) return null;
  return entry.split('\n')[0].trim();
}

// Vendor name patterns → device type (used when hostname provides no hint)
const VENDOR_TYPE_PATTERNS = [
  { type: 'network',  re: /mikrotik|ubiquiti|cisco|aruba|ruckus|netgear|tp.?link|d.?link|zyxel|extreme|fortinet|juniper|asus.*wireless|aerohive|cambium|engenius/i },
  { type: 'computer', re: /intel|dell|lenovo|hewlett.?packard|^hp\b|asustek|acer\b|micro.?star|gigabyte|^msi\b|toshiba|fujitsu|panasonic|microsoft|compal|wistron|quanta|inventec|liteon|clevo|tongfang/i },
  { type: 'mobile',   re: /samsung|xiaomi|huawei device|huawei tech|honor device|oppo|vivo mobile|realme|oneplus|motorola mobility|lg electronics|nokia|sony mobile|infinix|tecno|nothing|^htc/i },
  { type: 'iot',      re: /amazon technologies|sonos|philips lighting|google.*nest|nest labs|roku|wyze|ring llc|tuya|sonoff|ecobee|honeywell.*smart|sengled|lifx|tradfri|sony.*tv|samsung electronics.*tv|lg electronics.*tv|hikvision|dahua|axis comm|reolink|amcrest|synology|qnap|terramaster|drobo|western digital/i },
  { type: 'computer', re: /^apple/i }, // Apple fallback to computer when hostname doesn't hint mobile
];


// Hostname patterns — stronger signal than MAC OUI when present
const HOSTNAME_PATTERNS = [
  { type: 'mobile',   re: /iphone|ipad|ipod|android|galaxy|^sm-[a-z]\d|redmi|^mi[- ]?[a-z0-9]|xiaomi|huawei|honor.*phone|oppo|vivo[-_]|realme|oneplus|pixel|nokia.*phone|poco|infinix|nothing/i },
  { type: 'computer', re: /macbook|imac|mac.?mini|mac.?pro|^mac$|^mac[bp]/i },
  // Notebook prefixes used by enterprises (NBR..., NBP..., NB..., etc.) and Windows defaults
  { type: 'computer', re: /^nb[a-z]?\d|^desktop[-_]|^laptop[-_]|^win[-_]|^pc[-_]|^workstation|thinkpad|surface|latitude|inspiron|elitebook|probook|ideapad|legion|aspire|vivobook|zenbook|tuf[-_]|rog[-_]|alienware|optiplex|chromebook/i },
  { type: 'iot',      re: /\b(echo|alexa|chromecast|googlehome|nest|firetv|appletv|roku|smarttv|smart.?tv|bravia|webos|tizen|hue|kasa|tplink.?smart|wyze|ring|blink|switchbot|sonoff|tuya|deebot|roborock|printer)\b|.?tv$|^cam[-_\d]|cctv/i },
  // Network infrastructure naming (AP, Switch, Router, AccessLayer, Core)
  { type: 'network',  re: /^(ap[-_\d]|sw\d|swi|router|gw[-_\d]|firewall|core|aclrf|coresw|mikrotik|ubnt|edgemax|edgerouter)/i },
];

function detectDevice({ hostname = '', mac = '' }) {
  const normHost = String(hostname).toLowerCase().trim();
  const vendor = lookupVendor(mac) || 'Unknown';

  // 1. Hostname pattern (strongest signal)
  for (const p of HOSTNAME_PATTERNS) {
    if (p.re.test(normHost)) return { type: p.type, vendor };
  }

  // 2. Apple-specific: if vendor is Apple and hostname doesn't hint mobile/computer,
  //    a bare or randomized hostname is most often an iPhone/iPad
  if (/^apple/i.test(vendor)) {
    if (/mac|book|imac/i.test(normHost)) return { type: 'computer', vendor };
    return { type: 'mobile', vendor };
  }

  // 3. Vendor name patterns → type
  for (const p of VENDOR_TYPE_PATTERNS) {
    if (p.re.test(vendor)) return { type: p.type, vendor };
  }

  return { type: 'unknown', vendor };
}

const TYPE_LABELS = {
  mobile:   { label: 'Mobile',   color: '#1677ff', icon: 'mobile' },
  computer: { label: 'Computer', color: '#52c41a', icon: 'desktop' },
  iot:      { label: 'IoT/TV',   color: '#faad14', icon: 'cloud' },
  network:  { label: 'Network',  color: '#722ed1', icon: 'cluster' },
  unknown:  { label: 'Unknown',  color: '#bfbfbf', icon: 'question' },
};

async function listConnectedDevices() {
  const mk = await getMikrotikClient.fromDB();
  const [leases, arp] = await Promise.all([
    mk.get('/ip/dhcp-server/lease').then(r => r.data).catch(() => []),
    mk.get('/ip/arp').then(r => r.data).catch(() => []),
  ]);

  // Map MAC → ARP entry (for active check via reachable state)
  const arpByMac = new Map();
  for (const a of arp) {
    const m = (a['mac-address'] || '').toLowerCase();
    if (m) arpByMac.set(m, a);
  }

  const devices = leases.map(lease => {
    const mac = (lease['mac-address'] || '').toLowerCase();
    const hostname = lease['host-name'] || '';
    const detection = detectDevice({ hostname, mac });
    const arpEntry = arpByMac.get(mac);
    const isActive = lease.status === 'bound' && arpEntry && arpEntry.complete === 'true';

    return {
      mac: lease['mac-address'],
      ip: lease.address,
      hostname,
      type: detection.type,
      vendor: detection.vendor,
      active: !!isActive,
      lastSeen: lease['last-seen'] || null,
      expiresAfter: lease['expires-after'] || null,
      comment: lease.comment || '',
    };
  });

  return devices;
}

async function deviceBreakdown() {
  const devices = await listConnectedDevices();
  const active = devices.filter(d => d.active);
  const counts = {};
  for (const d of active) {
    counts[d.type] = (counts[d.type] || 0) + 1;
  }
  const breakdown = Object.entries(counts).map(([type, count]) => ({
    type,
    label: TYPE_LABELS[type]?.label || type,
    color: TYPE_LABELS[type]?.color || '#bfbfbf',
    count,
    pct: +((count / active.length) * 100).toFixed(1),
  })).sort((a, b) => b.count - a.count);

  return {
    total: devices.length,
    active: active.length,
    breakdown,
    devices,
  };
}

// Record a snapshot of currently-active devices into device_history.
// Called periodically; only inserts entries that changed (new device or IP/hostname change).
async function recordDeviceSnapshot() {
  const devices = await listConnectedDevices();
  const active = devices.filter(d => d.active);

  // Fetch most recent record per MAC to detect changes
  const r = await query(`
    SELECT DISTINCT ON (mac) mac, ip, hostname, event
    FROM device_history
    ORDER BY mac, seen_at DESC
  `);
  const lastByMac = new Map(r.rows.map(row => [row.mac.toLowerCase(), row]));

  const toInsert = [];
  const seenMacs = new Set();
  for (const d of active) {
    const macKey = d.mac.toLowerCase();
    seenMacs.add(macKey);
    const last = lastByMac.get(macKey);
    let event = 'seen';
    if (!last || last.event === 'disconnect') event = 'connect';
    else if (last.ip !== d.ip || last.hostname !== d.hostname) event = 'change';
    if (event !== 'seen') {
      toInsert.push([d.mac, d.ip, d.hostname || '', d.type, d.vendor || '', event]);
    }
  }

  // Detect disconnects: devices in lastByMac that were 'connect'/'seen'/'change' but not active now
  for (const [mac, last] of lastByMac.entries()) {
    if (last.event !== 'disconnect' && !seenMacs.has(mac)) {
      const orig = devices.find(d => d.mac.toLowerCase() === mac);
      toInsert.push([
        orig?.mac || mac, orig?.ip || last.ip, orig?.hostname || last.hostname,
        orig?.type || 'unknown', orig?.vendor || '', 'disconnect',
      ]);
    }
  }

  if (toInsert.length === 0) return { inserted: 0 };

  const values = toInsert.map((_, i) => `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(',');
  await query(
    `INSERT INTO device_history (mac, ip, hostname, type, vendor, event) VALUES ${values}`,
    toInsert.flat()
  );
  return { inserted: toInsert.length };
}

async function getDeviceHistory({ limit = 200, mac, type, hours = 24 } = {}) {
  const conditions = [`seen_at > NOW() - make_interval(hours => $1)`];
  const params = [Number(hours)];
  if (mac)  { params.push(mac);  conditions.push(`mac = $${params.length}`); }
  if (type) { params.push(type); conditions.push(`type = $${params.length}`); }
  params.push(Number(limit));
  const r = await query(
    `SELECT id, mac, ip, hostname, type, vendor, event, seen_at
     FROM device_history WHERE ${conditions.join(' AND ')}
     ORDER BY seen_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

// List active connections from a specific device (by its current IP).
// Correlates dst IPs to domain names via DNS cache for human-readable output.
async function getDeviceConnections(deviceIp) {
  if (!deviceIp) return [];
  const mk = await getMikrotikClient.fromDB();
  const [conns, dnsCache] = await Promise.all([
    mk.get('/ip/firewall/connection').then(r => r.data).catch(() => []),
    mk.get('/ip/dns/cache').then(r => r.data).catch(() => []),
  ]);

  // Build reverse lookup: IP → most recent domain name
  const ipToDomain = new Map();
  for (const e of dnsCache) {
    if (!e.address || !e.name) continue;
    // Prefer apex/shorter names over CDN subdomains for readability
    const existing = ipToDomain.get(e.address);
    if (!existing || e.name.length < existing.length) {
      ipToDomain.set(e.address, e.name);
    }
  }

  // Filter connections originating from the device
  const deviceConns = conns.filter(c => {
    const src = (c['src-address'] || '').split(':')[0];
    return src === deviceIp;
  });

  // Group by destination (IP + port) to dedupe parallel connections.
  // Track firstSeen (earliest first-seen across grouped conn ids) and lastSeen
  // (this poll's timestamp).
  const now = Date.now();
  const grouped = new Map();
  for (const c of deviceConns) {
    const [dstIp, dstPort] = (c['dst-address'] || '').split(':');
    const key = `${dstIp}:${dstPort}`;
    const origBytes = Number(c['orig-bytes']) || 0;
    const replBytes = Number(c['repl-bytes']) || 0;

    // Seed firstSeen for any conn id we haven't seen before (e.g. before
    // the sampling cron has run for this id)
    const connId = c['.id'];
    touchFirstSeen(connId, now);
    const fs = getFirstSeen(connId);

    const existing = grouped.get(key);
    if (existing) {
      existing.connections++;
      existing.totalBytes += origBytes + replBytes;
      if (fs && (!existing.firstSeen || fs < existing.firstSeen)) existing.firstSeen = fs;
    } else {
      grouped.set(key, {
        dstIp,
        dstPort: dstPort ? Number(dstPort) : null,
        protocol: c.protocol,
        tcpState: c['tcp-state'] || null,
        domain: ipToDomain.get(dstIp) || null,
        totalBytes: origBytes + replBytes,
        connections: 1,
        timeout: c.timeout,
        firstSeen: fs || now,
        lastSeen: now,
      });
    }
  }

  // For destinations without a domain from DNS cache, try reverse DNS (parallel + cached)
  const noDomain = [...grouped.values()].filter(g => !g.domain);
  const uniqueIps = [...new Set(noDomain.map(g => g.dstIp))];
  const reverseResults = await Promise.all(uniqueIps.map(async ip => [ip, await reverseDns(ip)]));
  const reverseMap = Object.fromEntries(reverseResults);

  // Enrich each entry with friendly name + favicon domain
  for (const g of grouped.values()) {
    if (!g.domain) g.domain = reverseMap[g.dstIp] || null;
    const fh = friendlyHost(g.domain);
    g.friendlyName = fh.name;
    g.faviconDomain = fh.favicon;
  }

  // Newest first (most-recent firstSeen at top); fall back to totalBytes for ties
  return [...grouped.values()].sort((a, b) => {
    const d = (b.firstSeen || 0) - (a.firstSeen || 0);
    return d !== 0 ? d : b.totalBytes - a.totalBytes;
  });
}

// History of connections from a device over the last N hours, sourced from DB.
// Each row = one conntrack session (one row per conntrack id while it lived).
// Enriches dst IPs with domain names from MikroTik DNS cache + reverse DNS.
async function getDeviceConnectionsHistory({ ip, mac, hours = 24, limit = 500 }) {
  if (!ip && !mac) return [];
  const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 14);
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 5000);

  const where = ip ? 'device_ip = $1' : 'device_mac = $1';
  const r = await query(
    `SELECT session_key, device_ip, device_mac, dst_ip, dst_port, protocol,
            tcp_state, first_seen, last_seen, closed_at, total_bytes
       FROM device_connection_history
      WHERE ${where} AND last_seen > NOW() - make_interval(hours => $2)
      ORDER BY first_seen DESC
      LIMIT $3`,
    [ip || mac, h, lim]
  );
  const rows = r.rows;
  if (rows.length === 0) return [];

  // Build IP→domain map from current MikroTik DNS cache (best-effort)
  let ipToDomain = new Map();
  try {
    const mk = await getMikrotikClient.fromDB();
    const dnsCache = await mk.get('/ip/dns/cache').then(r => r.data).catch(() => []);
    for (const e of dnsCache) {
      if (!e.address || !e.name) continue;
      const existing = ipToDomain.get(e.address);
      if (!existing || e.name.length < existing.length) ipToDomain.set(e.address, e.name);
    }
  } catch { /* mk unreachable — proceed without enrichment */ }

  // Reverse-DNS missing destinations (cached, parallel)
  const missingIps = [...new Set(rows.map(r => r.dst_ip).filter(ip => ip && !ipToDomain.has(ip)))];
  const reverseResults = await Promise.all(missingIps.map(async ip => [ip, await reverseDns(ip)]));
  for (const [ip, name] of reverseResults) if (name) ipToDomain.set(ip, name);

  return rows.map(r => {
    const domain = ipToDomain.get(r.dst_ip) || null;
    const fh = friendlyHost(domain);
    return {
      sessionKey: r.session_key,
      deviceIp: r.device_ip,
      deviceMac: r.device_mac,
      dstIp: r.dst_ip,
      dstPort: r.dst_port,
      protocol: r.protocol,
      tcpState: r.tcp_state,
      domain,
      friendlyName: fh.name,
      faviconDomain: fh.favicon,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      closedAt: r.closed_at,
      totalBytes: Number(r.total_bytes) || 0,
      active: !r.closed_at,
    };
  });
}

// Derive online sessions from device_history events, then split sessions
// that cross midnight so the result can be grouped/rendered per day.
async function getDeviceSessions({ mac, from, to }) {
  if (!mac) return [];
  const r = await query(
    `SELECT event, seen_at
       FROM device_history
      WHERE LOWER(mac) = LOWER($1)
        AND seen_at >= $2::timestamptz AND seen_at < $3::timestamptz + INTERVAL '1 day'
      ORDER BY seen_at ASC`,
    [mac, from, to]
  );

  // Walk events: a connect/change/seen starts (or continues) a session, a
  // disconnect closes it. If the period ends with the device still online,
  // close the open session at NOW().
  const sessions = [];
  let openAt = null;
  for (const ev of r.rows) {
    const t = new Date(ev.seen_at);
    if (ev.event === 'disconnect') {
      if (openAt) {
        sessions.push({ start: openAt, end: t });
        openAt = null;
      }
    } else {
      // connect / change / seen — open a session if not already open
      if (!openAt) openAt = t;
    }
  }
  if (openAt) sessions.push({ start: openAt, end: new Date(), ongoing: true });

  // Split each session by Asia/Bangkok day boundaries so the timeline shows
  // one entry per (day × continuous-online period)
  const TZ_OFFSET_MS = 7 * 3600 * 1000;
  const dayKey = (d) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
  function dayBoundaryAfter(d) {
    const utcMs = d.getTime() + TZ_OFFSET_MS;
    const startOfDayUtc = Math.floor(utcMs / 86400000) * 86400000;
    return new Date(startOfDayUtc + 86400000 - TZ_OFFSET_MS); // next BKK midnight in real time
  }

  const out = [];
  for (const s of sessions) {
    let cursor = s.start;
    while (cursor < s.end) {
      const nextBoundary = dayBoundaryAfter(cursor);
      const segmentEnd = nextBoundary < s.end ? nextBoundary : s.end;
      out.push({
        day: dayKey(cursor),
        start: cursor,
        end: segmentEnd,
        durationSec: Math.round((segmentEnd - cursor) / 1000),
        ongoing: !!s.ongoing && segmentEnd === s.end,
      });
      cursor = segmentEnd;
    }
  }
  return out;
}

async function getDeviceDailyUsage({ mac, from, to }) {
  if (!mac) return [];
  const r = await query(
    `SELECT day, rx_bytes::bigint AS rx_bytes, tx_bytes::bigint AS tx_bytes,
            total_bytes::bigint AS total_bytes
       FROM device_usage_daily
      WHERE LOWER(mac) = LOWER($1)
        AND day >= $2::date AND day <= $3::date
      ORDER BY day ASC`,
    [mac, from, to]
  );
  return r.rows.map(r => ({
    day: r.day,
    rx_bytes: Number(r.rx_bytes),
    tx_bytes: Number(r.tx_bytes),
    total_bytes: Number(r.total_bytes),
  }));
}

module.exports = {
  detectDevice, listConnectedDevices, deviceBreakdown,
  recordDeviceSnapshot, getDeviceHistory, getDeviceConnections, getDeviceConnectionsHistory,
  getDeviceSessions, getDeviceDailyUsage, TYPE_LABELS,
};
