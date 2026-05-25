// Mirror of backend/src/utils/passwordPolicy.js — keep rule IDs/labels in sync.

export const PASSWORD_RULES = [
  { id: 'length', label: 'อย่างน้อย 8 ตัวอักษร',          test: (p) => p.length >= 8 },
  { id: 'lower',  label: 'มีตัวพิมพ์เล็ก (a-z)',           test: (p) => /[a-z]/.test(p) },
  { id: 'upper',  label: 'มีตัวพิมพ์ใหญ่ (A-Z)',           test: (p) => /[A-Z]/.test(p) },
  { id: 'digit',  label: 'มีตัวเลข (0-9)',                 test: (p) => /\d/.test(p) },
  { id: 'symbol', label: 'มีอักษรพิเศษ (เช่น !@#$%^&*)',   test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function passwordIssues(pw) {
  const s = String(pw || '');
  return PASSWORD_RULES.filter(r => !r.test(s));
}

export function passwordStrengthScore(pw) {
  const s = String(pw || '');
  return PASSWORD_RULES.reduce((n, r) => n + (r.test(s) ? 1 : 0), 0);
}
