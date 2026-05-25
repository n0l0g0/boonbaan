// Shared password complexity policy. Keep rule IDs in sync with the frontend
// checklist (frontend/src/utils/passwordPolicy.js) so messages line up.

const RULES = [
  { id: 'length', label: 'อย่างน้อย 8 ตัวอักษร',          test: (p) => p.length >= 8 },
  { id: 'lower',  label: 'มีตัวพิมพ์เล็ก (a-z)',           test: (p) => /[a-z]/.test(p) },
  { id: 'upper',  label: 'มีตัวพิมพ์ใหญ่ (A-Z)',           test: (p) => /[A-Z]/.test(p) },
  { id: 'digit',  label: 'มีตัวเลข (0-9)',                 test: (p) => /\d/.test(p) },
  { id: 'symbol', label: 'มีอักษรพิเศษ (เช่น !@#$%^&*)',   test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function validatePassword(pw) {
  const s = String(pw || '');
  return RULES.filter(r => !r.test(s)).map(r => r.label);
}

module.exports = { validatePassword, RULES };
