const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');

router.get('/', auth, async (req, res) => {
  try {
    const [regs, aps] = await Promise.allSettled([
      mikrotik.getCapsmanRegistrations(),
      mikrotik.getCapsmanAps(),
    ]);
    res.json({ registrations: regs.value || [], accessPoints: aps.value || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
