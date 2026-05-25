const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

router.get('/interfaces', auth, async (req, res) => {
  try { res.json(await mikrotik.getInterfaces()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/addresses', auth, async (req, res) => {
  try { res.json(await mikrotik.getAddresses()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/dhcp-leases', auth, async (req, res) => {
  try { res.json(await mikrotik.getDhcpLeases()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/routerboard', auth, async (req, res) => {
  try { res.json(await mikrotik.getRouterboard()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
