const router = require('express').Router();
const auth = require('../middleware/auth');
const { collectAll } = require('../services/monitor.service');

router.get('/', auth, async (req, res) => {
  try { res.json(await collectAll()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
