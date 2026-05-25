import { useEffect, useState, useCallback, useRef } from 'react';
import { Table, Select, Button, Space, Input, Tag, DatePicker, Row, Col, Card, Statistic, Tooltip, Badge } from 'antd';
import { ReloadOutlined, SearchOutlined, UserOutlined, SyncOutlined, WifiOutlined } from '@ant-design/icons';
import api from '../services/api';
import { useSocket } from '../hooks/useSocket';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const TOPIC_OPTIONS = [
  { value: '', label: 'ทุก Topic' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'system', label: 'System' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'dhcp', label: 'DHCP' },
  { value: 'ppp', label: 'VPN/PPP' },
  { value: 'web-proxy', label: 'Web Proxy' },
  { value: 'dns', label: 'DNS' },
  { value: 'wireless', label: 'Wireless' },
];

const LEVEL_OPTIONS = [
  { value: '', label: 'ทุก Level' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

const LEVEL_COLORS = { error: 'red', warning: 'orange', info: 'blue', debug: 'default' };

const TZ_OPT = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
function fmtDate(v) { return v ? new Date(v).toLocaleString('th-TH', TZ_OPT) : '-'; }

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [users, setUsers] = useState([]);

  const [newCount, setNewCount] = useState(0);

  const [filters, setFilters] = useState({
    search: '',
    topics: '',
    level: '',
    username: '',
    src_ip: '',
    from: null,
    to: null,
    page: 1,
    limit: 100,
  });
  const filtersRef = useRef(filters);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    setNewCount(0);
    try {
      const params = { ...f };
      if (params.from) params.from = params.from.toISOString();
      if (params.to) params.to = params.to.toISOString();
      const r = await api.get('/logs', { params });
      setLogs(r.data.data);
      setTotal(r.data.total);
    } catch { }
    setLoading(false);
  }, [filters]);

  async function loadUsers() {
    try { setUsers((await api.get('/logs/users')).data); } catch { }
  }

  useEffect(() => { load(); loadUsers(); }, []);

  // Keep ref in sync so socket handler always sees latest filters
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // Real-time: prepend new logs when on page 1 with no active filters
  const handleNewLog = useCallback((log) => {
    const f = filtersRef.current;
    const hasFilter = f.search || f.topics || f.level || f.username || f.src_ip || f.from || f.to;
    if (f.page === 1 && !hasFilter) {
      setLogs(prev => [log, ...prev.slice(0, f.limit - 1)]);
      setTotal(prev => prev + 1);
    } else {
      setNewCount(prev => prev + 1);
    }
  }, []);

  useSocket('log:new', handleNewLog);

  function setFilter(key, value) {
    const next = { ...filters, [key]: value, page: 1 };
    setFilters(next);
    load(next);
  }

  function setDateRange(dates) {
    const next = {
      ...filters,
      from: dates?.[0]?.toDate() || null,
      to: dates?.[1]?.toDate() || null,
      page: 1,
    };
    setFilters(next);
    load(next);
  }

  function setPage(page) {
    const next = { ...filters, page };
    setFilters(next);
    load(next);
  }

  async function collectNow() {
    setCollecting(true);
    try { await api.post('/logs/collect'); await load(); await loadUsers(); }
    catch { }
    setCollecting(false);
  }

  const cols = [
    {
      title: 'เวลา (+7)', dataIndex: 'collected_at', width: 170,
      render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{fmtDate(v)}</span>,
    },
    {
      title: 'Level', dataIndex: 'level', width: 80,
      render: v => <Tag color={LEVEL_COLORS[v] || 'default'}>{v || '-'}</Tag>,
    },
    {
      title: 'Topics', dataIndex: 'topics', width: 160,
      render: v => v ? v.split(',').map(t => <Tag key={t} style={{ marginBottom: 2 }}>{t.trim()}</Tag>) : '-',
    },
    {
      title: 'User / IP', width: 140,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          {r.username && <span><UserOutlined style={{ marginRight: 4 }} /><b>{r.username}</b></span>}
          {r.src_ip && <span style={{ fontSize: 12, color: '#888' }}>{r.src_ip}</span>}
          {!r.username && !r.src_ip && <span style={{ color: '#ccc' }}>-</span>}
        </Space>
      ),
    },
    {
      title: 'Message', dataIndex: 'message', ellipsis: { showTitle: false },
      render: v => <Tooltip title={v}><span>{v}</span></Tooltip>,
    },
  ];

  const userCols = [
    { title: 'Username', dataIndex: 'username', render: v => <b>{v}</b> },
    { title: 'IP ล่าสุด', dataIndex: 'src_ip', render: v => v || '-' },
    { title: 'จำนวน event', dataIndex: 'count' },
    { title: 'ครั้งแรก', dataIndex: 'first_seen', render: v => fmtDate(v) },
    { title: 'ครั้งล่าสุด', dataIndex: 'last_seen', render: v => fmtDate(v) },
  ];

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small"><Statistic title="Log ทั้งหมด (180 วัน)" value={total} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small"><Statistic title="Users ที่พบ" value={users.length} /></Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            ประวัติ Logs 90 วัน
            <Badge dot status="processing" title="Real-time" />
          </Space>
        }
        size="small"
        extra={
          <Space>
            {newCount > 0 && (
              <Button size="small" type="primary" onClick={() => load()}>
                มี {newCount} log ใหม่ — คลิกเพื่อโหลด
              </Button>
            )}
            <Button icon={<SyncOutlined />} size="small" loading={collecting} onClick={collectNow}>
              ดึง Log ล่าสุดจาก MikroTik
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="ค้นหาใน message..."
            style={{ width: 200 }}
            allowClear
            onPressEnter={e => setFilter('search', e.target.value)}
            onClear={() => setFilter('search', '')}
            onChange={e => !e.target.value && setFilter('search', '')}
          />
          <Input
            placeholder="Username"
            style={{ width: 130 }}
            allowClear
            value={filters.username}
            onChange={e => setFilter('username', e.target.value)}
          />
          <Input
            placeholder="IP Address"
            style={{ width: 140 }}
            allowClear
            value={filters.src_ip}
            onChange={e => setFilter('src_ip', e.target.value)}
          />
          <Select
            options={TOPIC_OPTIONS}
            value={filters.topics}
            onChange={v => setFilter('topics', v)}
            style={{ width: 140 }}
          />
          <Select
            options={LEVEL_OPTIONS}
            value={filters.level}
            onChange={v => setFilter('level', v)}
            style={{ width: 120 }}
          />
          <RangePicker
            showTime
            format="DD/MM/YYYY HH:mm"
            onChange={setDateRange}
            placeholder={['จากวันที่', 'ถึงวันที่']}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>Refresh</Button>
        </Space>

        <Table
          dataSource={logs}
          columns={cols}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 900 }}
          pagination={{
            total,
            current: filters.page,
            pageSize: filters.limit,
            showSizeChanger: true,
            pageSizeOptions: [50, 100, 200],
            showTotal: (t) => `ทั้งหมด ${t.toLocaleString()} รายการ`,
            onChange: (p, ps) => {
              const next = { ...filters, page: p, limit: ps };
              setFilters(next);
              load(next);
            },
          }}
        />
      </Card>

      <Card title={`User Activity Summary (${users.length} users)`} size="small">
        <Table
          dataSource={users}
          columns={userCols}
          rowKey={r => `${r.username}-${r.src_ip}`}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  );
}
