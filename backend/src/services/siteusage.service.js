const { query } = require('../config/db');
const { getMikrotikClient } = require('../config/mikrotik');

const SITE_CATEGORIES = [
  { name: 'YouTube',    color: '#FF0000', logo: 'youtube.com',    keywords: ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'yt3.ggpht'] },
  { name: 'Facebook',   color: '#1877F2', logo: 'facebook.com',   keywords: ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'fb.com', 'fb.me'] },
  { name: 'Google',     color: '#4285F4', logo: 'google.com',     keywords: ['google.com', 'googleapis.com', 'gstatic.com', 'ggpht.com', 'googleusercontent.com', 'googlesyndication.com'] },
  { name: 'TikTok',     color: '#010101', logo: 'tiktok.com',     keywords: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'muscdn.com'] },
  { name: 'Instagram',  color: '#E4405F', logo: 'instagram.com',  keywords: ['instagram.com', 'cdninstagram.com'] },
  { name: 'LINE',       color: '#00C300', logo: 'line.me',        keywords: ['line.me', 'line-scdn.net', 'line-apps.com', 'naver.com'] },
  { name: 'Twitter/X',  color: '#1DA1F2', logo: 'x.com',         keywords: ['twitter.com', 'twimg.com', 'x.com', 't.co'] },
  { name: 'Netflix',    color: '#E50914', logo: 'netflix.com',    keywords: ['netflix.com', 'nflxvideo.net', 'nflxext.com', 'nflximg.com'] },
  { name: 'Microsoft',  color: '#737373', logo: 'microsoft.com',  keywords: ['microsoft.com', 'microsoftonline.com', 'msftncsi.com', 'msftconnecttest', 'msidentity.com', 'windows.com', 'windowsupdate.com', 'live.com', 'outlook.com', 'bing.com', 'msn.com', 'azure.com'] },
  { name: 'Apple',      color: '#555555', logo: 'apple.com',      keywords: ['apple.com', 'icloud.com', 'mzstatic.com', 'aaplimg.com'] },
  { name: 'Cloudflare', color: '#F48120', logo: 'cloudflare.com', keywords: ['cloudflare.com', 'cloudflare-dns.com', '1dot1dot1dot1.cloudflare.com'] },
  { name: 'Akamai/CDN', color: '#009BDE', logo: 'akamai.com',    keywords: ['akamai.net', 'akamaized.net', 'edgesuite.net', 'edgekey.net', 'akadns.net', 'trafficmanager.net', 'fastly.net', 'cloudfront.net'] },
];

function categorize(name) {
  const lower = name.toLowerCase();
  for (const cat of SITE_CATEGORIES) {
    if (cat.keywords.some(k => lower.includes(k))) return cat.name;
  }
  return 'อื่นๆ';
}

