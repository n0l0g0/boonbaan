import { useEffect, useState, useCallback } from 'react';
import { Card, Col, Row, Statistic, Progress, Typography, Tag, Button, DatePicker, Modal, Table, Spin, Tooltip, Space, List, Badge, Empty } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined, HistoryOutlined, MobileOutlined, DesktopOutlined,
  CloudOutlined, QuestionCircleOutlined, ThunderboltOutlined, WarningOutlined, SafetyCertificateOutlined,
  WifiOutlined, LockOutlined, FireOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../services/api';
import { useSocket } from '../hooks/useSocket';
import { RealtimeBandwidthChart } from '../components/Charts/BandwidthChart';
import SiteUsageChart, { SiteLogo } from '../components/Charts/SiteUsageChart';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell } from 'recharts';

const { Title, Text } = Typography;
const MAX_BW_POINTS = 30;

function bytes(n) {
  if (n == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const SEVERITY_COLOR = { critical: '#eb2f96', high: '#f5222d', medium: '#fa8c16', low: '#faad14' };
const ACTION_LABEL = {
  admin_changed_password: 'Admin เปลี่ยนรหัส',
  reset_link_generated: 'สร้างลิงก์รีเซ็ต',
  reset_email_sent: 'ส่งอีเมลรีเซ็ต',
  user_reset_via_link: 'User รีเซ็ตผ่านลิงก์',
};
const CATEGORY_LABEL = {
  auth_failure: 'Auth Failure',
  vpn_auth_failure: 'VPN Auth Fail',
  hotspot_auth_failure: 'Hotspot Auth Fail',
  system_reboot: 'System Reboot',
  config_change: 'Config Change',
  blacklist_hit: 'Blacklist Hit',
  firewall_drop: 'Firewall Drop',
  dhcp_conflict: 'DHCP Conflict',
  critical_error: 'Critical Error',
  router_error: 'Router Error',
  router_warning: 'Router Warning',
};

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [monitorStats, setMonitorStats] = useState(null);
  const [bwHistory, setBwHistory] = useState([]);
  const [siteStats, setSiteStats] = useState([]);
  const [siteLoading, setSiteLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [devices, setDevices] = useState({ total: 0, active: 0, breakdown: [] });
  const [pulse, setPulse] = useState(null);
  const [sessions, setSessions] = useState({ hotspot: [], vpn: [] });
  const [talkers, setTalkers] = useState([]);

  async function loadSiteStats(date) {
    setSiteLoading(true);
    try {
      const url = date ? `/dashboard/site-stats/history?date=${date}` : '/dashboard/site-stats';
      const r = await api.get(url);
      setSiteStats(r.data.data || []);
    } catch { }
    setSiteLoading(false);
  }

  async function openDrilldown(category) {
    const date = selectedDate || dayjs().format('YYYY-MM-DD');
    setDrilldown({ category, date, domains: [], loading: true });
    try {
      const r = await api.get(`/dashboard/site-stats/drilldown?category=${encodeURIComponent(category)}&date=${date}`);
      setDrilldown(prev => ({ ...prev, domains: r.data.domains || [], loading: false }));
    } catch { setDrilldown(prev => ({ ...prev, loading: false })); }
  }

  function handleDateChange(d) {
    const date = d ? d.format('YYYY-MM-DD') : null;
    setSelectedDate(date);
    loadSiteStats(date);
  }

  async function loadAll() {
    try {
      const [s, d, p, sess, t] = await Promise.allSettled([
        api.get('/dashboard'),
        api.get('/devices/breakdown'),
        api.get('/dashboard/security-pulse?hours=24'),
        api.get('/dashboard/active-sessions'),
        api.get('/dashboard/top-talkers?limit=8'),
      ]);
      if (s.status === 'fulfilled') setSummary(s.value.data);
      if (d.status === 'fulfilled') setDevices(d.value.data);
      if (p.status === 'fulfilled') setPulse(p.value.data);
      if (sess.status === 'fulfilled') setSessions(sess.value.data);
      if (t.status === 'fulfilled') setTalkers(t.value.data.rows || []);
    } catch { }
  }

  useEffect(() => {
    loadAll();
    loadSiteStats(null);
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleMonitor = useCallback((data) => {
    setMonitorStats(data);
    if (data.bandwidth) setBwHistory(prev => [...prev.slice(-MAX_BW_POINTS + 1), { ...data.bandwidth, t: Date.now() }]);
  }, []);
  useSocket('monitor:update', handleMonitor);

  const res = monitorStats?.resources;
  const bw = monitorStats?.bandwidth;
  const isp = monitorStats?.isp;
  const ispOk = isp?.online === true || (isp?.wans?.length && isp.wans.every(w => w.online));
  const ispMixed = isp?.wans?.length > 1 && isp.wans.some(w => w.online) && !isp.wans.every(w => w.online);

  // --- Hero card ---
  const heroGradient = ispOk
    ? 'linear-gradient(135deg, #1677ff 0%, #36cfc9 100%)'
    : ispMixed
      ? 'linear-gradient(135deg, #fa8c16 0%, #faad14 100%)'
      : 'linear-gradient(135deg, #ff4d4f 0%, #ff7a45 100%)';

  return (
    <div>
      <Card
        bordered={false}
        style={{
          background: heroGradient,
          color: '#fff',
          marginBottom: 16,
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(22,119,255,0.18)',
        }}
        bodyStyle={{ padding: '20px 28px' }}
      >
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={12}>
            <Space direction="vertical" size={0}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>Router</Text>
              <Title level={2} style={{ color: '#fff', margin: 0 }}>{summary?.identity || 'MikroTik'}</Title>
              <Space wrap split={<span style={{ color: 'rgba(255,255,255,0.5)' }}>·</span>} style={{ marginTop: 6 }}>
                <Text style={{ color: 'rgba(255,255,255,0.95)', fontSize: 13 }}>RouterOS {summary?.version || '-'}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.95)', fontSize: 13 }}>Uptime {summary?.uptime || '-'}</Text>
                {isp && (
                  <Tag color={ispOk ? 'green' : ispMixed ? 'orange' : 'red'} style={{ border: 'none', fontWeight: 600 }}>
                    {ispOk ? '● Online' : ispMixed ? '◐ Partial' : '○ Offline'}
                  </Tag>
                )}
              </Space>
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Row gutter={[8, 8]}>
              <Col xs={8}>
                <HeroStat label="Hotspot" value={sessions.hotspot.length} icon={<WifiOutlined />} />
              </Col>
              <Col xs={8}>
                <HeroStat label="VPN" value={sessions.vpn.length} icon={<LockOutlined />} />
              </Col>
              <Col xs={8}>
                <HeroStat label="Devices" value={devices.active || 0} icon={<MobileOutlined />} />
              </Col>
            </Row>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {/* Resources */}
        {res && (
          <>
            <Col xs={24} sm={8}>
              <ResourceCard title="CPU" pct={res.cpu} color="#1677ff" />
            </Col>
            <Col xs={24} sm={8}>
              <ResourceCard title="Memory" pct={res.memPct} color="#722ed1" />
            </Col>
            <Col xs={24} sm={8}>
              <ResourceCard title="Disk" pct={res.diskPct} color="#13c2c2" />
            </Col>
          </>
        )}

        {/* Bandwidth */}
        {bw && (
          <>
            <Col xs={24} sm={12}>
              <Card size="small" bordered={false} style={cardStyle}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong><ArrowDownOutlined style={{ color: '#1677ff' }} /> Download</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{bw.rxPct}% ของ WAN</Text>
                </Space>
                <Statistic
                  value={(bw.rxBps / 1_000_000).toFixed(2)}
                  suffix="Mbps"
                  valueStyle={{ color: '#1677ff', fontSize: 28 }}
                />
                <Progress percent={bw.rxPct} strokeColor="#1677ff" showInfo={false}
                  status={bw.rxPct >= 90 ? 'exception' : 'normal'} />
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" bordered={false} style={cardStyle}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong><ArrowUpOutlined style={{ color: '#52c41a' }} /> Upload</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{bw.txPct}% ของ WAN</Text>
                </Space>
                <Statistic
                  value={(bw.txBps / 1_000_000).toFixed(2)}
                  suffix="Mbps"
                  valueStyle={{ color: '#52c41a', fontSize: 28 }}
                />
                <Progress percent={bw.txPct} strokeColor="#52c41a" showInfo={false}
                  status={bw.txPct >= 90 ? 'exception' : 'normal'} />
              </Card>
            </Col>
          </>
        )}

        {/* Security Pulse */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            bordered={false}
            style={cardStyle}
            title={<Space><SafetyCertificateOutlined style={{ color: '#eb2f96' }} /><b>Security Pulse</b><Text type="secondary" style={{ fontSize: 12 }}>24 ชม. ล่าสุด</Text></Space>}
            extra={<Link to="/logs"><Button size="small" type="link">ดู logs →</Button></Link>}
          >
            {pulse ? (
              <>
                <Row gutter={8}>
                  <Col span={8}><SeverityBox label="Critical" value={pulse.critical} color={SEVERITY_COLOR.critical} icon={<ThunderboltOutlined />} /></Col>
                  <Col span={8}><SeverityBox label="High"     value={pulse.high}     color={SEVERITY_COLOR.high}     icon={<FireOutlined />} /></Col>
                  <Col span={8}><SeverityBox label="Medium"   value={pulse.medium}   color={SEVERITY_COLOR.medium}   icon={<WarningOutlined />} /></Col>
                </Row>
                {pulse.topCategories.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>หมวดหมู่ที่พบ</Text>
                    <div style={{ marginTop: 6 }}>
                      {pulse.topCategories.map(c => (
                        <Tag key={c.category} style={{ marginBottom: 4 }}>
                          {CATEGORY_LABEL[c.category] || c.category}: <b>{c.count}</b>
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
                {pulse.topAttackers.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Top sources (auth fail)</Text>
                    <List
                      size="small"
                      dataSource={pulse.topAttackers}
                      renderItem={a => (
                        <List.Item style={{ padding: '4px 0' }}>
                          <span style={{ fontFamily: 'monospace' }}>{a.src_ip}</span>
                          <Tag color="red">{a.attempts} ครั้ง</Tag>
                        </List.Item>
                      )}
                    />
                  </div>
                )}
                {pulse.recentAudit.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Password events ล่าสุด</Text>
                    <List
                      size="small"
                      dataSource={pulse.recentAudit.slice(0, 5)}
                      renderItem={ev => (
                        <List.Item style={{ padding: '4px 0' }}>
                          <Space size={6} wrap>
                            <Tag color={ev.service === 'vpn' ? 'purple' : 'blue'} style={{ margin: 0 }}>{ev.service}</Tag>
                            <span style={{ fontSize: 12 }}>{ACTION_LABEL[ev.action] || ev.action}</span>
                            <Text strong style={{ fontSize: 12 }}>{ev.target_username}</Text>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(ev.created_at).format('HH:mm')}</Text>
                        </List.Item>
                      )}
                    />
                  </div>
                )}
                {pulse.critical === 0 && pulse.high === 0 && pulse.medium === 0 && (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <Tag color="success" style={{ padding: '6px 14px', fontSize: 14 }}>● SAFE — ไม่พบเหตุการณ์อันตราย</Tag>
                  </div>
                )}
              </>
            ) : <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>}
          </Card>
        </Col>

        {/* Active Sessions */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            bordered={false}
            style={cardStyle}
            title={<Space><WifiOutlined style={{ color: '#1677ff' }} /><b>Active Sessions</b></Space>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadAll} />}
          >
            <Row gutter={12}>
              <Col span={12}>
                <SessionBlock title="Hotspot" color="#1677ff" rows={sessions.hotspot} render={s => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Space size={6}>
                      <Badge status="success" />
                      <Text strong style={{ fontSize: 12 }}>{s.user}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.ip}</Text>
                  </List.Item>
                )} />
              </Col>
              <Col span={12}>
                <SessionBlock title="VPN" color="#722ed1" rows={sessions.vpn} render={s => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Space size={6}>
                      <Badge status="processing" />
                      <Text strong style={{ fontSize: 12 }}>{s.user}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.address}</Text>
                  </List.Item>
                )} />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Top Talkers */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            bordered={false}
            style={cardStyle}
            title={<Space><ThunderboltOutlined style={{ color: '#fa8c16' }} /><b>Top Bandwidth (วันนี้)</b></Space>}
            extra={<Link to="/devices"><Button size="small" type="link">ดูทั้งหมด →</Button></Link>}
          >
            {talkers.length > 0 ? <TopTalkersBarChart data={talkers} /> : <Empty description="ยังไม่มีข้อมูล bandwidth วันนี้" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>

        {/* Devices breakdown */}
        {devices.active > 0 && (
          <Col xs={24} lg={12}>
            <Card
              size="small"
              bordered={false}
              style={cardStyle}
              title={<Space><MobileOutlined style={{ color: '#13c2c2' }} /><b>Connected Devices</b><Text type="secondary" style={{ fontSize: 12 }}>{devices.active} เครื่อง</Text></Space>}
              extra={<Link to="/devices"><Button size="small" type="link">ดูทั้งหมด →</Button></Link>}
            >
              <Row gutter={[8, 8]}>
                {devices.breakdown.map(b => {
                  const ICONS = { mobile: <MobileOutlined />, computer: <DesktopOutlined />, iot: <CloudOutlined />, network: <DesktopOutlined />, unknown: <QuestionCircleOutlined /> };
                  return (
                    <Col xs={12} sm={8} key={b.type}>
                      <div style={{ padding: 12, borderRadius: 8, background: `${b.color}10`, borderLeft: `3px solid ${b.color}` }}>
                        <div style={{ color: b.color, fontSize: 12 }}>{ICONS[b.type] || ICONS.unknown} {b.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: b.color }}>{b.count} <span style={{ fontSize: 11, color: '#888' }}>({b.pct}%)</span></div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          </Col>
        )}

        {/* Realtime bandwidth chart */}
        {bwHistory.length > 0 && (
          <Col xs={24}>
            <Card
              bordered={false} style={cardStyle}
              title={<Space><ArrowUpOutlined /><b>Internet Usage — Real-time</b></Space>}
              extra={<Text type="secondary" style={{ fontSize: 12 }}>อัปเดตทุก 10 วินาที</Text>}
            >
              <RealtimeBandwidthChart data={bwHistory} />
            </Card>
          </Col>
        )}

        {/* Site usage chart */}
        <Col xs={24} md={12}>
          <Card
            bordered={false} style={cardStyle}
            title={<Space><GlobalOutlined /><b>เว็บไซต์ที่ใช้งานในเครือข่าย</b></Space>}
            extra={
              <Space>
                <Tooltip title="ดูข้อมูลย้อนหลัง (2 ปี)">
                  <DatePicker size="small" placeholder="วันนี้ (Real-time)"
                    value={selectedDate ? dayjs(selectedDate) : null}
                    onChange={handleDateChange}
                    disabledDate={d => d && d.isAfter(dayjs(), 'day')}
                    allowClear suffixIcon={<HistoryOutlined />} />
                </Tooltip>
                <Button size="small" icon={<ReloadOutlined />} loading={siteLoading} onClick={() => loadSiteStats(selectedDate)} />
              </Space>
            }
          >
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {selectedDate ? `ข้อมูลย้อนหลัง ${dayjs(selectedDate).format('D MMM YYYY')}` : 'จาก DNS cache — สัดส่วนการเข้าถึงเว็บ'}
            </Text>
            {siteLoading
              ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
              : siteStats.length > 0
                ? <SiteUsageChart data={siteStats} />
                : <Empty description="ยังไม่มีข้อมูล" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>

        {/* Top sites */}
        {siteStats.length > 0 && (
          <Col xs={24} md={12}>
            <Card
              bordered={false} style={cardStyle}
              title={<><GlobalOutlined /> <b>อันดับเว็บที่ใช้งานมากสุด</b></>}
            >
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                คลิกเพื่อดู domain breakdown
              </Text>
              {siteStats.slice(0, 10).map((s, i) => (
                <Tooltip key={s.name} title={s.name !== 'อื่นๆ' ? `คลิกดู domain ใน ${s.name}` : ''}>
                  <div
                    onClick={() => s.name !== 'อื่นๆ' && openDrilldown(s.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                      borderBottom: '1px solid #f5f5f5',
                      cursor: s.name !== 'อื่นๆ' ? 'pointer' : 'default',
                      borderRadius: 6, transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (s.name !== 'อื่นๆ') e.currentTarget.style.background = '#fafafa'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Text style={{ width: 18, color: '#aaa', textAlign: 'right', fontSize: 12 }}>{i + 1}</Text>
                    <SiteLogo domain={s.logo} size={22} />
                    <Text style={{ flex: 1, fontWeight: 500 }}>{s.name}</Text>
                    <div style={{ width: 100, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden', height: 8 }}>
                      <div style={{ width: `${Math.min(s.pct, 100)}%`, background: s.color, height: '100%', borderRadius: 4, transition: 'width 0.8s ease' }} />
                    </div>
                    <Tag style={{ minWidth: 52, textAlign: 'center', borderColor: s.color, color: s.color, background: `${s.color}15` }}>{s.pct}%</Tag>
                  </div>
                </Tooltip>
              ))}
            </Card>
          </Col>
        )}
      </Row>

      {/* Drilldown Modal */}
      <Modal
        open={!!drilldown}
        onCancel={() => setDrilldown(null)}
        title={drilldown && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SiteLogo domain={siteStats.find(s => s.name === drilldown.category)?.logo} size={24} />
            <span>{drilldown.category} — Domain Breakdown</span>
            <Tag color="blue">{dayjs(drilldown?.date).format('D MMM YYYY')}</Tag>
          </div>
        )}
        footer={null}
        width={500}
      >
        {drilldown?.loading
          ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          : (
            <Table
              dataSource={drilldown?.domains || []}
              rowKey="base_domain"
              size="small"
              pagination={false}
              columns={[
                { title: '#', render: (_, __, i) => <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text>, width: 36 },
                { title: 'Domain', dataIndex: 'base_domain',
                  render: d => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <SiteLogo domain={d} size={16} />
                      <Text style={{ fontSize: 13 }}>{d}</Text>
                    </div>
                  ) },
                { title: 'DNS Queries', dataIndex: 'total_count', width: 120,
                  render: (v) => {
                    const max = drilldown?.domains?.[0]?.total_count || 1;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', height: 6 }}>
                          <div style={{ width: `${(v / max) * 100}%`, background: '#1677ff', height: '100%' }} />
                        </div>
                        <Text style={{ fontSize: 12 }}>{v}</Text>
                      </div>
                    );
                  } },
              ]}
            />
          )}
      </Modal>
    </div>
  );
}

// ---- inline subcomponents -----------------------------------------------

const cardStyle = { borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' };

function HeroStat({ label, value, icon }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.15)',
      backdropFilter: 'blur(6px)',
      borderRadius: 8,
      padding: '10px 12px',
      textAlign: 'center',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{icon} {label}</div>
      <div style={{ color: '#fff', fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function ResourceCard({ title, pct, color }) {
  const safePct = Math.max(0, Math.min(100, pct || 0));
  const isDanger = safePct >= 90;
  return (
    <Card size="small" bordered={false} style={cardStyle}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text strong>{title}</Text>
        <Text strong style={{ color: isDanger ? '#ff4d4f' : color, fontSize: 18 }}>{Math.round(safePct)}%</Text>
      </Space>
      <Progress percent={safePct} showInfo={false} strokeColor={isDanger ? '#ff4d4f' : color}
        style={{ marginTop: 4 }} />
    </Card>
  );
}

function SeverityBox({ label, value, color, icon }) {
  return (
    <div style={{
      background: value > 0 ? `${color}15` : '#fafafa',
      borderLeft: `3px solid ${value > 0 ? color : '#d9d9d9'}`,
      borderRadius: 6,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 11, color: value > 0 ? color : '#888' }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: value > 0 ? color : '#bfbfbf' }}>{value}</div>
    </div>
  );
}

function TopTalkersBarChart({ data }) {
  const chartData = data.map(t => ({
    name: (t.hostname || t.vendor || t.ip || t.mac || '?').slice(0, 18),
    rx: +(Number(t.rx_bytes) / 1024 / 1024).toFixed(1),
    tx: +(Number(t.tx_bytes) / 1024 / 1024).toFixed(1),
    total: Number(t.total_bytes) || 0,
    ip: t.ip || t.mac,
  }));
  const height = Math.max(220, chartData.length * 34);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <XAxis type="number" tickFormatter={v => `${v} MB`} style={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={130} style={{ fontSize: 11 }} />
        <RTooltip
          formatter={(value, key, item) => [`${value} MB`, key === 'rx' ? 'Download' : 'Upload']}
          labelFormatter={(label, payload) => payload?.[0]?.payload?.ip ? `${label} (${payload[0].payload.ip})` : label}
        />
        <Bar dataKey="rx" stackId="bw" fill="#1677ff" name="Download" />
        <Bar dataKey="tx" stackId="bw" fill="#52c41a" name="Upload" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SessionBlock({ title, color, rows, render }) {
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text strong style={{ color }}>{title}</Text>
        <Tag color={rows.length > 0 ? 'success' : 'default'} style={{ margin: 0 }}>{rows.length}</Tag>
      </Space>
      {rows.length > 0
        ? <List size="small" dataSource={rows.slice(0, 8)} renderItem={render}
            style={{ maxHeight: 240, overflowY: 'auto' }} />
        : <Empty description="ไม่มี session" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: 0 }} />}
    </div>
  );
}
