const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

router.get('/secrets', auth, async (req, res) => {
  try { res.json(await mikrotik.getPppSecrets()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/secrets', auth, async (req, res) => {
  try { res.json(await mikrotik.addPppSecret(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/secrets/:id', auth, async (req, res) => {
  try { res.json(await mikrotik.updatePppSecret(req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/secrets/:id', auth, async (req, res) => {
  try { await mikrotik.removePppSecret(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/active', auth, async (req, res) => {
  try { res.json(await mikrotik.getPppActive()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/server', auth, async (req, res) => {
  try {
    const [l2tp, pptp] = await Promise.allSettled([mikrotik.getL2tpServer(), mikrotik.getPptpServer()]);
    res.json({ l2tp: l2tp.value, pptp: pptp.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
