const router = require('express').Router();
const auth = require('../middleware/auth');
const { getMikrotikClient } = require('../config/mikrotik');
const { query } = require('../config/db');
const dns = require('dns').promises;

const WF_LIST = 'wf-blocked';
const WF_TAG = '[WF]';
const DNS_TAG = '[WF-DNS]';
const WF_FW_COMMENT = '[WF-BLOCK]';
const WF_SNI_TAG = '[WF-SNI]';
const WF_QUIC_TAG = '[WF-QUIC]';

const DOH_IPS = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '9.9.9.10', '208.67.222.222', '208.67.220.220'];

// Known CIDR ranges for CDN-heavy sites that use many anycast IPs
const KNOWN_CIDRS = {
  'facebook.com':  ['157.240.0.0/16', '31.13.24.0/21', '31.13.64.0/18', '66.220.144.0/20', '69.63.176.0/20', '69.171.224.0/19', '129.134.0.0/16', '163.70.0.0/16', '185.60.216.0/22'],
  'instagram.com': ['157.240.0.0/16', '31.13.24.0/21', '31.13.64.0/18', '129.134.0.0/16', '163.70.0.0/16'],
  'tiktok.com':    ['23.194.0.0/16', '103.250.88.0/22', '161.117.0.0/16'],
  'twitter.com':   ['104.244.40.0/21', '192.133.76.0/22'],
  'x.com':         ['104.244.40.0/21', '192.133.76.0/22'],
};

// ── helpers ──────────────────────────────────────────────────────────────────

function entryToRule(e) {
  return {
    '.id': e['.id'],
    'dst-host': e.address,
    action: 'deny',
    comment: (e.comment || '').replace(`${WF_TAG} `, ''),
    disabled: e.disabled || 'false',
    hits: '0',
    _type: 'firewall',
  };
}

// Resolve all IPs for a domain (apex + common subdomains)
async function resolveAllIPs(domain) {
  const ips = new Set();
  const variants = [domain, `www.${domain}`, `m.${domain}`, `api.${domain}`, `static.${domain}`];
  await Promise.all(variants.map(async d => {
    try { (await dns.resolve4(d)).forEach(ip => ips.add(ip)); } catch {}
  }));
  return [...ips];
}

// Get known CIDR ranges for a domain (checks domain and parent domains)
function getKnownCidrs(domain) {
  for (const key of Object.keys(KNOWN_CIDRS)) {
    if (domain === key || domain.endsWith(`.${key}`)) return KNOWN_CIDRS[key];
  }
  return [];
}

// Add TLS SNI drop rules for a domain (RouterOS 7+) — blocks by hostname in TLS handshake
// tls-host matcher requires protocol=tcp; we scope to port 443 (HTTPS)
async function addSniRules(mk, domain, tag) {
  const rules = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
  const forwardRules = rules.filter(r => r.chain === 'forward');
  const firstAccept = forwardRules.find(r => r.action === 'accept');

  const hosts = [domain, `*.${domain}`];
  for (const host of hosts) {
    const exists = forwardRules.some(r => (r.comment || '').includes(`${WF_SNI_TAG}`) && (r['tls-host'] === host));
    if (exists) continue;
    const body = {
      chain: 'forward', protocol: 'tcp', 'dst-port': '443',
      action: 'drop', 'tls-host': host,
      log: 'yes', 'log-prefix': 'WF-SNI',
      comment: `${WF_SNI_TAG} ${tag}`,
    };
    if (firstAccept) body['place-before'] = firstAccept['.id'];
    await mk.put('/ip/firewall/filter', body).catch(e => console.error('SNI rule add failed:', e.response?.data || e.message));
  }
}

// Kill existing connections to blocked IPs — forces apps to reconnect (and hit new firewall rules)
async function killBlockedConnections(mk) {
  const [conns, addrList] = await Promise.all([
    mk.get('/ip/firewall/connection').then(r => r.data).catch(() => []),
    mk.get('/ip/firewall/address-list').then(r => r.data).catch(() => []),
  ]);
  const blockedIps = new Set(
    addrList.filter(e => e.list === WF_LIST).map(e => e.address)
  );
  const toKill = conns.filter(c => {
    const dst = (c['dst-address'] || '').split(':')[0];
    return blockedIps.has(dst);
  });
  await Promise.all(toKill.map(c => mk.delete(`/ip/firewall/connection/${c['.id']}`).catch(() => {})));
  return toKill.length;
}

