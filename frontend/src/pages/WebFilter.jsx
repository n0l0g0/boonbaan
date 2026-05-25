import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, message, Popconfirm,
  Tag, Space, Switch, Tabs, Card, Row, Col, Badge, Typography,
  Segmented, notification, Checkbox, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, StopOutlined, ThunderboltOutlined,
  ImportOutlined, BellOutlined, ReloadOutlined, WarningOutlined,
  SafetyCertificateOutlined, LockOutlined, UnlockOutlined, ThunderboltFilled,
  MobileOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { useSocket } from '../hooks/useSocket';

const { TextArea } = Input;
const { Text } = Typography;

const PRESETS = [
  {
    category: 'Social Media', color: 'blue',
    sites: [
      { host: '*.facebook.com', label: 'Facebook' },
      { host: '*.instagram.com', label: 'Instagram' },
      { host: '*.tiktok.com', label: 'TikTok' },
      { host: '*.twitter.com', label: 'Twitter/X' },
      { host: '*.x.com', label: 'X.com' },
      { host: '*.line.me', label: 'LINE' },
    ],
  },
  {
    category: 'Streaming / Video', color: 'red',
    sites: [
      { host: '*.youtube.com', label: 'YouTube' },
      { host: '*.netflix.com', label: 'Netflix' },
      { host: '*.twitch.tv', label: 'Twitch' },
    ],
  },
  {
    category: 'Gambling / Adult', color: 'volcano',
    sites: [
      { host: '*.bet365.com', label: 'Bet365' },
      { host: '*.casino.com', label: 'Casino' },
      { host: '*.pornhub.com', label: 'Adult content' },
    ],
  },
  {
    category: 'Games', color: 'purple',
    sites: [
      { host: '*.steampowered.com', label: 'Steam' },
      { host: '*.epicgames.com', label: 'Epic Games' },
      { host: '*.roblox.com', label: 'Roblox' },
    ],
  },
];

const HOURS_OPTIONS = [
  { label: '1 ชม.', value: 1 },
  { label: '6 ชม.', value: 6 },
  { label: '24 ชม.', value: 24 },
  { label: '7 วัน', value: 168 },
];

