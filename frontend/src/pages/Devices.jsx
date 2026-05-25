import { useEffect, useState, useMemo } from 'react';
import { Card, Col, Row, Table, Tag, Typography, Statistic, Button, Select, Input, Modal, Spin, Empty, Tabs, DatePicker } from 'antd';
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import {
  MobileOutlined, DesktopOutlined, CloudOutlined, ClusterOutlined,
  QuestionCircleOutlined, ReloadOutlined, HistoryOutlined, LinkOutlined,
  ClockCircleOutlined, BarChartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/th';
import api from '../services/api';

dayjs.extend(relativeTime);
dayjs.locale('th');

const { Title, Text } = Typography;

const TYPE_META = {
  mobile:   { label: 'Mobile',   color: '#1677ff', icon: <MobileOutlined /> },
  computer: { label: 'Computer', color: '#52c41a', icon: <DesktopOutlined /> },
  iot:      { label: 'IoT/TV',   color: '#faad14', icon: <CloudOutlined /> },
  network:  { label: 'Network',  color: '#722ed1', icon: <ClusterOutlined /> },
  unknown:  { label: 'Unknown',  color: '#bfbfbf', icon: <QuestionCircleOutlined /> },
};

function TypeTag({ type }) {
  const m = TYPE_META[type] || TYPE_META.unknown;
  return <Tag icon={m.icon} color={m.color}>{m.label}</Tag>;
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 100 ? 0 : 1)} ${u[i]}`;
}

// Palette for pie slices (cycled if more entries than colors)
const PIE_COLORS = ['#1677ff', '#52c41a', '#faad14', '#722ed1', '#eb2f96', '#13c2c2', '#fa541c', '#a0d911', '#2f54eb', '#fa8c16'];
const OTHERS_COLOR = '#bfbfbf';

// Group connections into pie chart data; top 8 + "Others"
function buildPieData(connections) {
  if (!connections?.length) return [];
  // Aggregate by display key — friendly name first, then domain base, then IP
  const buckets = new Map();
  for (const c of connections) {
    const key = c.friendlyName || c.faviconDomain || c.domain || c.dstIp;
    const existing = buckets.get(key);
    if (existing) {
      existing.value += c.totalBytes;
      existing.connections += c.connections;
    } else {
      buckets.set(key, {
        name: key,
        value: c.totalBytes,
        faviconDomain: c.faviconDomain,
        connections: c.connections,
      });
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 8).map((d, i) => ({ ...d, color: PIE_COLORS[i % PIE_COLORS.length] }));
  const rest = sorted.slice(8);
  if (rest.length) {
    top.push({
      name: `อื่นๆ (${rest.length})`,
      value: rest.reduce((s, x) => s + x.value, 0),
      connections: rest.reduce((s, x) => s + x.connections, 0),
      color: OTHERS_COLOR,
    });
  }
  const total = top.reduce((s, x) => s + x.value, 0) || 1;
  return top.map(d => ({ ...d, pct: +((d.value / total) * 100).toFixed(1) }));
}

function ConnectionPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {d.faviconDomain && (
          <img src={`https://www.google.com/s2/favicons?domain=${d.faviconDomain}&sz=32`} alt="" width={18} height={18} style={{ borderRadius: 3 }} />
        )}
        <strong style={{ fontSize: 13 }}>{d.name}</strong>
      </div>
      <div style={{ color: d.color, fontWeight: 600, fontSize: 14 }}>{fmtBytes(d.value)} · {d.pct}%</div>
      <div style={{ color: '#888', fontSize: 11 }}>{d.connections} connections</div>
    </div>
  );
}

