const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const { topDevices } = require('../services/deviceusage.service');

// Bandwidth history:
//   ?hours=1|6|24|168  (legacy: window ending NOW)
//   ?from=ISO&to=ISO    (explicit date range)
router.get('/bandwidth', auth, async (req, res) => {
  const { from, to } = req.query;
  try {
    let startDate, endDate;
    if (from && to) {
      startDate = new Date(from);
      endDate = new Date(to);
      if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) {
        return res.status(400).json({ error: 'invalid from/to' });
      }
    } else {
      const hours = Math.min(Number(req.query.hours) || 1, 24 * 366);
      endDate = new Date();
      startDate = new Date(endDate.getTime() - hours * 3600 * 1000);
    }

    const spanMs = endDate - startDate;
    const spanH = spanMs / 3600000;
    // bucket size: <=24h => minute, <=7d => hour, else => day
    const bucket = spanH <= 24 ? 'minute' : (spanH <= 24 * 7 ? 'hour' : 'day');

    const r = await query(
      `SELECT
        date_trunc($3, recorded_at) AS t,
        ROUND(AVG(rx_bps)) AS rx_bps,
        ROUND(AVG(tx_bps)) AS tx_bps,
        ROUND(MAX(rx_bps)) AS rx_bps_max,
        ROUND(MAX(tx_bps)) AS tx_bps_max,
        ROUND(AVG(rx_pct)::numeric, 2) AS rx_pct,
        ROUND(AVG(tx_pct)::numeric, 2) AS tx_pct
       FROM bandwidth_history
       WHERE recorded_at >= $1 AND recorded_at < $2
       GROUP BY t ORDER BY t ASC`,
      [startDate, endDate, bucket]
    );
    res.json({ bucket, from: startDate, to: endDate, data: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Alert history
router.get('/alerts', auth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const level = req.query.level;
  try {
    const params = level ? [level, limit] : [limit];
    const where = level ? 'WHERE level = $1' : '';
    const limitParam = level ? '$2' : '$1';
    const r = await query(
      `SELECT * FROM alert_history ${where} ORDER BY created_at DESC LIMIT ${limitParam}`,
      params
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Top devices by usage in a date range
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=10  (defaults: today, 10)
router.get('/top-devices', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to = req.query.to || today;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    }
    const rows = await topDevices({ from, to, limit });
    res.json({ from, to, devices: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
