const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');
const crypto = require('crypto');

function generateCode(length = 8) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length).toUpperCase();
}

// Generate vouchers (creates hotspot users)
router.post('/generate', auth, async (req, res) => {
  const { count = 1, profile = 'default', prefix = 'V', codeLength = 8, comment = 'voucher' } = req.body;
  if (count > 100) return res.status(400).json({ error: 'Max 100 vouchers per batch' });

  const vouchers = [];
  for (let i = 0; i < count; i++) {
    const code = `${prefix}-${generateCode(codeLength)}`;
    try {
      await mikrotik.addHotspotUser({ name: code, password: code, profile, comment });
      vouchers.push({ code, profile, comment });
    } catch (e) {
      vouchers.push({ code, error: e.message });
    }
  }
  res.json(vouchers);
});

// List existing voucher-type users
router.get('/', auth, async (req, res) => {
  try {
    const users = await mikrotik.getHotspotUsers();
    const vouchers = users.filter(u => u.comment === 'voucher' || u.name?.match(/^[A-Z]+-[A-Z0-9]+$/));
    res.json(vouchers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