function formatDuration(sec) {
  if (!sec || sec < 0) return '0 วินาที';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m} นาที ${s} วินาที`;
  return `${s} วินาที`;
}

// 24-hour horizontal bar showing online segments for one day
function SessionTimeline({ day, sessions }) {
  const dayStart = dayjs(day).startOf('day');
  const totalMs = 24 * 3600 * 1000;
  return (
    <div>
      <div style={{ position: 'relative', height: 22, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
        {sessions.map((s, i) => {
          const startMs = Math.max(0, dayjs(s.start).diff(dayStart));
          const endMs   = Math.min(totalMs, dayjs(s.end).diff(dayStart));
          const left  = (startMs / totalMs) * 100;
          const width = Math.max(0.3, ((endMs - startMs) / totalMs) * 100);
          return (
            <div
              key={i}
              title={`${dayjs(s.start).format('HH:mm:ss')} – ${s.ongoing ? 'กำลังใช้งาน' : dayjs(s.end).format('HH:mm:ss')} (${formatDuration(s.durationSec)})`}
              style={{
                position: 'absolute',
                top: 3, bottom: 3,
                left: `${left}%`, width: `${width}%`,
                background: s.ongoing ? '#52c41a' : '#1677ff',
                borderRadius: 3,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

function renderDestination(r) {
  const domain = r.domain;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {r.faviconDomain && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${r.faviconDomain}&sz=32`}
          alt="" width={20} height={20}
          style={{ borderRadius: 4, flexShrink: 0 }}
          onError={e => { e.target.style.visibility = 'hidden'; }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.friendlyName
            ? <Text strong style={{ fontSize: 13 }}>{r.friendlyName}</Text>
            : domain
              ? <Text style={{ fontSize: 13 }}>{domain}</Text>
              : <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.dstIp}</Text>}
        </div>
        <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {domain && r.friendlyName ? `${domain} · ` : ''}{r.dstIp}
        </Text>
      </div>
    </div>
  );
}

function portToService(port, protocol) {
  const map = { 80: 'HTTP', 443: 'HTTPS', 53: 'DNS', 22: 'SSH', 25: 'SMTP', 110: 'POP3', 143: 'IMAP', 465: 'SMTPS', 587: 'SMTP', 993: 'IMAPS', 995: 'POP3S', 3306: 'MySQL', 5432: 'Postgres', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt' };
  if (map[port]) return map[port];
  if (port === 443 && protocol === 'udp') return 'QUIC';
  return `:${port}`;
}

function ConnectionPie({ connections }) {
  const pieData = useMemo(() => buildPieData(connections), [connections]);
  if (!pieData.length) return null;
  const totalBytes = pieData.reduce((s, d) => s + d.value, 0);

  return (
    <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
      <Row gutter={16} align="middle">
        <Col xs={24} md={11}>
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={42} dataKey="value" paddingAngle={2} labelLine={false}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="#fff" strokeWidth={2} />)}
                </Pie>
                <ReTooltip content={<ConnectionPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtBytes(totalBytes)}</div>
              <div style={{ fontSize: 10, color: '#888' }}>Total Traffic</div>
            </div>
          </div>
        </Col>
        <Col xs={24} md={13}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pieData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                {d.faviconDomain
                  ? <img src={`https://www.google.com/s2/favicons?domain=${d.faviconDomain}&sz=32`} alt="" width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} onError={e => { e.target.style.visibility = 'hidden'; }} />
                  : <div style={{ width: 16, height: 16, borderRadius: 3, background: d.color, flexShrink: 0 }} />}
                <Text style={{ flex: 1, fontSize: 12 }} ellipsis>{d.name}</Text>
                <div style={{ width: 80, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', height: 6 }}>
                  <div style={{ width: `${Math.min(d.pct, 100)}%`, background: d.color, height: '100%', borderRadius: 3 }} />
                </div>
                <Tag style={{ minWidth: 44, textAlign: 'center', borderColor: d.color, color: d.color, background: `${d.color}15`, marginRight: 0, fontSize: 11 }}>{d.pct}%</Tag>
              </div>
            ))}
          </div>
        </Col>
      </Row>
    </Card>
  );
}