// Extract base domain: lh3.googleusercontent.com → googleusercontent.com
function baseDomain(hostname) {
  const parts = hostname.replace(/\.$/, '').split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

async function collectSnapshot() {
  const mk = await getMikrotikClient.fromDB();
  const cache = await mk.get('/ip/dns/cache').then(r => r.data).catch(() => []);

  const counts = {};
  const domainCounts = {}; // category → { baseDomain → count }

  for (const entry of cache) {
    if (entry.static === 'true') continue;
    const name = entry.name || '';
    const cat = categorize(name);
    counts[cat] = (counts[cat] || 0) + 1;

    if (cat !== 'อื่นๆ') {
      if (!domainCounts[cat]) domainCounts[cat] = {};
      const bd = baseDomain(name);
      domainCounts[cat][bd] = (domainCounts[cat][bd] || 0) + 1;
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  const now = new Date();

  // Batch insert site totals
  const siteRows = Object.entries(counts).map(([siteName, count]) => {
    const cat = SITE_CATEGORIES.find(c => c.name === siteName);
    return [now, siteName, count, +((count / total) * 100).toFixed(1), cat?.color || '#bfbfbf', cat?.logo || null];
  });
  if (siteRows.length) {
    const values = siteRows.map((_, i) => `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(',');
    await query(
      `INSERT INTO site_usage_snapshot (snapshot_at, site_name, dns_count, pct, color, logo) VALUES ${values}`,
      siteRows.flat()
    );
  }

  // Batch insert domain breakdown
  const domainRows = [];
  for (const [category, domains] of Object.entries(domainCounts)) {
    for (const [bd, count] of Object.entries(domains)) {
      domainRows.push([now, category, bd, count]);
    }
  }
  if (domainRows.length) {
    const values = domainRows.map((_, i) => `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',');
    await query(
      `INSERT INTO site_usage_domain_snapshot (snapshot_at, category, base_domain, dns_count) VALUES ${values}`,
      domainRows.flat()
    );
  }
}

// Aggregate snapshots for a given date (YYYY-MM-DD, Bangkok timezone)
async function getHistoryForDate(date) {
  const r = await query(`
    SELECT site_name, SUM(dns_count)::int AS total_count,
           ROUND(AVG(pct)::numeric, 1) AS avg_pct,
           MAX(color) AS color, MAX(logo) AS logo
    FROM site_usage_snapshot
    WHERE snapshot_at >= ($1::date) AT TIME ZONE 'Asia/Bangkok'
      AND snapshot_at <  ($1::date + 1) AT TIME ZONE 'Asia/Bangkok'
    GROUP BY site_name
    ORDER BY total_count DESC
  `, [date]);

  const total = r.rows.reduce((s, row) => s + row.total_count, 0) || 1;
  return r.rows.map(row => ({
    name: row.site_name,
    value: row.total_count,
    pct: +((row.total_count / total) * 100).toFixed(1),
    color: row.color,
    logo: row.logo,
  }));
}

// Get domain drilldown for category + date
async function getDrilldownForDate(category, date) {
  const r = await query(`
    SELECT base_domain, SUM(dns_count)::int AS total_count
    FROM site_usage_domain_snapshot
    WHERE category = $1
      AND snapshot_at >= ($2::date) AT TIME ZONE 'Asia/Bangkok'
      AND snapshot_at <  ($2::date + 1) AT TIME ZONE 'Asia/Bangkok'
    GROUP BY base_domain
    ORDER BY total_count DESC
    LIMIT 20
  `, [category, date]);
  return r.rows;
}

// For monthly report — aggregate by month (YYYY-MM)
async function getHistoryForMonth(yearMonth) {
  const r = await query(`
    SELECT site_name, SUM(dns_count)::int AS total_count,
           MAX(color) AS color, MAX(logo) AS logo
    FROM site_usage_snapshot
    WHERE TO_CHAR(snapshot_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') = $1
    GROUP BY site_name
    ORDER BY total_count DESC
    LIMIT 10
  `, [yearMonth]);

  const total = r.rows.reduce((s, row) => s + row.total_count, 0) || 1;
  return r.rows.map(row => ({
    name: row.site_name,
    value: row.total_count,
    pct: +((row.total_count / total) * 100).toFixed(1),
    color: row.color,
    logo: row.logo,
  }));
}

// List available dates that have snapshot data
async function getAvailableDates() {
  const r = await query(`
    SELECT DISTINCT DATE(snapshot_at AT TIME ZONE 'Asia/Bangkok') AS date
    FROM site_usage_snapshot
    ORDER BY date DESC
    LIMIT 730
  `);
  return r.rows.map(row => row.date.toISOString().slice(0, 10));
}

async function cleanup() {
  await query(`DELETE FROM site_usage_snapshot WHERE snapshot_at < NOW() - INTERVAL '2 years'`);
  await query(`DELETE FROM site_usage_domain_snapshot WHERE snapshot_at < NOW() - INTERVAL '2 years'`);
}

module.exports = {
  SITE_CATEGORIES, categorize,
  collectSnapshot, getHistoryForDate, getDrilldownForDate,
  getHistoryForMonth, getAvailableDates, cleanup,
};
