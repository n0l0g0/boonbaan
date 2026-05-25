const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

// List all interfaces from MikroTik
router.get('/interfaces', auth, async (req, res) => {
  try {
    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();
    const data = await mk.get('/interface').then(r => r.data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Network scan: ARP + DHCP leases + neighbors merged
router.get('/scan', auth, async (req, res) => {
  try {
    const [arp, leases, neighbors] = await Promise.allSettled([
      mikrotik.getArp(),
      mikrotik.getDhcpLeases(),
      mikrotik.getInterfaces().then(() => mikrotik.getMikrotikClient?.()
        ? [] : []
      ).catch(() => []),
    ]);

    const arpList = arp.value || [];
    const leaseList = leases.value || [];

    // Merge by MAC
    const deviceMap = new Map();
    for (const a of arpList) {
      const mac = a['mac-address'];
      if (!mac) continue;
      deviceMap.set(mac, {
        mac,
        ip: a.address,
        interface: a.interface,
        status: a.status || 'reachable',
        hostname: null,
        source: 'arp',
      });
    }
    for (const l of leaseList) {
      const mac = l['mac-address'];
      if (!mac) continue;
      const existing = deviceMap.get(mac) || { mac, ip: l.address, interface: null, status: l.status };
      deviceMap.set(mac, { ...existing, hostname: l['host-name'] || null, leaseStatus: l.status, source: 'dhcp' });
    }

    res.json(Array.from(deviceMap.values()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bandwidth per IP using MikroTik IP Accounting
router.get('/ip-bandwidth', auth, async (req, res) => {
  try {
    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();
    const snapshot = await mk.get('/ip/accounting/snapshot').then(r => r.data).catch(() => []);
    res.json(snapshot);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Enable IP Accounting on router
router.post('/ip-accounting/enable', auth, async (req, res) => {
  try {
    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();
    await mk.patch('/ip/accounting', { enabled: 'yes', 'account-local-traffic': 'no', threshold: '256' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ip-accounting/snapshot', auth, async (req, res) => {
  try {
    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();
    await mk.post('/ip/accounting/snapshot/take', {});
    const data = await mk.get('/ip/accounting/snapshot').then(r => r.data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
