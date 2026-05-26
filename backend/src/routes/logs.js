const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const { collectLogs, backfillClassification } = require('../services/logcollector.service');
const { CATEGORIES, SEVERITIES } = require('../services/logClassifier');

// Search DB logs (90-day history)
router.get('/', auth, async (req, res) => {
  try {
    const {
      search = '',
      topics = '',
      level = '',
      username = '',
      src_ip = '',
      category = '',
      severity = '',
      from,
      to,
      page = 1,
      limit = 100,
    } = req.query;

    const conditions = [];
    const params = [];
    let p = 1;

    if (search) {
      conditions.push(`to_tsvector('simple', message) @@ plainto_tsquery('simple', $${p++})`);
      params.push(search);
    }
    if (topics) {
      conditions.push(`topics ILIKE $${p++}`);
      params.push(`%${topics}%`);
    }
    if (level) {
      conditions.push(`level = $${p++}`);
      params.push(level);
    }
    if (username) {
      conditions.push(`username ILIKE $${p++}`);
      params.push(`%${username}%`);
    }
    if (src_ip) {
      conditions.push(`src_ip ILIKE $${p++}`);
      params.push(`%${src_ip}%`);
    }
    if (category && CATEGORIES.includes(category)) {
      conditions.push(`category = $${p++}`);
      params.push(category);
    }
    if (severity && SEVERITIES.includes(severity)) {
      conditions.push(`severity = $${p++}`);
      params.push(severity);
    }
    if (from) {
      conditions.push(`collected_at >= $${p++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`collected_at <= $${p++}`);
      params.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);

    const [rows, count] = await Promise.all([
      query(
        `SELECT id,
                collected_at,
                log_time,
                topics, level, message, username, src_ip, raw_time,
                category, severity
         FROM router_logs ${where}
         ORDER BY collected_at DESC
         LIMIT $${p++} OFFSET $${p++}`,
        [...params, Number(limit), offset]
      ),
      query(`SELECT COUNT(*) FROM router_logs ${where}`, params),
    ]);

    res.json({
      total: Number(count.rows[0].count),
      page: Number(page),
      limit: Number(limit),
      data: rows.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trigger immediate log collection
router.post('/collect', auth, async (req, res) => {
  try {
    await collectLogs();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Summary: unique usernames with activity counts
router.get('/users', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT username, src_ip, COUNT(*) as count,
              MAX(collected_at AT TIME ZONE 'Asia/Bangkok') as last_seen,
              MIN(collected_at AT TIME ZONE 'Asia/Bangkok') as first_seen
       FROM router_logs
       WHERE username IS NOT NULL AND collected_at > NOW() - INTERVAL '180 days'
       GROUP BY username, src_ip
       ORDER BY count DESC
       LIMIT 100`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Threat summary: dangerous events grouped by category for a time window
router.get('/dangerous-summary', auth, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
    const r = await query(
      `SELECT category, severity, COUNT(*)::int as count,
              MAX(collected_at) as last_seen
         FROM router_logs
        WHERE collected_at > NOW() - ($1::int * INTERVAL '1 hour')
          AND severity IN ('critical', 'high', 'medium')
          AND category IS NOT NULL
        GROUP BY category, severity
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          count DESC`,
      [hours]
    );
    res.json({ hours, rows: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Filter option metadata (categories + severities available)
router.get('/categories', auth, (req, res) => {
  res.json({ categories: CATEGORIES, severities: SEVERITIES });
});

// Backfill classification for existing rows where severity IS NULL
router.post('/reclassify', auth, async (req, res) => {
  try {
    const updated = await backfillClassification();
    res.json({ ok: true, updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
