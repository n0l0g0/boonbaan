import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, Row, Col, Progress, Tag, Typography, Statistic, Segmented, Spin, Empty, DatePicker, Space, Table } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSocket } from '../hooks/useSocket';
import { RealtimeBandwidthChart, HistoricalBandwidthChart } from '../components/Charts/BandwidthChart';
import api from '../services/api';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const MAX_POINTS = 30; // 5 นาที @ 10s interval

const PRESETS = [
  { label: 'วันนี้', value: 'today' },
  { label: 'เมื่อวาน', value: 'yesterday' },
  { label: '7 วัน', value: '7d' },
  { label: '30 วัน', value: '30d' },
  { label: 'กำหนดเอง', value: 'custom' },
];

function presetRange(key) {
  const now = dayjs();
  switch (key) {
    case 'today': return [now.startOf('day'), now.endOf('day')];
    case 'yesterday': {
      const y = now.subtract(1, 'day');
      return [y.startOf('day'), y.endOf('day')];
    }
    case '7d': return [now.subtract(6, 'day').startOf('day'), now.endOf('day')];
    case '30d': return [now.subtract(29, 'day').startOf('day'), now.endOf('day')];
    default: return [now.startOf('day'), now.endOf('day')];
  }
}

function usageLabel(bps) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${bps} bps`;
}

function bytesLabel(b) {
  const n = Number(b) || 0;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  if (n >= 1024)      return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

const DEVICE_TYPE_COLOR = {
  mobile: 'blue', computer: 'green', iot: 'gold', network: 'purple', unknown: 'default',
};

export default function Monitor() {
  const [stats, setStats] = useState(null);
  const [realtimeData, setRealtimeData] = useState([]);

  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [histData, setHistData] = useState([]);
  const [bucket, setBucket] = useState('minute');
  const [histLoading, setHistLoading] = useState(false);
  const [topDevices, setTopDevices] = useState([]);
  const [topLoading, setTopLoading] = useState(false);
  const [hotspotMacUser, setHotspotMacUser] = useState({});

  // Real-time via socket
  const handleUpdate = useCallback((data) => {
    setStats(data);
    if (data.bandwidth) {
      setRealtimeData(prev => [
        ...prev.slice(-MAX_POINTS + 1),
        { ...data.bandwidth, t: Date.now() },
      ]);
    }
  }, []);
  useSocket('monitor:update', handleUpdate);

  // Historical from DB
  const loadHistory = useCallback(async ([from, to]) => {
    if (!from || !to) return;
    setHistLoading(true);
    try {
      const r = await api.get('/history/bandwidth', {
        params: { from: from.toISOString(), to: to.toISOString() },
      });
      // backend now returns { bucket, from, to, data }
      if (Array.isArray(r.data)) {
        setHistData(r.data);
        setBucket('minute');
      } else {
        setHistData(r.data.data || []);
        setBucket(r.data.bucket || 'minute');
      }
    } catch { setHistData([]); }
    setHistLoading(false);
  }, []);

  const loadTopDevices = useCallback(async ([from, to]) => {
    if (!from || !to) return;
    setTopLoading(true);
    try {
      const r = await api.get('/history/top-devices', {
        params: {
          from: from.format('YYYY-MM-DD'),
          to: to.format('YYYY-MM-DD'),
          limit: 10,
        },
      });
      setTopDevices(r.data.devices || []);
    } catch { setTopDevices([]); }
    setTopLoading(false);
  }, []);

  const loadHotspotMacUser = useCallback(async () => {
    try {
      const [act, mac] = await Promise.allSettled([api.get('/hotspot/active'), api.get('/mac')]);
      const map = {};
      // Fill from hotspot/host first (includes recent/idle hosts)
      const bindings = mac.value?.data?.bindings || [];
      for (const h of bindings) {
        const m = String(h['mac-address'] || '').toLowerCase();
        if (m && h.user) map[m] = h.user;
      }
      // Active sessions override (most current)
      for (const a of (act.value?.data || [])) {
        const m = String(a['mac-address'] || '').toLowerCase();
        if (m && a.user) map[m] = a.user;
      }
      setHotspotMacUser(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadHistory(range); loadTopDevices(range); }, [range, loadHistory, loadTopDevices]);
  useEffect(() => {
    loadHotspotMacUser();
    const id = setInterval(loadHotspotMacUser, 30_000);
    return () => clearInterval(id);
  }, [loadHotspotMacUser]);

  function handlePreset(key) {
    setPreset(key);
    if (key !== 'custom') setRange(presetRange(key));
  }

  function handleRangeChange(r) {
    if (!r || !r[0] || !r[1]) return;
    setPreset('custom');
    setRange([r[0].startOf('minute'), r[1].endOf('minute')]);
  }

  // Derived stats
  const res = stats?.resources;
  const bw = stats?.bandwidth;
  const isp = stats?.isp;
  const aps = stats?.aps || [];

  const peakRx = histData.length ? Math.max(...histData.map(d => Number(d.rx_bps_max ?? d.rx_bps))) : 0;
  const peakTx = histData.length ? Math.max(...histData.map(d => Number(d.tx_bps_max ?? d.tx_bps))) : 0;
  const avgRx = histData.length ? histData.reduce((s, d) => s + Number(d.rx_bps), 0) / histData.length : 0;
  const avgTx = histData.length ? histData.reduce((s, d) => s + Number(d.tx_bps), 0) / histData.length : 0;

  const rangeLabel = useMemo(() => {
    const [a, b] = range;
    const sameDay = a.isSame(b, 'day');
    if (sameDay) return a.format('D MMM YYYY');
    return `${a.format('D MMM YYYY')} — ${b.format('D MMM YYYY')}`;
  }, [range]);

  return (
    <div>
      <Title level={4}>Monitor</Title>
      {stats?.timestamp && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
          อัปเดตล่าสุด: {new Date(stats.timestamp).toLocaleTimeString('th-TH')}
        </Text>
      )}

      {/* System Resources */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card title="CPU" size="small">
            {res
              ? <Progress percent={res.cpu} status={res.cpu >= 90 ? 'exception' : res.cpu >= 80 ? 'active' : 'normal'} strokeLinecap="butt" />
              : <Spin size="small" />}
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="Memory" size="small">
            {res
              ? <Progress percent={res.memPct} status={res.memPct >= 90 ? 'exception' : res.memPct >= 80 ? 'active' : 'normal'} strokeLinecap="butt" />
              : <Spin size="small" />}
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="Disk" size="small">
            {res
              ? <Progress percent={res.diskPct} status={res.diskPct >= 90 ? 'exception' : res.diskPct >= 80 ? 'active' : 'normal'} strokeLinecap="butt" />
              : <Spin size="small" />}
          </Card>
        </Col>

        {/* ISP + Current BW */}
        <Col xs={24} sm={8}>
          <Card title="ISP / 3BB" size="small">
            {isp
              ? <Tag color={isp.online ? 'green' : 'red'} style={{ fontSize: 15, padding: '4px 16px' }}>
                  {isp.online ? 'Online' : 'Offline'}
                </Tag>
              : <Spin size="small" />}
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="Download (RX)" size="small">
            <Statistic
              value={bw ? usageLabel(bw.rxBps) : '-'}
              prefix={<ArrowDownOutlined style={{ color: '#1677ff' }} />}
              suffix={bw ? <Tag color={bw.rxPct >= 90 ? 'red' : bw.rxPct >= 80 ? 'orange' : 'blue'}>{bw.rxPct}%</Tag> : null}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="Upload (TX)" size="small">
            <Statistic
              value={bw ? usageLabel(bw.txBps) : '-'}
              prefix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
              suffix={bw ? <Tag color={bw.txPct >= 90 ? 'red' : bw.txPct >= 80 ? 'orange' : 'green'}>{bw.txPct}%</Tag> : null}
            />
          </Card>
        </Col>

        {/* Realtime chart */}
        <Col xs={24}>
          <Card
            title="Internet Usage — Real-time"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>อัปเดตทุก 10 วินาที</Text>}
          >
            {realtimeData.length > 0
              ? <RealtimeBandwidthChart data={realtimeData} />
              : <Empty description="รอข้อมูล..." image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>

        {/* Historical chart */}
        <Col xs={24}>
          <Card
            title={`Internet Usage — ${rangeLabel}`}
            extra={
              <Space wrap>
                <Segmented
                  options={PRESETS}
                  value={preset}
                  onChange={handlePreset}
                  size="small"
                />
                <RangePicker
                  size="small"
                  value={range}
                  onChange={handleRangeChange}
                  allowClear={false}
                  format="DD/MM/YYYY"
                  disabledDate={(d) => d && d.isAfter(dayjs().endOf('day'))}
                />
              </Space>
            }
          >
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={6}>
                <Statistic title="Peak Download" value={usageLabel(peakRx)} valueStyle={{ color: '#1677ff', fontSize: 16 }} prefix={<ArrowDownOutlined />} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="Peak Upload" value={usageLabel(peakTx)} valueStyle={{ color: '#52c41a', fontSize: 16 }} prefix={<ArrowUpOutlined />} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="Avg Download" value={usageLabel(avgRx)} valueStyle={{ fontSize: 16 }} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="Avg Upload" value={usageLabel(avgTx)} valueStyle={{ fontSize: 16 }} />
              </Col>
            </Row>
            <Spin spinning={histLoading}>
              {histData.length > 0
                ? <HistoricalBandwidthChart data={histData} bucket={bucket} />
                : <Empty description="ยังไม่มีข้อมูลในช่วงเวลานี้" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Spin>
          </Card>
        </Col>

        {/* Top 10 devices by usage */}
        <Col xs={24}>
          <Card
            title={`Top 10 Devices — ${rangeLabel}`}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>เรียงตาม total bytes ในช่วงที่เลือก</Text>}
          >
            <Spin spinning={topLoading}>
              {topDevices.length === 0
                ? <Empty description="ยังไม่มีข้อมูล" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : (() => {
                    const maxTotal = Math.max(...topDevices.map(d => Number(d.total_bytes) || 0), 1);
                    return (
                      <Table
                        size="small"
                        rowKey="mac"
                        pagination={false}
                        dataSource={topDevices}
                        columns={[
                          { title: '#', width: 50, render: (_, __, i) => <Tag>{i + 1}</Tag> },
                          {
                            title: 'Device',
                            render: (_, d) => (
                              <Space direction="vertical" size={0}>
                                <Text strong>{d.hostname || d.mac}</Text>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {d.ip || '-'} · {d.mac} {d.vendor ? `· ${d.vendor}` : ''}
                                </Text>
                              </Space>
                            ),
                          },
                          {
                            title: 'Hotspot User', width: 140,
                            render: (_, d) => {
                              const u = hotspotMacUser[String(d.mac || '').toLowerCase()];
                              return u
                                ? <Tag color="blue">{u}</Tag>
                                : <Text type="secondary" style={{ fontSize: 11 }}>-</Text>;
                            },
                          },
                          {
                            title: 'Type', width: 100,
                            render: (_, d) => <Tag color={DEVICE_TYPE_COLOR[d.type] || 'default'}>{d.type || 'unknown'}</Tag>,
                          },
                          { title: 'Download', width: 120, align: 'right', render: (_, d) => bytesLabel(d.rx_bytes) },
                          { title: 'Upload',   width: 120, align: 'right', render: (_, d) => bytesLabel(d.tx_bytes) },
                          {
                            title: 'Total', width: 220,
                            render: (_, d) => {
                              const pct = Math.round((Number(d.total_bytes) / maxTotal) * 100);
                              return (
                                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                  <Text strong>{bytesLabel(d.total_bytes)}</Text>
                                  <Progress percent={pct} showInfo={false} size="small" strokeColor="#1677ff" />
                                </Space>
                              );
                            },
                          },
                        ]}
                      />
                    );
                  })()
              }
            </Spin>
          </Card>
        </Col>

        {/* Access Points */}
        <Col xs={24}>
          <Card title={`Access Points (${aps.length})`} size="small">
            {aps.length === 0
              ? <Text type="secondary">ไม่มีข้อมูล AP</Text>
              : <Row gutter={[8, 8]}>
                  {aps.map((ap, i) => (
                    <Col key={i}><Tag color="blue">{ap['mac-address'] || ap.name}</Tag></Col>
                  ))}
                </Row>}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
