const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

router.get('/users', auth, async (req, res) => {
  try { res.json(await mikrotik.getHotspotUsers()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users', auth, async (req, res) => {
  try { res.json(await mikrotik.addHotspotUser(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/users/:id', auth, async (req, res) => {
  try { res.json(await mikrotik.updateHotspotUser(req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', auth, async (req, res) => {
  try { await mikrotik.removeHotspotUser(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/active', auth, async (req, res) => {
  try { res.json(await mikrotik.getHotspotActive()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
