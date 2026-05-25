const { query } = require('./db');

const migrations = [
  `CREATE TABLE IF NOT EXISTS bandwidth_history (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rx_bps BIGINT NOT NULL DEFAULT 0,
    tx_bps BIGINT NOT NULL DEFAULT 0,
    rx_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    tx_pct NUMERIC(5,2) NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_bandwidth_history_time ON bandwidth_history (recorded_at DESC)`,

  `CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level VARCHAR(20) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT,
    notified_email BOOLEAN DEFAULT FALSE,
    notified_chat BOOLEAN DEFAULT FALSE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_alert_history_time ON alert_history (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS backup_history (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    error_message TEXT,
    drive_file_id VARCHAR(255),
    drive_link TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `INSERT INTO settings (key, value) VALUES
    ('threshold_warning', '80'),
    ('threshold_critical', '90'),
    ('wan_bandwidth_mbps', '100'),
    ('wan_interface', 'ether1'),
    ('backup_schedule', '0 2 * * *'),
    ('alert_email_enabled', 'true'),
    ('alert_chat_enabled', 'true'),
    ('blocked_access_notify', 'true'),
    ('blocked_access_cooldown_sec', '300')
  ON CONFLICT (key) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS blocked_access_log (
    id SERIAL PRIMARY KEY,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    src_ip VARCHAR(45) NOT NULL,
    dst_host VARCHAR(500) NOT NULL,
    dst_port VARCHAR(10),
    raw_message TEXT,
    notified BOOLEAN DEFAULT FALSE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_blocked_access_time ON blocked_access_log (detected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_blocked_access_src ON blocked_access_log (src_ip)`,
  `CREATE INDEX IF NOT EXISTS idx_blocked_access_host ON blocked_access_log (dst_host)`,

  // Multi-user
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
  )`,

  // Multi-router
  `CREATE TABLE IF NOT EXISTS routers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 443,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    use_ssl BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Uptime history (track reboots/downtime)
  `CREATE TABLE IF NOT EXISTS uptime_history (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uptime_seconds BIGINT NOT NULL,
    event VARCHAR(20) DEFAULT 'heartbeat'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_uptime_history_time ON uptime_history (recorded_at DESC)`,

  // Scheduler
  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    cron_expr VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run TIMESTAMPTZ,
    last_status VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Remove duplicate scheduled_tasks (older versions inserted on every restart)
  // — keep the oldest row per (name, type) and disable extras
  `DELETE FROM scheduled_tasks t1 USING scheduled_tasks t2
   WHERE t1.id > t2.id AND t1.name = t2.name AND t1.type = t2.type`,

  // Enforce uniqueness so future inserts can use ON CONFLICT
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_tasks_unique ON scheduled_tasks (name, type)`,

  `INSERT INTO scheduled_tasks (name, type, cron_expr, enabled) VALUES
    ('Daily Backup', 'backup', '0 2 * * *', true),
    ('Weekly Reboot', 'reboot', '0 4 * * 0', false)
  ON CONFLICT (name, type) DO NOTHING`,

  `INSERT INTO settings (key, value) VALUES
    ('line_notify_token', ''),
    ('line_notify_enabled', 'false'),
    ('multi_router_enabled', 'false')
  ON CONFLICT (key) DO NOTHING`,

  // Router logs — 90-day searchable history
  `CREATE TABLE IF NOT EXISTS router_logs (
    id BIGSERIAL PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    log_time TIMESTAMPTZ,
    topics VARCHAR(255),
    level VARCHAR(20),
    message TEXT NOT NULL,
    username VARCHAR(100),
    src_ip VARCHAR(45),
    raw_time VARCHAR(50)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_collected ON router_logs (collected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_topics ON router_logs (topics)`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_level ON router_logs (level)`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_username ON router_logs (username)`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_src_ip ON router_logs (src_ip)`,
  `CREATE INDEX IF NOT EXISTS idx_router_logs_message ON router_logs USING gin(to_tsvector('simple', message))`,

  // Track last collected MikroTik log ID to avoid re-importing
  `CREATE TABLE IF NOT EXISTS log_collector_state (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // Export history
  `ALTER TABLE backup_history ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'backup'`,

  // Google OAuth
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(500)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL`,

  // Site usage historical snapshots (2-year retention)
  `CREATE TABLE IF NOT EXISTS site_usage_snapshot (
    id SERIAL PRIMARY KEY,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    site_name VARCHAR(100) NOT NULL,
    dns_count INTEGER NOT NULL DEFAULT 0,
    pct DECIMAL(5,2),
    color VARCHAR(20),
    logo VARCHAR(255)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sus_at ON site_usage_snapshot (snapshot_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sus_name ON site_usage_snapshot (site_name)`,

  `CREATE TABLE IF NOT EXISTS site_usage_domain_snapshot (
    id SERIAL PRIMARY KEY,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    category VARCHAR(100) NOT NULL,
    base_domain VARCHAR(255) NOT NULL,
    dns_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_suds_at ON site_usage_domain_snapshot (snapshot_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_suds_cat ON site_usage_domain_snapshot (category)`,

  // Device history — connect/disconnect/change events for clients on the network
  `CREATE TABLE IF NOT EXISTS device_history (
    id SERIAL PRIMARY KEY,
    mac VARCHAR(32) NOT NULL,
    ip VARCHAR(45),
    hostname VARCHAR(255),
    type VARCHAR(20),
    vendor VARCHAR(64),
    event VARCHAR(20) NOT NULL,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devhist_at ON device_history (seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_devhist_mac ON device_history (mac)`,
  `CREATE INDEX IF NOT EXISTS idx_devhist_type ON device_history (type)`,

  // Custom alert rules — user-defined thresholds (e.g. device count > 50, bandwidth > X% for Y min)
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    metric VARCHAR(50) NOT NULL,
    comparator VARCHAR(4) NOT NULL,
    threshold NUMERIC NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled)`,

  // Per-device daily usage aggregate (from conntrack delta sampling)
  `CREATE TABLE IF NOT EXISTS device_usage_daily (
    id SERIAL PRIMARY KEY,
    day DATE NOT NULL,
    mac VARCHAR(32) NOT NULL,
    ip VARCHAR(45),
    hostname VARCHAR(255),
    type VARCHAR(20),
    vendor VARCHAR(64),
    rx_bytes BIGINT NOT NULL DEFAULT 0,
    tx_bytes BIGINT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dud_day_mac ON device_usage_daily (day, mac)`,
  `CREATE INDEX IF NOT EXISTS idx_dud_day ON device_usage_daily (day DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dud_mac ON device_usage_daily (mac)`,

  // Per-device connection history — one row per conntrack "session" (one
  // conntrack id while it stays alive). Closed sessions keep closed_at set.
  `CREATE TABLE IF NOT EXISTS device_connection_history (
    id BIGSERIAL PRIMARY KEY,
    session_key VARCHAR(64) NOT NULL UNIQUE,
    device_mac VARCHAR(32),
    device_ip  VARCHAR(45),
    dst_ip     VARCHAR(45) NOT NULL,
    dst_port   INTEGER,
    protocol   VARCHAR(10),
    tcp_state  VARCHAR(20),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_bytes BIGINT NOT NULL DEFAULT 0,
    closed_at  TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dch_device_mac_time ON device_connection_history (device_mac, first_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dch_device_ip_time  ON device_connection_history (device_ip, first_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dch_last_seen       ON device_connection_history (last_seen)`,

  // MikroTik connection settings (seed from env if not set)
  `INSERT INTO settings (key, value) VALUES
    ('mikrotik_host', '${process.env.MIKROTIK_HOST || '192.168.88.1'}'),
    ('mikrotik_port', '${process.env.MIKROTIK_PORT || '443'}'),
    ('mikrotik_user', '${process.env.MIKROTIK_USER || 'admin'}'),
    ('mikrotik_pass', '${process.env.MIKROTIK_PASS || ''}'),
    ('mikrotik_ssl',  '${process.env.MIKROTIK_SSL  || 'true'}')
  ON CONFLICT (key) DO NOTHING`,
];

async function runMigrations() {
  console.log('Running DB migrations...');
  for (const sql of migrations) {
    await query(sql);
  }
  console.log('DB migrations complete.');
}

module.exports = { runMigrations };
