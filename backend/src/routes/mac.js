const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

router.get('/', auth, async (req, res) => {
  try {
    const [bindings, arp] = await Promise.all([mikrotik.getMacBindings(), mikrotik.getArp()]);
    res.json({ bindings, arp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const result = await mikrotik.addMacBinding(req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await mikrotik.removeMacBinding(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