export default function WebFilter() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [toggling, setToggling] = useState({});
  const [form] = Form.useForm();

  const [blockedLog, setBlockedLog] = useState([]);
  const [blockedStats, setBlockedStats] = useState({ byHost: [], byIp: [] });
  const [blockedByDevice, setBlockedByDevice] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logHours, setLogHours] = useState(24);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [activeTab, setActiveTab] = useState('quick');
  const [selected, setSelected] = useState(new Set());
  const [blocking, setBlocking] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [quickBlocking, setQuickBlocking] = useState(false);
  const [enforcement, setEnforcement] = useState(null);
  const [enforcementLoading, setEnforcementLoading] = useState(false);
  const [quicBlock, setQuicBlock] = useState(null);
  const [quicLoading, setQuicLoading] = useState(false);
  const [verify, setVerify] = useState(null);

  async function loadEnforcement() {
    try {
      const r = await api.get('/webfilter/enforcement');
      setEnforcement(r.data);
    } catch { setEnforcement({ enabled: false }); }
  }

  async function loadQuicBlock() {
    try {
      const r = await api.get('/webfilter/quic-block');
      setQuicBlock(r.data);
    } catch { setQuicBlock({ enabled: false }); }
  }

  async function toggleQuicBlock() {
    setQuicLoading(true);
    try {
      if (quicBlock?.enabled) {
        await api.delete('/webfilter/quic-block');
        message.success('ปิด QUIC Block แล้ว — browser อาจใช้ HTTP/3 bypass การ block ได้');
      } else {
        await api.post('/webfilter/quic-block');
        message.success('เปิด QUIC Block — บังคับใช้ TCP เพื่อให้ SNI inspection ทำงาน');
      }
      await loadQuicBlock();
      await loadVerify();
    } catch { message.error('เกิดข้อผิดพลาด'); }
    setQuicLoading(false);
  }

  async function loadVerify() {
    try {
      const r = await api.get('/webfilter/verify');
      setVerify(r.data);
    } catch { setVerify(null); }
  }

  async function toggleEnforcement() {
    setEnforcementLoading(true);
    try {
      if (enforcement?.enabled) {
        await api.delete('/webfilter/enforcement');
        message.success('ปิด DNS Enforcement แล้ว');
      } else {
        await api.post('/webfilter/enforcement');
        message.success('เปิด DNS Enforcement แล้ว — บังคับ DNS ทุกอุปกรณ์ผ่าน router');
      }
      await loadEnforcement();
    } catch { message.error('เกิดข้อผิดพลาด'); }
    setEnforcementLoading(false);
  }

  async function load() {
    setLoading(true);
    try { setRules((await api.get('/webfilter/rules')).data); } catch { }
    setLoading(false);
  }

  async function loadBlockedLog(hours) {
    setLogLoading(true);
    try {
      const [log, stats, byDev] = await Promise.all([
        api.get(`/webfilter/blocked-log?hours=${hours}&limit=200`),
        api.get(`/webfilter/blocked-stats?hours=${hours}`),
        api.get(`/webfilter/blocked-by-device?hours=${hours}`),
      ]);
      setBlockedLog(log.data);
      setBlockedStats(stats.data);
      setBlockedByDevice(byDev.data);
    } catch { }
    setLogLoading(false);
  }

  const handleBlockedAccess = useCallback((data) => {
    setBlockedLog(prev => [
      { ...data, id: Date.now(), detected_at: data.detectedAt, src_ip: data.srcIp, dst_host: data.dstHost, dst_port: data.dstPort },
      ...prev.slice(0, 199),
    ]);
    setNewAlertCount(n => n + 1);
    notification.warning({
      message: 'ตรวจพบการเข้าถึงเว็บที่ถูก Block',
      description: `IP: ${data.srcIp} พยายามเข้า ${data.dstHost}${data.dstPort ? ':' + data.dstPort : ''}`,
      icon: <WarningOutlined style={{ color: '#faad14' }} />,
      placement: 'topRight',
      duration: 8,
    });
  }, []);

  useSocket('blocked:access', handleBlockedAccess);
  useEffect(() => {
    load(); loadEnforcement(); loadQuicBlock(); loadVerify();
    const t = setInterval(loadVerify, 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { loadBlockedLog(logHours); }, [logHours]);

  // ── rule actions ─────────────────────────────────────────────────────────────

  async function addRule(values) {
    try {
      await api.post('/webfilter/rules', { action: 'deny', ...values });
      message.success('Block สำเร็จ — มีผลทันที');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function blockQuickInput() {
    const domains = quickInput.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    if (!domains.length) return;
    setQuickBlocking(true);
    let ok = 0, skip = 0;
    for (const domain of domains) {
      const host = domain.startsWith('*.') ? domain : `*.${domain}`;
      const apex = domain.startsWith('*.') ? domain.slice(2) : domain;
      if (rules.some(r => r['dst-host'] === host || r['dst-host'] === apex || r['dst-host'] === domain)) {
        skip++; continue;
      }
      try {
        await api.post('/webfilter/rules', { 'dst-host': host, action: 'deny', comment: domain });
        ok++;
      } catch { }
    }
    setQuickBlocking(false);
    setQuickInput('');
    if (ok) message.success(`Block ${ok} domain สำเร็จ — มีผลทันที${skip ? ` (ข้าม ${skip} ที่มีอยู่แล้ว)` : ''}`);
    else message.warning('ทุก domain มี rule อยู่แล้ว');
    load();
  }

  function toggleSelect(host) {
    setSelected(prev => { const n = new Set(prev); n.has(host) ? n.delete(host) : n.add(host); return n; });
  }

  // Find the rule matching a host (handles "*.facebook.com" vs "facebook.com")
  function findRule(host) {
    const n = normalizeHost(host);
    return rules.find(r => normalizeHost(r['dst-host']) === n);
  }

  // Unblock a single host by finding its rule and deleting it
  async function unblockHost(host) {
    const rule = findRule(host);
    if (!rule) return;
    try {
      await api.delete(`/webfilter/rules/${rule['.id']}`);
      message.success(`ปลดล็อค ${host} แล้ว — เข้าได้ทันที`);
      load();
      loadVerify();
    } catch { message.error(`ปลดล็อค ${host} ไม่สำเร็จ`); }
  }

  // Unblock multiple hosts (used by category checkbox when all are blocked)
  async function unblockMany(hosts) {
    let ok = 0;
    for (const host of hosts) {
      const rule = findRule(host);
      if (!rule) continue;
      try { await api.delete(`/webfilter/rules/${rule['.id']}`); ok++; } catch { }
    }
    if (ok) message.success(`ปลดล็อค ${ok} รายการสำเร็จ`);
    load();
    loadVerify();
  }

  // Click on a preset checkbox: if currently blocked → unblock; otherwise toggle selection
  function handlePresetClick(host, isBlocked) {
    if (isBlocked) unblockHost(host);
    else toggleSelect(host);
  }

  function toggleCategory(sites, blockedHosts) {
    const allBlocked = sites.every(s => isHostBlocked(s.host));
    // If every site is blocked → clicking category unblocks all
    if (allBlocked) {
      unblockMany(sites.map(s => s.host));
      return;
    }
    const available = sites.filter(s => !isHostBlocked(s.host)).map(s => s.host);
    const allSelected = available.every(h => selected.has(h));
    setSelected(prev => {
      const n = new Set(prev);
      available.forEach(h => allSelected ? n.delete(h) : n.add(h));
      return n;
    });
  }

  async function blockSelected(blockedHosts) {
    const toBlock = [...selected].filter(h => !isHostBlocked(h));
    if (!toBlock.length) return;
    setBlocking(true);
    let ok = 0;
    for (const host of toBlock) {
      const label = PRESETS.flatMap(p => p.sites).find(s => s.host === host)?.label || host;
      try {
        await api.post('/webfilter/rules', { 'dst-host': host, action: 'deny', comment: label });
        ok++;
      } catch { }
    }
    setBlocking(false);
    setSelected(new Set());
    message.success(`Block ${ok} รายการสำเร็จ — มีผลทันที`);
    load();
  }

  async function bulkImport() {
    const domains = bulkText.split('\n').map(d => d.trim().toLowerCase()).filter(d => d && !d.startsWith('#'));
    if (!domains.length) return;
    setBulkLoading(true);
    let ok = 0, skip = 0;
    for (const domain of domains) {
      const host = domain.startsWith('*.') ? domain : `*.${domain}`;
      const apex = domain.startsWith('*.') ? domain.slice(2) : domain;
      if (rules.some(r => r['dst-host'] === host || r['dst-host'] === apex)) { skip++; continue; }
      try {
        await api.post('/webfilter/rules', { 'dst-host': host, action: 'deny', comment: 'bulk import' });
        ok++;
      } catch { }
    }
    setBulkLoading(false);
    setBulkOpen(false);
    setBulkText('');
    message.success(`เพิ่ม ${ok} domain สำเร็จ — มีผลทันที, ข้าม ${skip} ที่มีอยู่แล้ว`);
    load();
  }

  async function toggleRule(id, currentDisabled) {
    setToggling(t => ({ ...t, [id]: true }));
    try {
      await api.patch(`/webfilter/rules/${id}`, { disabled: currentDisabled === 'true' ? 'false' : 'true' });
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
    setToggling(t => ({ ...t, [id]: false }));
  }

  async function remove(id) {
    try {
      await api.delete(`/webfilter/rules/${id}`);
      message.success('ลบสำเร็จ — unblock ทันที');
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  // ── table columns ─────────────────────────────────────────────────────────────

  const cols = [
    {
      title: 'เปิด/ปิด', width: 80,
      render: (_, r) => (
        <Switch
          size="small"
          checked={r.disabled !== 'true'}
          loading={!!toggling[r['.id']]}
          onChange={() => toggleRule(r['.id'], r.disabled)}
        />
      ),
    },
    {
      title: 'Domain / Host', dataIndex: 'dst-host',
      render: (v, r) => (
        <Text delete={r.disabled === 'true'} style={{ color: r.disabled === 'true' ? '#aaa' : undefined }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'วิธี Block', width: 120,
      render: () => <Tag color="blue" icon={<ThunderboltFilled />}>Firewall Drop</Tag>,
    },
    {
      title: 'Action', dataIndex: 'action', width: 90,
      render: v => <Tag color={v === 'deny' ? 'red' : 'green'}>{v === 'deny' ? 'Block' : 'Allow'}</Tag>,
    },
    { title: 'หมายเหตุ', dataIndex: 'comment', render: v => v || '-' },
    {
      title: '', width: 50,
      render: (_, r) => (
        <Popconfirm title="ลบ rule นี้?" onConfirm={() => remove(r['.id'])}>
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  // Normalize hosts by stripping "*." prefix — backend stores domain without wildcard
  // but presets use "*.facebook.com" form for clarity. Match by normalized form.
  const normalizeHost = h => String(h || '').replace(/^\*\./, '').toLowerCase();
  const blockedHosts = new Set(rules.map(r => normalizeHost(r['dst-host'])));
  const isHostBlocked = h => blockedHosts.has(normalizeHost(h));
  const blocked = rules.filter(r => r.action === 'deny');
  const allowed = rules.filter(r => r.action !== 'deny');

  const blockedLogCols = [
    { title: 'เวลา', dataIndex: 'detected_at', width: 160, render: v => new Date(v).toLocaleString('th-TH') },
    { title: 'IP ต้นทาง', dataIndex: 'src_ip', width: 130, render: v => <Tag color="orange">{v}</Tag> },
    {
      title: 'เว็บที่พยายามเข้า', dataIndex: 'dst_host',
      render: (v, r) => <><Text strong style={{ color: '#ff4d4f' }}>{v}</Text>{r.dst_port ? <Tag style={{ marginLeft: 4 }}>{r.dst_port}</Tag> : null}</>,
    },
    { title: 'แจ้งเตือน', dataIndex: 'notified', width: 90, render: v => v ? <Tag color="green">ส่งแล้ว</Tag> : <Tag>ไม่ส่ง</Tag> },
  ];

  // ── tabs ──────────────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'detect',
      label: <Badge count={newAlertCount} size="small" offset={[6, -2]}><span><BellOutlined /> ตรวจจับ</span></Badge>,
      children: (
        <div>
          <Space style={{ marginBottom: 16 }} wrap>
            <Segmented options={HOURS_OPTIONS} value={logHours} onChange={v => { setLogHours(v); setNewAlertCount(0); }} />
            <Button icon={<ReloadOutlined />} onClick={() => { loadBlockedLog(logHours); setNewAlertCount(0); }} loading={logLoading}>Refresh</Button>
          </Space>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12}>
              <Card size="small" title="Top 5 เว็บที่โดน Block มากสุด">
                {blockedStats.byHost.slice(0, 5).map((r, i) => (
                  <div key={r.dst_host} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Text>{i + 1}. {r.dst_host}</Text>
                    <Tag color="red">{r.count} ครั้ง</Tag>
                  </div>
                ))}
                {!blockedStats.byHost.length && <Text type="secondary">ยังไม่มีข้อมูล</Text>}
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" title="Top 5 IP ที่พยายามเข้ามากสุด">
                {blockedStats.byIp.slice(0, 5).map((r, i) => (
                  <div key={r.src_ip} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Text>{i + 1}. {r.src_ip}</Text>
                    <Tag color="orange">{r.count} ครั้ง</Tag>
                  </div>
                ))}
                {!blockedStats.byIp.length && <Text type="secondary">ยังไม่มีข้อมูล</Text>}
              </Card>
            </Col>
          </Row>
          <Card size="small" title={<><MobileOutlined /> เครื่องที่พยายามเข้าเว็บที่ Block</>} style={{ marginBottom: 16 }}>
            <Table
              dataSource={blockedByDevice}
              rowKey="src_ip"
              size="small"
              loading={logLoading}
              pagination={{ pageSize: 10, size: 'small' }}
              locale={{ emptyText: 'ยังไม่มีข้อมูล' }}
              columns={[
                {
                  title: 'อุปกรณ์', dataIndex: 'hostname',
                  render: (h, r) => {
                    const TYPE_META = {
                      mobile:   { label: 'Mobile',   color: 'blue' },
                      computer: { label: 'Computer', color: 'green' },
                      iot:      { label: 'IoT/TV',   color: 'orange' },
                      network:  { label: 'Network',  color: 'purple' },
                      unknown:  { label: 'Unknown',  color: 'default' },
                    };
                    const meta = TYPE_META[r.type] || TYPE_META.unknown;
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>
                          <Text style={{ fontWeight: 500 }}>{h || <Text type="secondary">—</Text>}</Text>
                          {r.active === false && <Tag style={{ marginLeft: 4 }}>Offline</Tag>}
                        </div>
                        <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                          {r.src_ip}{r.mac ? ` · ${r.mac}` : ''}{r.vendor ? ` · ${r.vendor}` : ''}
                        </Text>
                      </div>
                    );
                  },
                },
                {
                  title: 'เว็บที่เข้าบ่อยสุด', dataIndex: 'top_host', width: 220,
                  render: v => v ? <Text style={{ fontSize: 13, color: '#ff4d4f' }}>{v}</Text> : <Text type="secondary">—</Text>,
                },
                {
                  title: 'จำนวน', dataIndex: 'attempts', width: 100,
                  render: (n, r) => (
                    <div>
                      <Tag color="red" style={{ marginRight: 4 }}>{n} ครั้ง</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>{r.unique_hosts} เว็บ</Text>
                    </div>
                  ),
                  sorter: (a, b) => a.attempts - b.attempts,
                  defaultSortOrder: 'descend',
                },
                {
                  title: 'ล่าสุด', dataIndex: 'last_at', width: 150,
                  render: v => <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleString('th-TH')}</Text>,
                },
              ]}
            />
          </Card>
          <Card size="small" title="รายการเหตุการณ์ทั้งหมด">
            <Table dataSource={blockedLog} columns={blockedLogCols} rowKey="id" loading={logLoading} size="small" pagination={{ pageSize: 50 }} scroll={{ x: 600 }} />
          </Card>
        </div>
      ),
    },
    {
      key: 'quick',
      label: <><ThunderboltOutlined /> Quick Block</>,
      children: (
        <div>
          <Card size="small" style={{ marginBottom: 16 }} title="Block เว็บด่วน — มีผลทันที">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="เช่น facebook.com, tiktok.com, *.example.com"
                value={quickInput}
                onChange={e => setQuickInput(e.target.value)}
                onPressEnter={blockQuickInput}
                style={{ maxWidth: 460 }}
                allowClear
              />
              <Button type="primary" danger icon={<StopOutlined />} loading={quickBlocking} onClick={blockQuickInput}>Block</Button>
            </Space.Compact>
            <div style={{ marginTop: 6, color: '#888', fontSize: 12 }}>
              คั่นด้วย <code>,</code> เพื่อ block หลาย domain พร้อมกัน &nbsp;|&nbsp; Block ผ่าน Firewall Drop — ไม่ต้องรอ DNS TTL
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 16px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
            <Text type="secondary">เลือกจาก preset:</Text>
            <Text>เลือกแล้ว <Text strong>{selected.size}</Text> รายการ</Text>
            <Button type="primary" danger icon={<StopOutlined />} disabled={selected.size === 0} loading={blocking} onClick={() => blockSelected(blockedHosts)}>
              Block ที่เลือก ({selected.size})
            </Button>
            {selected.size > 0 && <Button size="small" onClick={() => setSelected(new Set())}>ล้างที่เลือก</Button>}
          </div>

          {PRESETS.map(preset => {
            const allBlocked = preset.sites.every(s => isHostBlocked(s.host));
            const available = preset.sites.filter(s => !isHostBlocked(s.host));
            const allAvailableSelected = available.length > 0 && available.every(s => selected.has(s.host));
            const someAvailableSelected = available.some(s => selected.has(s.host));
            // Category checkbox: checked when all blocked, indeterminate when partial
            const catChecked = allBlocked || allAvailableSelected;
            const catIndeterminate = !allBlocked && (someAvailableSelected || preset.sites.some(s => isHostBlocked(s.host)));
            return (
              <Card key={preset.category} size="small" style={{ marginBottom: 12 }}
                title={
                  <Space>
                    <Checkbox checked={catChecked} indeterminate={catIndeterminate && !catChecked} onChange={() => toggleCategory(preset.sites, blockedHosts)} />
                    <span>{preset.category}</span>
                    {allBlocked && <Tag color="green">Block ทั้งหมด</Tag>}
                  </Space>
                }
              >
                <Row gutter={[12, 12]}>
                  {preset.sites.map(site => {
                    const isBlocked = blockedHosts.has(site.host);
                    const isSelected = selected.has(site.host);
                    return (
                      <Col key={site.host}>
                        <Checkbox checked={isBlocked || isSelected} onChange={() => handlePresetClick(site.host, isBlocked)}>
                          <span style={{ color: isBlocked ? '#52c41a' : undefined }}>
                            {site.label}
                            {isBlocked && <Tag color="green" style={{ marginLeft: 6, fontSize: 11 }}>Block</Tag>}
                          </span>
                        </Checkbox>
                      </Col>
                    );
                  })}
                </Row>
              </Card>
            );
          })}
        </div>
      ),
    },
    {
      key: 'rules',
      label: `กฎทั้งหมด (${rules.length})`,
      children: (
        <>
          {/* DNS Enforcement banner */}
          <Card size="small" style={{ marginBottom: 16, borderColor: enforcement?.enabled ? '#52c41a' : '#faad14', background: enforcement?.enabled ? '#f6ffed' : '#fffbe6' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 26 }}>
                {enforcement?.enabled ? <LockOutlined style={{ color: '#52c41a' }} /> : <UnlockOutlined style={{ color: '#faad14' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  DNS Enforcement — {enforcement?.enabled ? <Tag color="success">เปิดอยู่</Tag> : <Tag color="warning">ปิดอยู่</Tag>}
                </div>
                {enforcement?.enabled
                  ? <Text type="secondary" style={{ fontSize: 13 }}>Redirect port 53 + block DoT — อุปกรณ์ทุกเครื่องใช้ DNS ผ่าน router เสริมความแน่นอนของ Firewall Block</Text>
                  : <Text style={{ fontSize: 13, color: '#d46b08' }}>แนะนำให้เปิด — ป้องกันกรณี app ใช้ DoH (DNS-over-HTTPS) ซึ่ง Firewall Drop อย่างเดียวอาจไม่ครอบคลุม IP ทั้งหมด</Text>
                }
              </div>
              <Tooltip title={enforcement?.enabled ? 'ปิด DNS redirect rules' : 'เพิ่ม NAT redirect port 53 + block DoT port 853'}>
                <Button
                  type={enforcement?.enabled ? 'default' : 'primary'}
                  danger={enforcement?.enabled}
                  icon={enforcement?.enabled ? <UnlockOutlined /> : <SafetyCertificateOutlined />}
                  loading={enforcementLoading || enforcement === null}
                  onClick={toggleEnforcement}
                >
                  {enforcement?.enabled ? 'ปิด Enforcement' : 'เปิด DNS Enforcement'}
                </Button>
              </Tooltip>
            </div>
          </Card>

          {/* QUIC Kill Switch banner */}
          <Card size="small" style={{ marginBottom: 16, borderColor: quicBlock?.enabled ? '#52c41a' : '#faad14', background: quicBlock?.enabled ? '#f6ffed' : '#fffbe6' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 26 }}>
                {quicBlock?.enabled ? <LockOutlined style={{ color: '#52c41a' }} /> : <UnlockOutlined style={{ color: '#faad14' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  QUIC Block (HTTP/3) — {quicBlock?.enabled ? <Tag color="success">เปิดอยู่</Tag> : <Tag color="warning">ปิดอยู่</Tag>}
                </div>
                {quicBlock?.enabled
                  ? <Text type="secondary" style={{ fontSize: 13 }}>Block UDP/443 — browser ทุกตัวต้อง fallback ใช้ TCP ทำให้ TLS SNI inspection ทำงาน 100%</Text>
                  : <Text style={{ fontSize: 13, color: '#d46b08' }}>แนะนำให้เปิด — Chrome/Edge ใช้ HTTP/3 (QUIC) ซึ่ง MikroTik อ่าน SNI ไม่ได้ → อาจ bypass การ block ของ Facebook/YouTube ได้</Text>
                }
              </div>
              <Tooltip title={quicBlock?.enabled ? 'ลบ UDP/443 drop rule' : 'เพิ่ม firewall drop UDP/443 ทั้งหมด'}>
                <Button
                  type={quicBlock?.enabled ? 'default' : 'primary'}
                  danger={quicBlock?.enabled}
                  icon={quicBlock?.enabled ? <UnlockOutlined /> : <SafetyCertificateOutlined />}
                  loading={quicLoading || quicBlock === null}
                  onClick={toggleQuicBlock}
                >
                  {quicBlock?.enabled ? 'ปิด QUIC Block' : 'เปิด QUIC Block'}
                </Button>
              </Tooltip>
            </div>
          </Card>

          {/* Defense status panel */}
          {verify && (
            <Card size="small" title="สถานะการป้องกัน (Defense Layers)" style={{ marginBottom: 16 }}
                  extra={<Text type="secondary" style={{ fontSize: 11 }}>อัปเดตทุก 15 วินาที</Text>}>
              <Row gutter={[8, 8]}>
                {[
                  { key: 'firewallDrop', label: 'Firewall Drop',  desc: 'Block by IP/CIDR' },
                  { key: 'tlsSni',       label: 'TLS SNI',        desc: 'Block by hostname' },
                  { key: 'dnsNxdomain',  label: 'DNS NXDOMAIN',   desc: 'DNS-level block' },
                  { key: 'dnsHijack',    label: 'DNS Hijack',     desc: 'Force router DNS' },
                  { key: 'dohBlock',     label: 'DoH/DoT Block',  desc: 'Block external DNS' },
                  { key: 'quicBlock',    label: 'QUIC Block',     desc: 'Force TCP for SNI' },
                ].map(item => {
                  const l = verify.layers[item.key] || {};
                  const color = l.status === 'ok' ? '#52c41a' : l.status === 'wrong-position' ? '#ff4d4f' : '#bfbfbf';
                  const icon = l.status === 'ok' ? '✓' : l.status === 'wrong-position' ? '✗' : '○';
                  return (
                    <Col xs={12} sm={8} md={4} key={item.key}>
                      <div style={{ padding: '8px 10px', border: `1px solid ${color}40`, borderRadius: 6, background: `${color}10` }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color }}>{icon} {item.label}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{item.desc}{l.count !== undefined ? ` (${l.count})` : ''}</div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
              <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
                <Text strong>Blocked:</Text> {verify.stats.blockedDomains} domains, {verify.stats.blockedIps} IPs, {verify.stats.sniRules} SNI rules, {verify.stats.dnsStatic} NXDOMAIN entries
              </div>
            </Card>
          )}

          <Space style={{ marginBottom: 12 }} wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>เพิ่ม Rule</Button>
            <Button icon={<ImportOutlined />} onClick={() => setBulkOpen(true)}>Import หลาย Domain</Button>
          </Space>
          <Table
            dataSource={rules}
            columns={cols}
            rowKey=".id"
            loading={loading}
            size="small"
            pagination={{ pageSize: 20 }}
            rowClassName={r => r.disabled === 'true' ? 'opacity-50' : ''}
          />
        </>
      ),
    },
    {
      key: 'stats',
      label: 'สรุป',
      children: (
        <Row gutter={16}>
          <Col xs={12} sm={6}><Card size="small"><div style={{ fontSize: 28, fontWeight: 700, color: '#ff4d4f' }}>{blocked.length}</div><div>Block rules</div></Card></Col>
          <Col xs={12} sm={6}><Card size="small"><div style={{ fontSize: 28, fontWeight: 700, color: '#52c41a' }}>{allowed.length}</div><div>Allow rules</div></Card></Col>
          <Col xs={12} sm={6}><Card size="small"><div style={{ fontSize: 28, fontWeight: 700, color: '#faad14' }}>{rules.filter(r => r.disabled === 'true').length}</div><div>ปิดใช้งาน</div></Card></Col>
          <Col xs={12} sm={6}><Card size="small"><div style={{ fontSize: 28, fontWeight: 700 }}>{rules.length}</div><div>ทั้งหมด</div></Card></Col>
        </Row>
      ),
    },
  ];

  return (
    <>
      <Tabs items={tabItems} activeKey={activeTab} onChange={k => { setActiveTab(k); if (k === 'detect') setNewAlertCount(0); }} />

      <Modal title="เพิ่ม Web Filter Rule" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addRule}>
          <Form.Item name="dst-host" label="Domain / Host" rules={[{ required: true }]} extra="เช่น *.facebook.com หรือ example.com — Block ผ่าน Firewall Drop ทันที">
            <Input placeholder="*.facebook.com" />
          </Form.Item>
          <Form.Item name="action" label="Action" initialValue="deny">
            <Select options={[{ value: 'deny', label: '🚫 Deny (Block)' }, { value: 'allow', label: '✅ Allow' }]} />
          </Form.Item>
          <Form.Item name="comment" label="หมายเหตุ"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={<><ImportOutlined /> Import หลาย Domain</>}
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={bulkImport}
        okText="Block ทั้งหมด"
        okButtonProps={{ danger: true, loading: bulkLoading }}
      >
        <Text type="secondary">วาง domain ทีละบรรทัด (ใส่ # นำหน้าเพื่อ comment)</Text>
        <TextArea
          rows={10}
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          placeholder={'facebook.com\ninstagram.com\nyoutube.com\n# gambling\nbet365.com'}
          style={{ marginTop: 8, fontFamily: 'monospace' }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>จะ Block ผ่าน Firewall Drop — มีผลทันที ไม่ต้องรอ DNS TTL</Text>
      </Modal>
    </>
  );
}
