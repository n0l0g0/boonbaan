const router = require('express').Router();
const auth = require('../middleware/auth');
const { listConnectedDevices, deviceBreakdown, getDeviceHistory, getDeviceConnections, getDeviceConnectionsHistory, getDeviceSessions, getDeviceDailyUsage } = require('../services/devices.service');

router.get('/', auth, async (req, res) => {
  try { res.json(await listConnectedDevices()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/breakdown', auth, async (req, res) => {
  try { res.json(await deviceBreakdown()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /devices/connections?ip=192.168.1.50 — active connections from a device
router.get('/connections', auth, async (req, res) => {
  try {
    const { ip } = req.query;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    res.json(await getDeviceConnections(ip));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /devices/connections-history?ip=...&hours=24 — past sessions from DB
router.get('/connections-history', auth, async (req, res) => {
  try {
    const { ip, mac, hours = 24, limit = 500 } = req.query;
    if (!ip && !mac) return res.status(400).json({ error: 'ip or mac required' });
    res.json(await getDeviceConnectionsHistory({ ip, mac, hours: Number(hours), limit: Number(limit) }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /devices/sessions?mac=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Online sessions per day (derived from connect/disconnect events)
router.get('/sessions', auth, async (req, res) => {
  try {
    const { mac, from, to } = req.query;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    const today = new Date().toISOString().slice(0, 10);
    res.json(await getDeviceSessions({ mac, from: from || today, to: to || today }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /devices/usage?mac=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Daily RX/TX bytes (from device_usage_daily)
router.get('/usage', auth, async (req, res) => {
  try {
    const { mac, from, to } = req.query;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    const today = new Date().toISOString().slice(0, 10);
    res.json(await getDeviceDailyUsage({ mac, from: from || today, to: to || today }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history', auth, async (req, res) => {
  try {
    const { mac, type, hours = 24, limit = 200 } = req.query;
    res.json(await getDeviceHistory({ mac, type, hours: Number(hours), limit: Number(limit) }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