export default function Devices() {
  const [data, setData] = useState({ total: 0, active: 0, breakdown: [], devices: [] });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState(null);
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState('');
  const [connModal, setConnModal] = useState(null); // { device, connections, history, loading, histLoading, histHours, tab }

  async function load() {
    setLoading(true);
    try {
      const [bk, hist] = await Promise.all([
        api.get('/devices/breakdown'),
        api.get(`/devices/history?hours=${hours}&limit=300`),
      ]);
      setData(bk.data);
      setHistory(hist.data);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, [hours]);

  async function openConnections(device) {
    const today = dayjs();
    setConnModal({
      device,
      connections: [], history: [], sessions: [], usage: [],
      loading: true, histLoading: false, sessLoading: false, usageLoading: false,
      histHours: 24,
      range: [today.subtract(6, 'day'), today],
      tab: 'active',
    });
    try {
      const r = await api.get(`/devices/connections?ip=${encodeURIComponent(device.ip)}`);
      setConnModal(prev => prev && { ...prev, connections: r.data, loading: false });
    } catch {
      setConnModal(prev => prev && { ...prev, loading: false });
    }
  }

  async function loadHistory(device, hours) {
    setConnModal(prev => prev && { ...prev, histLoading: true, histHours: hours });
    try {
      const params = new URLSearchParams();
      if (device.ip) params.set('ip', device.ip);
      else if (device.mac) params.set('mac', device.mac);
      params.set('hours', hours);
      const r = await api.get(`/devices/connections-history?${params}`);
      setConnModal(prev => prev && { ...prev, history: r.data, histLoading: false });
    } catch {
      setConnModal(prev => prev && { ...prev, histLoading: false });
    }
  }

  async function loadSessions(device, range) {
    setConnModal(prev => prev && { ...prev, sessLoading: true, range });
    try {
      const params = new URLSearchParams({
        mac: device.mac,
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
      });
      const r = await api.get(`/devices/sessions?${params}`);
      setConnModal(prev => prev && { ...prev, sessions: r.data, sessLoading: false });
    } catch {
      setConnModal(prev => prev && { ...prev, sessLoading: false });
    }
  }

  async function loadUsage(device, range) {
    setConnModal(prev => prev && { ...prev, usageLoading: true, range });
    try {
      const params = new URLSearchParams({
        mac: device.mac,
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
      });
      const r = await api.get(`/devices/usage?${params}`);
      setConnModal(prev => prev && { ...prev, usage: r.data, usageLoading: false });
    } catch {
      setConnModal(prev => prev && { ...prev, usageLoading: false });
    }
  }

  function onTabChange(key) {
    setConnModal(prev => {
      if (!prev) return prev;
      const next = { ...prev, tab: key };
      if (key === 'history' && prev.history.length === 0 && !prev.histLoading) {
        loadHistory(prev.device, prev.histHours || 24);
      }
      if (key === 'sessions' && prev.sessions.length === 0 && !prev.sessLoading) {
        loadSessions(prev.device, prev.range);
      }
      if (key === 'usage' && prev.usage.length === 0 && !prev.usageLoading) {
        loadUsage(prev.device, prev.range);
      }
      return next;
    });
  }

  const filteredDevices = data.devices
    .filter(d => !filterType || d.type === filterType)
    .filter(d => !search || (d.hostname + d.ip + d.mac + d.vendor).toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Connected Devices</Title>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            <Statistic title="Total Devices" value={data.total} suffix={`(${data.active} active)`} />
          </Card>
        </Col>
        {data.breakdown.slice(0, 3).map(b => {
          const m = TYPE_META[b.type] || TYPE_META.unknown;
          return (
            <Col xs={24} sm={12} md={6} key={b.type}>
              <Card size="small" onClick={() => setFilterType(filterType === b.type ? null : b.type)} style={{ cursor: 'pointer', borderColor: filterType === b.type ? m.color : undefined }}>
                <Statistic title={<span>{m.icon} {m.label}</span>} value={b.count} suffix={`(${b.pct}%)`} valueStyle={{ color: m.color }} />
              </Card>
            </Col>
          );
        })}

        <Col xs={24} md={14}>
          <Card
            title="Active Devices"
            extra={
              <div style={{ display: 'flex', gap: 8 }}>
                <Select size="small" placeholder="Type" allowClear value={filterType} onChange={setFilterType} style={{ width: 130 }}
                  options={Object.entries(TYPE_META).map(([k, m]) => ({ value: k, label: m.label }))} />
                <Input.Search size="small" placeholder="Search hostname/IP/MAC..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} allowClear />
              </div>
            }
          >
            <Table
              dataSource={filteredDevices}
              rowKey="mac"
              size="small"
              loading={loading}
              pagination={{ pageSize: 15, size: 'small' }}
              columns={[
                { title: 'Type', dataIndex: 'type', width: 110, render: t => <TypeTag type={t} /> },
                { title: 'Hostname', dataIndex: 'hostname', ellipsis: true, render: v => v || <Text type="secondary">—</Text> },
                { title: 'IP', dataIndex: 'ip', width: 130 },
                { title: 'MAC', dataIndex: 'mac', width: 150, render: v => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> },
                { title: 'Vendor', dataIndex: 'vendor', width: 110, render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                { title: 'Status', dataIndex: 'active', width: 80, render: v => v ? <Tag color="success">Online</Tag> : <Tag>Offline</Tag> },
                {
                  title: 'รายละเอียด', width: 80, fixed: 'right',
                  render: (_, r) => (
                    <Button type="link" size="small" icon={<LinkOutlined />} disabled={!r.active} onClick={() => openConnections(r)}>
                      ดู
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} md={10}>
          <Card
            title={<><HistoryOutlined /> Device History</>}
            extra={
              <Select size="small" value={hours} onChange={setHours} options={[
                { value: 1,  label: '1 ชั่วโมง' },
                { value: 6,  label: '6 ชั่วโมง' },
                { value: 24, label: '24 ชั่วโมง' },
                { value: 72, label: '3 วัน' },
                { value: 168, label: '7 วัน' },
              ]} style={{ width: 110 }} />
            }
          >
            <Table
              dataSource={history}
              rowKey="id"
              size="small"
              loading={loading}
              pagination={{ pageSize: 15, size: 'small' }}
              columns={[
                { title: 'When', dataIndex: 'seen_at', width: 130, render: t => <Text style={{ fontSize: 12 }}>{dayjs(t).format('DD/MM HH:mm')}</Text> },
                {
                  title: 'Event', dataIndex: 'event', width: 100, render: e => {
                    const c = e === 'connect' ? 'success' : e === 'disconnect' ? 'error' : 'processing';
                    return <Tag color={c}>{e}</Tag>;
                  }
                },
                {
                  title: 'Device', render: (_, r) => (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TypeTag type={r.type} />
                        <Text style={{ fontSize: 12 }}>{r.hostname || '—'}</Text>
                      </div>
                      <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.mac} · {r.ip}</Text>
                    </div>
                  )
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Active Connections Modal */}
      <Modal
        open={!!connModal}
        onCancel={() => setConnModal(null)}
        title={
          connModal?.device && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TypeTag type={connModal.device.type} />
              <div>
                <div style={{ fontWeight: 600 }}>{connModal.device.hostname || connModal.device.ip}</div>
                <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {connModal.device.mac} · {connModal.device.ip} · {connModal.device.vendor}
                </Text>
              </div>
            </div>
          )
        }
        footer={
          connModal?.tab === 'history'
            ? <Button onClick={() => loadHistory(connModal.device, connModal.histHours)} icon={<ReloadOutlined />}>Refresh</Button>
            : connModal?.tab === 'sessions'
              ? <Button onClick={() => loadSessions(connModal.device, connModal.range)} icon={<ReloadOutlined />}>Refresh</Button>
              : connModal?.tab === 'usage'
                ? <Button onClick={() => loadUsage(connModal.device, connModal.range)} icon={<ReloadOutlined />}>Refresh</Button>
                : <Button onClick={() => openConnections(connModal.device)} icon={<ReloadOutlined />}>Refresh</Button>
        }
        width={950}
      >
        {!connModal ? null : (
          <Tabs
            activeKey={connModal.tab}
            onChange={onTabChange}
            items={[
              {
                key: 'active',
                label: 'Active ตอนนี้',
                children: connModal.loading
                  ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  : (connModal.connections || []).length === 0
                    ? <Empty description="ไม่มี connection ที่ active อยู่ในขณะนี้" />
                    : (
                      <div>
                        <ConnectionPie connections={connModal.connections} />
                        <Text type="secondary" style={{ display: 'block', marginBottom: 10, marginTop: 16, fontSize: 12 }}>
                          {connModal.connections.length} ปลายทาง · เรียงจากใหม่ไปเก่า
                        </Text>
                        <Table
                          dataSource={connModal.connections}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={{ pageSize: 15, size: 'small', showSizeChanger: false }}
                          columns={[
                            { title: 'ปลายทาง', dataIndex: 'domain', ellipsis: true, render: (_, r) => renderDestination(r) },
                            { title: 'Service', width: 110, render: (_, r) => <Tag>{portToService(r.dstPort, r.protocol)}</Tag> },
                            { title: 'Proto', dataIndex: 'protocol', width: 70, render: p => <Tag color={p === 'tcp' ? 'blue' : p === 'udp' ? 'orange' : undefined}>{p}</Tag> },
                            { title: 'State', dataIndex: 'tcpState', width: 110, render: s => s ? <Text style={{ fontSize: 11 }}>{s}</Text> : <Text type="secondary">—</Text> },
                            { title: 'Traffic', dataIndex: 'totalBytes', width: 100, render: b => <Text style={{ fontSize: 12, fontWeight: 500 }}>{fmtBytes(b)}</Text>, sorter: (a, b) => a.totalBytes - b.totalBytes },
                            { title: 'Conn', dataIndex: 'connections', width: 60, render: n => <Tag color="default">{n}</Tag> },
                            {
                              title: 'เริ่มเมื่อ', dataIndex: 'firstSeen', width: 140, key: 'firstSeen',
                              render: t => t ? (
                                <div style={{ lineHeight: 1.2 }}>
                                  <div style={{ fontSize: 12 }}>{dayjs(t).format('HH:mm:ss')}</div>
                                  <Text type="secondary" style={{ fontSize: 10 }}>{dayjs(t).fromNow()}</Text>
                                </div>
                              ) : <Text type="secondary">—</Text>,
                              sorter: (a, b) => (a.firstSeen || 0) - (b.firstSeen || 0),
                              defaultSortOrder: 'descend',
                            },
                          ]}
                        />
                      </div>
                    ),
              },
              {
                key: 'sessions',
                label: <><ClockCircleOutlined /> Uptime</>,
                children: (() => {
                  const sessions = connModal.sessions;
                  // Group sessions by day for the table
                  const byDay = new Map();
                  for (const s of sessions) {
                    if (!byDay.has(s.day)) byDay.set(s.day, []);
                    byDay.get(s.day).push(s);
                  }
                  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <DatePicker.RangePicker
                          size="small"
                          value={connModal.range}
                          allowClear={false}
                          format="DD/MM/YYYY"
                          disabledDate={(d) => d && d.isAfter(dayjs().endOf('day'))}
                          onChange={(r) => r && loadSessions(connModal.device, r)}
                        />
                      </div>
                      <Spin spinning={connModal.sessLoading}>
                        {days.length === 0
                          ? <Empty description="ไม่มี session ในช่วงนี้" />
                          : days.map(([day, list]) => {
                              const totalSec = list.reduce((s, x) => s + x.durationSec, 0);
                              return (
                                <Card key={day} size="small" style={{ marginBottom: 10 }}
                                  title={
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <Text strong>{dayjs(day).format('ddd D MMM YYYY')}</Text>
                                      <Text type="secondary" style={{ fontWeight: 400 }}>
                                        {list.length} session · รวม {formatDuration(totalSec)}
                                      </Text>
                                    </div>
                                  }
                                >
                                  <SessionTimeline day={day} sessions={list} />
                                  <Table
                                    dataSource={list}
                                    rowKey={(_, i) => `${day}-${i}`}
                                    size="small"
                                    pagination={false}
                                    style={{ marginTop: 8 }}
                                    columns={[
                                      { title: 'เริ่ม', dataIndex: 'start', width: 110, render: t => dayjs(t).format('HH:mm:ss') },
                                      { title: 'สิ้นสุด', dataIndex: 'end', width: 130, render: (t, r) => r.ongoing ? <Tag color="success">กำลังใช้งาน</Tag> : dayjs(t).format('HH:mm:ss') },
                                      { title: 'ระยะเวลา', dataIndex: 'durationSec', render: s => formatDuration(s) },
                                    ]}
                                  />
                                </Card>
                              );
                            })
                        }
                      </Spin>
                    </div>
                  );
                })(),
              },
              {
                key: 'usage',
                label: <><BarChartOutlined /> Upload/Download</>,
                children: (() => {
                  const data = connModal.usage.map(d => ({
                    day: dayjs(d.day).format('DD/MM'),
                    Download: +(d.rx_bytes / 1024 / 1024).toFixed(2),
                    Upload:   +(d.tx_bytes / 1024 / 1024).toFixed(2),
                  }));
                  const totals = connModal.usage.reduce(
                    (acc, d) => ({ rx: acc.rx + d.rx_bytes, tx: acc.tx + d.tx_bytes }),
                    { rx: 0, tx: 0 }
                  );
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <DatePicker.RangePicker
                          size="small"
                          value={connModal.range}
                          allowClear={false}
                          format="DD/MM/YYYY"
                          disabledDate={(d) => d && d.isAfter(dayjs().endOf('day'))}
                          onChange={(r) => r && loadUsage(connModal.device, r)}
                        />
                      </div>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={8}><Statistic title="รวม Download" value={fmtBytes(totals.rx)} valueStyle={{ color: '#1677ff', fontSize: 18 }} /></Col>
                        <Col span={8}><Statistic title="รวม Upload"   value={fmtBytes(totals.tx)} valueStyle={{ color: '#52c41a', fontSize: 18 }} /></Col>
                        <Col span={8}><Statistic title="รวมทั้งหมด"     value={fmtBytes(totals.rx + totals.tx)} valueStyle={{ fontSize: 18 }} /></Col>
                      </Row>
                      <Spin spinning={connModal.usageLoading}>
                        {data.length === 0
                          ? <Empty description="ยังไม่มีข้อมูลในช่วงนี้" />
                          : (
                            <ResponsiveContainer width="100%" height={280}>
                              <LineChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="day" style={{ fontSize: 11 }} />
                                <YAxis unit=" MB" width={70} style={{ fontSize: 11 }} />
                                <ReTooltip formatter={(v) => `${v} MB`} />
                                <Legend />
                                <Line type="monotone" dataKey="Download" stroke="#1677ff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                <Line type="monotone" dataKey="Upload"   stroke="#52c41a" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          )
                        }
                      </Spin>
                    </div>
                  );
                })(),
              },
              {
                key: 'history',
                label: <><HistoryOutlined /> ประวัติ</>,
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                      <Select
                        size="small"
                        value={connModal.histHours}
                        onChange={(h) => loadHistory(connModal.device, h)}
                        style={{ width: 140 }}
                        options={[
                          { value: 1,   label: '1 ชั่วโมง' },
                          { value: 6,   label: '6 ชั่วโมง' },
                          { value: 24,  label: '24 ชั่วโมง' },
                          { value: 72,  label: '3 วัน' },
                          { value: 168, label: '7 วัน' },
                          { value: 336, label: '14 วัน' },
                        ]}
                      />
                    </div>
                    <Spin spinning={connModal.histLoading}>
                      {connModal.history.length === 0
                        ? <Empty description="ยังไม่มีข้อมูลในช่วงเวลานี้" />
                        : (
                          <>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
                              {connModal.history.length} session · เก็บย้อนหลังได้สูงสุด 14 วัน
                            </Text>
                            <Table
                              dataSource={connModal.history}
                              rowKey="sessionKey"
                              size="small"
                              pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                              columns={[
                                { title: 'ปลายทาง', dataIndex: 'domain', ellipsis: true, render: (_, r) => renderDestination(r) },
                                { title: 'Service', width: 100, render: (_, r) => <Tag>{portToService(r.dstPort, r.protocol)}</Tag> },
                                { title: 'Proto', dataIndex: 'protocol', width: 70, render: p => <Tag color={p === 'tcp' ? 'blue' : p === 'udp' ? 'orange' : undefined}>{p}</Tag> },
                                { title: 'Status', dataIndex: 'active', width: 80, render: a => a ? <Tag color="success">active</Tag> : <Tag>closed</Tag> },
                                { title: 'Traffic', dataIndex: 'totalBytes', width: 100, render: b => <Text style={{ fontSize: 12, fontWeight: 500 }}>{fmtBytes(b)}</Text>, sorter: (a, b) => a.totalBytes - b.totalBytes },
                                {
                                  title: 'เริ่มเมื่อ', dataIndex: 'firstSeen', width: 150,
                                  render: t => t ? (
                                    <div style={{ lineHeight: 1.2 }}>
                                      <div style={{ fontSize: 12 }}>{dayjs(t).format('DD/MM HH:mm:ss')}</div>
                                      <Text type="secondary" style={{ fontSize: 10 }}>{dayjs(t).fromNow()}</Text>
                                    </div>
                                  ) : <Text type="secondary">—</Text>,
                                  sorter: (a, b) => new Date(a.firstSeen) - new Date(b.firstSeen),
                                  defaultSortOrder: 'descend',
                                },
                                {
                                  title: 'ล่าสุด', dataIndex: 'lastSeen', width: 130,
                                  render: t => t ? <Text style={{ fontSize: 11 }}>{dayjs(t).fromNow()}</Text> : <Text type="secondary">—</Text>,
                                },
                              ]}
                            />
                          </>
                        )
                      }
                    </Spin>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