// Ensure MikroTik routes "firewall" topic logs to memory buffer (required to capture WF-DROP/WF-SNI events)
async function ensureFirewallLogging(mk) {
  const rules = await mk.get('/system/logging').then(r => r.data).catch(() => []);
  const exists = rules.some(r => (r.topics || '').includes('firewall') && r.action === 'memory' && r.disabled !== 'true');
  if (exists) return;
  await mk.put('/system/logging', { topics: 'firewall', action: 'memory' }).catch(() => {});
}

// Ensure WF drop rule exists and is BEFORE any forward-accept rules
async function ensureDropRule(mk) {
  await ensureFirewallLogging(mk);
  const rules = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
  const forwardRules = rules.filter(r => r.chain === 'forward');
  const existing = forwardRules.find(r => (r.comment || '').includes(WF_FW_COMMENT));
  const firstAccept = forwardRules.find(r => r.action === 'accept');

  if (existing) {
    const existingIdx = forwardRules.indexOf(existing);
    const acceptIdx = firstAccept ? forwardRules.indexOf(firstAccept) : Infinity;
    // Patch existing rule to ensure logging is enabled (for blocked-access detection)
    if (existing.log !== 'yes' || existing['log-prefix'] !== 'WF-DROP') {
      await mk.patch(`/ip/firewall/filter/${existing['.id']}`, { log: 'yes', 'log-prefix': 'WF-DROP' }).catch(() => {});
    }
    if (existingIdx < acceptIdx) return; // already correct
    await mk.delete(`/ip/firewall/filter/${existing['.id']}`).catch(() => {});
  }

  const body = {
    chain: 'forward',
    'dst-address-list': WF_LIST,
    action: 'drop',
    log: 'yes',
    'log-prefix': 'WF-DROP',
    comment: `${WF_FW_COMMENT} Drop blocked websites`,
  };
  if (firstAccept) body['place-before'] = firstAccept['.id'];
  await mk.put('/ip/firewall/filter', body).catch(() => {});
}

// ── DNS Enforcement ───────────────────────────────────────────────────────────

