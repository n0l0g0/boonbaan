// Pattern-based threat classifier for MikroTik router logs.
// Returns { category, severity } where severity ∈ {critical, high, medium, low, none}.
// Category is null for unmatched / routine messages.
//
// Categories are coarse on purpose — admins want to know "what kind of dangerous
// thing happened" without drowning in 30 buckets. Add new ones sparingly.

const RULES = [
  // -- Authentication / access attacks ---------------------------------------
  {
    category: 'auth_failure',
    severity: 'high',
    test: (msg, topics) =>
      /login failure for user/i.test(msg) ||
      /failed login/i.test(msg) ||
      /authentication failed/i.test(msg) ||
      /invalid user name or password/i.test(msg) ||
      (/account|system/.test(topics) && /denied|rejected/i.test(msg)),
  },
  {
    category: 'vpn_auth_failure',
    severity: 'high',
    test: (msg, topics) =>
      /(l2tp|pptp|ppp|ovpn|sstp|ipsec)/i.test(topics) &&
      (/auth.*fail/i.test(msg) || /unknown user/i.test(msg) || /reject/i.test(msg)),
  },
  {
    category: 'hotspot_auth_failure',
    severity: 'medium',
    test: (msg, topics) =>
      /hotspot/i.test(topics) &&
      (/login failed/i.test(msg) || /invalid user/i.test(msg) || /password mismatch/i.test(msg)),
  },

  // -- System integrity ------------------------------------------------------
  {
    category: 'system_reboot',
    severity: 'high',
    test: (msg) => /rebooted by|router rebooted|system started|shutdown/i.test(msg),
  },
  {
    category: 'config_change',
    severity: 'medium',
    test: (msg, topics) =>
      /system,info,account/i.test(topics) ||
      /(changed by|added by|removed by)\s+\S+/i.test(msg),
  },

  // -- Network / firewall ----------------------------------------------------
  {
    category: 'blacklist_hit',
    severity: 'high',
    test: (msg) => /blacklist|drop[_-]?bl|tarpit|blocked[_-]?ip/i.test(msg),
  },
  {
    category: 'firewall_drop',
    severity: 'low',
    test: (msg, topics) =>
      /firewall/i.test(topics) &&
      /(drop|reject)/i.test(msg) &&
      !/established|related/i.test(msg),
  },
  {
    category: 'dhcp_conflict',
    severity: 'medium',
    test: (msg, topics) =>
      /dhcp/i.test(topics) && (/duplicate|conflict|offered.*already/i.test(msg)),
  },

  // -- Application errors ----------------------------------------------------
  {
    category: 'critical_error',
    severity: 'critical',
    test: (msg, topics) =>
      /critical/i.test(topics) ||
      /panic|fatal|out of memory|disk full/i.test(msg),
  },
  {
    category: 'router_error',
    severity: 'medium',
    test: (msg, topics) => /error/i.test(topics) && !/login/i.test(msg),
  },
  {
    category: 'router_warning',
    severity: 'low',
    test: (msg, topics) => /warning/i.test(topics),
  },
];

function classify(message = '', topics = '') {
  for (const rule of RULES) {
    if (rule.test(message, topics)) {
      return { category: rule.category, severity: rule.severity };
    }
  }
  return { category: null, severity: 'none' };
}

const CATEGORIES = RULES.map(r => r.category);
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'];

module.exports = { classify, CATEGORIES, SEVERITIES };