router.get('/enforcement', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const [nat, filter] = await Promise.all([
      mk.get('/ip/firewall/nat').then(r => r.data).catch(() => []),
      mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []),
    ]);
    const natRules = nat.filter(r => (r.comment || '').includes(DNS_TAG));
    const filterRules = filter.filter(r => (r.comment || '').includes(DNS_TAG));
    res.json({ enabled: natRules.length > 0, natCount: natRules.length, filterCount: filterRules.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/enforcement', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    await mk.put('/ip/firewall/nat', { chain: 'dstnat', protocol: 'udp', 'dst-port': '53', action: 'redirect', 'to-ports': '53', comment: `${DNS_TAG} Redirect DNS UDP` }).catch(() => {});
    await mk.put('/ip/firewall/nat', { chain: 'dstnat', protocol: 'tcp', 'dst-port': '53', action: 'redirect', 'to-ports': '53', comment: `${DNS_TAG} Redirect DNS TCP` }).catch(() => {});
    for (const ip of DOH_IPS) {
      await mk.put('/ip/firewall/filter', { chain: 'forward', protocol: 'udp', 'dst-address': ip, 'dst-port': '53', action: 'drop', comment: `${DNS_TAG} Block ext DNS ${ip}` }).catch(() => {});
    }
    await mk.put('/ip/firewall/filter', { chain: 'forward', protocol: 'tcp', 'dst-port': '853', action: 'drop', comment: `${DNS_TAG} Block DoT` }).catch(() => {});
    await mk.post('/ip/dns/cache/flush', {}).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── QUIC Kill Switch ──────────────────────────────────────────────────────────
// Block all UDP/443 (HTTP/3 QUIC). Forces browsers to fall back to TCP/443,
// where TLS SNI inspection catches blocked domains regardless of IP.

router.get('/quic-block', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const filter = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
    const rules = filter.filter(r => (r.comment || '').includes(WF_QUIC_TAG));
    res.json({ enabled: rules.length > 0, count: rules.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/quic-block', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const rules = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
    const forwardRules = rules.filter(r => r.chain === 'forward');
    const firstAccept = forwardRules.find(r => r.action === 'accept');
    const body = {
      chain: 'forward', protocol: 'udp', 'dst-port': '443', action: 'drop',
      comment: `${WF_QUIC_TAG} Block all QUIC (force TCP for SNI inspection)`,
    };
    if (firstAccept) body['place-before'] = firstAccept['.id'];
    // remove existing first to avoid duplicate
    for (const r of forwardRules.filter(r => (r.comment || '').includes(WF_QUIC_TAG))) {
      await mk.delete(`/ip/firewall/filter/${r['.id']}`).catch(() => {});
    }
    await mk.put('/ip/firewall/filter', body).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/quic-block', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const filter = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
    const toDelete = filter.filter(r => (r.comment || '').includes(WF_QUIC_TAG));
    await Promise.all(toDelete.map(r => mk.delete(`/ip/firewall/filter/${r['.id']}`).catch(() => {})));
    res.json({ ok: true, removed: toDelete.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Verify defenses ───────────────────────────────────────────────────────────
// Returns the status of every defense layer so the UI can show a health panel.

router.get('/verify', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const [filter, nat, addrList, dns] = await Promise.all([
      mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []),
      mk.get('/ip/firewall/nat').then(r => r.data).catch(() => []),
      mk.get('/ip/firewall/address-list').then(r => r.data).catch(() => []),
      mk.get('/ip/dns/static').then(r => r.data).catch(() => []),
    ]);

    const forward = filter.filter(r => r.chain === 'forward');
    const dropRule = forward.find(r => (r.comment || '').includes(WF_FW_COMMENT));
    const firstAccept = forward.find(r => r.action === 'accept');
    const dropIdx = dropRule ? forward.indexOf(dropRule) : -1;
    const acceptIdx = firstAccept ? forward.indexOf(firstAccept) : Infinity;

    const sniRules = forward.filter(r => (r.comment || '').includes(WF_SNI_TAG));
    const quicRules = forward.filter(r => (r.comment || '').includes(WF_QUIC_TAG));
    const dnsNatRules = nat.filter(r => (r.comment || '').includes(DNS_TAG));
    const dohBlockRules = filter.filter(r => (r.comment || '').includes(DNS_TAG));
    const blockedAddrs = addrList.filter(e => e.list === WF_LIST && (e.comment || '').startsWith(WF_TAG));
    const dnsStatic = dns.filter(e => (e.comment || '').startsWith(WF_TAG) && e.type === 'NXDOMAIN');

    const blockedDomains = blockedAddrs.filter(e => !(e.comment || '').endsWith('[ip]')).length;
    const blockedIps = blockedAddrs.filter(e => (e.comment || '').endsWith('[ip]')).length;

    res.json({
      layers: {
        firewallDrop: {
          enabled: !!dropRule,
          correctPosition: dropRule ? dropIdx < acceptIdx : false,
          status: !dropRule ? 'missing' : (dropIdx < acceptIdx ? 'ok' : 'wrong-position'),
        },
        tlsSni: { enabled: sniRules.length > 0, count: sniRules.length, status: sniRules.length > 0 ? 'ok' : 'none' },
        dnsNxdomain: { enabled: dnsStatic.length > 0, count: dnsStatic.length, status: dnsStatic.length > 0 ? 'ok' : 'none' },
        dnsHijack: { enabled: dnsNatRules.length > 0, count: dnsNatRules.length, status: dnsNatRules.length > 0 ? 'ok' : 'off' },
        dohBlock: { enabled: dohBlockRules.length > 0, count: dohBlockRules.length, status: dohBlockRules.length > 0 ? 'ok' : 'off' },
        quicBlock: { enabled: quicRules.length > 0, status: quicRules.length > 0 ? 'ok' : 'off' },
      },
      stats: {
        blockedDomains, blockedIps, totalAddrListEntries: blockedAddrs.length,
        sniRules: sniRules.length, dnsStatic: dnsStatic.length,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/enforcement', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const [nat, filter] = await Promise.all([
      mk.get('/ip/firewall/nat').then(r => r.data).catch(() => []),
      mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []),
    ]);
    const toDelete = [
      ...nat.filter(r => (r.comment || '').includes(DNS_TAG)).map(r => ({ path: '/ip/firewall/nat', id: r['.id'] })),
      ...filter.filter(r => (r.comment || '').includes(DNS_TAG)).map(r => ({ path: '/ip/firewall/filter', id: r['.id'] })),
    ];
    await Promise.all(toDelete.map(({ path, id }) => mk.delete(`${path}/${id}`).catch(() => {})));
    res.json({ ok: true, removed: toDelete.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Block rules ───────────────────────────────────────────────────────────────

router.get('/rules', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const all = await mk.get('/ip/firewall/address-list').then(r => r.data).catch(() => []);
    // Return only the primary domain entries (dynamic=false, comment starts with WF_TAG, no [ip] suffix)
    const rules = all
      .filter(e => e.list === WF_LIST && e.dynamic === 'false' && (e.comment || '').startsWith(WF_TAG) && !e.comment.endsWith('[ip]'))
      .map(entryToRule);
    res.json(rules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules', auth, async (req, res) => {
  try {
    const { 'dst-host': dstHost, comment = '' } = req.body;
    if (!dstHost) return res.status(400).json({ error: 'dst-host required' });

    const mk = await getMikrotikClient.fromDB();
    const tag = `${WF_TAG} ${comment || dstHost}`;
    const domain = dstHost.startsWith('*.') ? dstHost.slice(2) : dstHost;

    // 1. Add domain name to address-list (MikroTik resolves 1 IP dynamically)
    const result = await mk.put('/ip/firewall/address-list', {
      list: WF_LIST, address: domain, comment: tag,
    }).then(r => r.data).catch(e => ({ error: e.message }));

    if (result.error) return res.status(500).json({ error: result.error });

    // 2. Resolve ALL IPs from backend DNS and add each explicitly (bypass CDN multi-IP issue)
    const ips = await resolveAllIPs(domain);
    const cidrs = getKnownCidrs(domain);
    const allEntries = [...ips, ...cidrs];
    await Promise.all(allEntries.map(addr =>
      mk.put('/ip/firewall/address-list', {
        list: WF_LIST, address: addr, comment: `${tag} [ip]`,
      }).catch(() => {})
    ));

    // 3. Add TLS SNI drop rules (RouterOS 7+) — blocks by domain name in TLS handshake, bypasses IP caching
    await addSniRules(mk, domain, tag);

    // 4. Add DNS NXDOMAIN — blocks clients that try to resolve AFTER block (belt-and-suspenders)
    await mk.put('/ip/dns/static', { name: domain, type: 'NXDOMAIN', comment: tag, ttl: '1h' }).catch(() => {});
    if (dstHost.startsWith('*.')) {
      await mk.put('/ip/dns/static', { name: dstHost, type: 'NXDOMAIN', comment: tag, ttl: '1h' }).catch(() => {});
    }

    // 5. Flush MikroTik DNS cache — clients re-query and get NXDOMAIN immediately
    await mk.post('/ip/dns/cache/flush', {}).catch(() => {});

    // 6. Ensure firewall drop rule is at the top
    await ensureDropRule(mk);

    // 7. Kill existing connections to blocked IPs — forces apps to reconnect & hit new rules
    const killed = await killBlockedConnections(mk).catch(() => 0);

    res.json({ ...entryToRule({ ...result, address: domain, comment: tag, disabled: 'false' }), killedConnections: killed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/rules/:id', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const { disabled } = req.body;

    // Find all related entries (domain + resolved IPs share the same base comment)
    const all = await mk.get('/ip/firewall/address-list').then(r => r.data).catch(() => []);
    const target = all.find(e => e['.id'] === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });

    // Toggle all entries with same base comment (the [ip] entries share same tag prefix)
    const baseTag = target.comment.replace(' [ip]', '');
    const siblings = all.filter(e => e.list === WF_LIST && (e.comment === baseTag || e.comment === `${baseTag} [ip]`));
    await Promise.all(siblings.map(e =>
      mk.patch(`/ip/firewall/address-list/${e['.id']}`, { disabled: String(disabled) }).catch(() => {})
    ));

    // Also toggle DNS NXDOMAIN entries
    const dnsAll = await mk.get('/ip/dns/static').then(r => r.data).catch(() => []);
    const dnsEntries = dnsAll.filter(e => e.comment === baseTag);
    await Promise.all(dnsEntries.map(e =>
      mk.patch(`/ip/dns/static/${e['.id']}`, { disabled: String(disabled) }).catch(() => {})
    ));

    // Also toggle SNI filter rules
    const filterAll = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
    const sniEntries = filterAll.filter(e => (e.comment || '').includes(WF_SNI_TAG) && (e.comment || '').includes(baseTag));
    await Promise.all(sniEntries.map(e =>
      mk.patch(`/ip/firewall/filter/${e['.id']}`, { disabled: String(disabled) }).catch(() => {})
    ));

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:id', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();

    // Find all related address-list entries
    const all = await mk.get('/ip/firewall/address-list').then(r => r.data).catch(() => []);
    const target = all.find(e => e['.id'] === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });

    const baseTag = target.comment.replace(' [ip]', '');
    const toDelete = all.filter(e => e.list === WF_LIST && (e.comment === baseTag || e.comment === `${baseTag} [ip]`));
    await Promise.all(toDelete.map(e => mk.delete(`/ip/firewall/address-list/${e['.id']}`).catch(() => {})));

    // Remove DNS NXDOMAIN entries
    const dnsAll = await mk.get('/ip/dns/static').then(r => r.data).catch(() => []);
    const dnsEntries = dnsAll.filter(e => e.comment === baseTag);
    await Promise.all(dnsEntries.map(e => mk.delete(`/ip/dns/static/${e['.id']}`).catch(() => {})));

    // Remove SNI filter rules
    const filterAll = await mk.get('/ip/firewall/filter').then(r => r.data).catch(() => []);
    const sniEntries = filterAll.filter(e => (e.comment || '').includes(WF_SNI_TAG) && (e.comment || '').includes(baseTag));
    await Promise.all(sniEntries.map(e => mk.delete(`/ip/firewall/filter/${e['.id']}`).catch(() => {})));

    // Flush DNS cache — clients can resolve again immediately
    await mk.post('/ip/dns/cache/flush', {}).catch(() => {});

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual: kill all existing connections to blocked IPs (forces apps to reconnect)
router.post('/kill-connections', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const killed = await killBlockedConnections(mk);
    res.json({ ok: true, killed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/flush-dns', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    await mk.post('/ip/dns/cache/flush', {}).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', auth, async (req, res) => {
  try {
    const mk = await getMikrotikClient.fromDB();
    const proxy = await mk.get('/ip/proxy').then(r => r.data).catch(() => ({}));
    res.json({ ...proxy, _method: 'firewall+dns', _note: 'Firewall address-list drop + DNS NXDOMAIN' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Access logs ───────────────────────────────────────────────────────────────

router.get('/blocked-log', auth, async (req, res) => {
  const { limit = 200, srcIp, dstHost, hours = 24 } = req.query;
  try {
    const conditions = [`detected_at > NOW() - make_interval(hours => $1)`];
    const params = [Number(hours)];
    if (srcIp) { params.push(srcIp); conditions.push(`src_ip = $${params.length}`); }
    if (dstHost) { params.push(`%${dstHost}%`); conditions.push(`dst_host ILIKE $${params.length}`); }
    params.push(Number(limit));
    const r = await query(
      `SELECT * FROM blocked_access_log WHERE ${conditions.join(' AND ')} ORDER BY detected_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/blocked-stats', auth, async (req, res) => {
  const { hours = 24 } = req.query;
  try {
    const [byHost, byIp] = await Promise.all([
      query(`SELECT dst_host, COUNT(*) AS count FROM blocked_access_log WHERE detected_at > NOW() - make_interval(hours => $1) GROUP BY dst_host ORDER BY count DESC LIMIT 10`, [Number(hours)]),
      query(`SELECT src_ip, COUNT(*) AS count FROM blocked_access_log WHERE detected_at > NOW() - make_interval(hours => $1) GROUP BY src_ip ORDER BY count DESC LIMIT 10`, [Number(hours)]),
    ]);
    res.json({ byHost: byHost.rows, byIp: byIp.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /webfilter/blocked-by-device?hours=24
// Returns devices that attempted blocked hosts, enriched with hostname/type/vendor from DHCP leases.
router.get('/blocked-by-device', auth, async (req, res) => {
  const { hours = 24 } = req.query;
  try {
    const stats = await query(
      `SELECT src_ip,
              COUNT(*)::int AS attempts,
              MAX(detected_at) AS last_at,
              (SELECT dst_host FROM blocked_access_log b2
                 WHERE b2.src_ip = b1.src_ip AND b2.detected_at > NOW() - make_interval(hours => $1)
                 GROUP BY dst_host ORDER BY COUNT(*) DESC LIMIT 1) AS top_host,
              COUNT(DISTINCT dst_host)::int AS unique_hosts
         FROM blocked_access_log b1
        WHERE detected_at > NOW() - make_interval(hours => $1)
        GROUP BY src_ip
        ORDER BY attempts DESC
        LIMIT 100`,
      [Number(hours)]
    );

    // Enrich each src_ip with current device info from MikroTik
    let devices = [];
    try {
      const { listConnectedDevices } = require('../services/devices.service');
      devices = await listConnectedDevices();
    } catch { /* router unreachable — return rows without enrichment */ }
    const byIp = new Map(devices.map(d => [d.ip, d]));

    const rows = stats.rows.map(r => {
      const d = byIp.get(r.src_ip);
      return {
        src_ip: r.src_ip,
        attempts: r.attempts,
        last_at: r.last_at,
        top_host: r.top_host,
        unique_hosts: r.unique_hosts,
        hostname: d?.hostname || null,
        mac: d?.mac || null,
        type: d?.type || 'unknown',
        vendor: d?.vendor || null,
        active: d?.active || false,
      };
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
