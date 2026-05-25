import { useEffect, useState, useCallback } from 'react';
import { Card, Col, Row, Statistic, Progress, Typography, Tag, Button, DatePicker, Modal, Table, Spin, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined, HistoryOutlined, CloseOutlined, MobileOutlined, DesktopOutlined, CloudOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../services/api';
import { useSocket } from '../hooks/useSocket';
import { RealtimeBandwidthChart } from '../components/Charts/BandwidthChart';
import SiteUsageChart, { SiteLogo } from '../components/Charts/SiteUsageChart';

const { Title, Text } = Typography;
const MAX_BW_POINTS = 30;

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [monitorStats, setMonitorStats] = useState(null);
  const [bwHistory, setBwHistory] = useState([]);
  const [siteStats, setSiteStats] = useState([]);
  const [siteLoading, setSiteLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null); // null = real-time
  const [drilldown, setDrilldown] = useState(null); // { category, date, domains, loading }
  const [devices, setDevices] = useState({ total: 0, active: 0, breakdown: [] });

  async function loadSiteStats(date) {
    setSiteLoading(true);
    try {
      if (date) {
        const r = await api.get(`/dashboard/site-stats/history?date=${date}`);
        setSiteStats(r.data.data || []);
      } else {
        const r = await api.get('/dashboard/site-stats');
        setSiteStats(r.data.data || []);
      }
    } catch { }
    setSiteLoading(false);
  }

  async function openDrilldown(category) {
    const date = selectedDate || dayjs().format('YYYY-MM-DD');
    setDrilldown({ category, date, domains: [], loading: true });
    try {
      const r = await api.get(`/dashboard/site-stats/drilldown?category=${encodeURIComponent(category)}&date=${date}`);
      setDrilldown(prev => ({ ...prev, domains: r.data.domains || [], loading: false }));
    } catch {
      setDrilldown(prev => ({ ...prev, loading: false }));
    }
  }

  function handleDateChange(dayjsVal) {
    const date = dayjsVal ? dayjsVal.format('YYYY-MM-DD') : null;
    setSelectedDate(date);
    loadSiteStats(date);
  }

  async function loadDevices() {
    try { setDevices((await api.get('/devices/breakdown')).data); } catch { }
  }

  useEffect(() => {
    api.get('/dashboard').then(r => setSummary(r.data)).catch(() => {});
    loadSiteStats(null);
    loadDevices();
    const t = setInterval(loadDevices, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleMonitor = useCallback((data) => {
    setMonitorStats(data);
    if (data.bandwidth) {
      setBwHistory(prev => [...prev.slice(-MAX_BW_POINTS + 1), { ...data.bandwidth, t: Date.now() }]);
    }
  }, []);

  useSocket('monitor:update', handleMonitor);

  const res = monitorStats?.resources;
  const bw = monitorStats?.bandwidth;
  const isp = monitorStats?.isp;

  return (
    <div>
      <Title level={4}>Dashboard</Title>
      <Row gutter={[16, 16]}>
        {/* Info cards */}
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            <Statistic title="Router" value={summary?.identity || '-'} />
            <Text type="secondary" style={{ fontSize: 12 }}>{summary?.uptime}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            <Statistic title="RouterOS" value={summary?.version || '-'} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            <Statistic title="Hotspot Active" value={summary?.hotspotActiveCount ?? '-'} suffix="users" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            {isp?.wans && isp.wans.length > 1 ? (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>ISP Status (Multi-WAN)</Text>
                <div style={{ marginTop: 4 }}>
                  {isp.wans.map(w => (
                    <div key={w.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontSize: 12 }}>{w.label || w.name}</Text>
                      <Tag color={w.online ? 'success' : 'error'} style={{ margin: 0, fontSize: 11 }}>
                        {w.online ? 'Online' : 'Offline'}
                      </Tag>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Statistic
                title="ISP Status"
                value={isp?.online === true ? 'Online' : isp?.online === false ? 'Offline' : '-'}
                valueStyle={{ color: isp?.online === true ? '#52c41a' : isp?.online === false ? '#ff4d4f' : undefined }}
              />
            )}
          </Card>
        </Col>

        {/* Resources */}
        {res && <>
          <Col xs={24} sm={8}>
            <Card title="CPU Usage" size="small">
              <Progress percent={res.cpu} status={res.cpu >= 90 ? 'exception' : res.cpu >= 80 ? 'active' : 'normal'} />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card title="Memory Usage" size="small">
              <Progress percent={res.memPct} status={res.memPct >= 90 ? 'exception' : res.memPct >= 80 ? 'active' : 'normal'} />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card title="Disk Usage" size="small">
              <Progress percent={res.diskPct} status={res.diskPct >= 90 ? 'exception' : res.diskPct >= 80 ? 'active' : 'normal'} />
            </Card>
          </Col>
        </>}

        {/* Bandwidth summary */}
        {bw && <>
          <Col xs={24} sm={12}>
            <Card title="Download (RX)" size="small">
              <Statistic
                value={(bw.rxBps / 1_000_000).toFixed(2)}
                suffix="Mbps"
                prefix={<ArrowDownOutlined style={{ color: '#1677ff' }} />}
              />
              <Progress percent={bw.rxPct} strokeColor="#1677ff" showInfo={false} style={{ marginTop: 8 }}
                status={bw.rxPct >= 90 ? 'exception' : bw.rxPct >= 80 ? 'active' : 'normal'} />
              <Text type="secondary" style={{ fontSize: 12 }}>{bw.rxPct}% ของ WAN</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card title="Upload (TX)" size="small">
              <Statistic
                value={(bw.txBps / 1_000_000).toFixed(2)}
                suffix="Mbps"
                prefix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
              />
              <Progress percent={bw.txPct} strokeColor="#52c41a" showInfo={false} style={{ marginTop: 8 }}
                status={bw.txPct >= 90 ? 'exception' : bw.txPct >= 80 ? 'active' : 'normal'} />
              <Text type="secondary" style={{ fontSize: 12 }}>{bw.txPct}% ของ WAN</Text>
            </Card>
          </Col>
        </>}

        {/* Connected devices breakdown */}
        {devices.active > 0 && (
          <Col xs={24}>
            <Card
              size="small"
              title={<>อุปกรณ์ที่เชื่อมต่อ ({devices.active} เครื่อง)</>}
              extra={<Link to="/devices"><Button size="small" type="link">ดูทั้งหมด →</Button></Link>}
            >
              <Row gutter={[8, 8]}>
                {devices.breakdown.map(b => {
                  const ICONS = { mobile: <MobileOutlined />, computer: <DesktopOutlined />, iot: <CloudOutlined />, network: <DesktopOutlined />, unknown: <QuestionCircleOutlined /> };
                  return (
                    <Col xs={12} sm={8} md={6} lg={4} key={b.type}>
                      <Card size="small" style={{ borderColor: b.color }}>
                        <Statistic
                          title={<span style={{ color: b.color }}>{ICONS[b.type] || ICONS.unknown} {b.label}</span>}
                          value={b.count}
                          suffix={<Text type="secondary" style={{ fontSize: 12 }}>{b.pct}%</Text>}
                          valueStyle={{ color: b.color, fontSize: 22 }}
                        />
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          </Col>
        )}

        {/* Realtime chart */}
        {bwHistory.length > 0 && (
          <Col xs={24}>
            <Card
              title="Internet Usage — Real-time"
              extra={<Text type="secondary" style={{ fontSize: 12 }}>อัปเดตทุก 10 วินาที</Text>}
            >
              <RealtimeBandwidthChart data={bwHistory} />
            </Card>
          </Col>
        )}

        {/* Site usage pie chart */}
        <Col xs={24} md={12}>
          <Card
            title="เว็บไซต์ที่ใช้งานในเครือข่าย"
            extra={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Tooltip title="เลือกดูข้อมูลย้อนหลัง (เก็บข้อมูล 2 ปี)">
                  <DatePicker
                    size="small"
                    placeholder="วันนี้ (Real-time)"
                    value={selectedDate ? dayjs(selectedDate) : null}
                    onChange={handleDateChange}
                    disabledDate={d => d && d.isAfter(dayjs(), 'day')}
                    allowClear
                    suffixIcon={<HistoryOutlined />}
                  />
                </Tooltip>
                <Button size="small" icon={<ReloadOutlined />} loading={siteLoading} onClick={() => loadSiteStats(selectedDate)}>
                  Refresh
                </Button>
              </div>
            }
          >
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {selectedDate
                ? `ข้อมูลย้อนหลัง ${dayjs(selectedDate).format('D MMM YYYY')} — รวมจาก snapshot รายชั่วโมง`
                : 'วิเคราะห์จาก DNS cache — แสดงสัดส่วนการเข้าถึงเว็บไซต์ในเครือข่าย'}
            </Text>
            {siteLoading
              ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
              : siteStats.length > 0
                ? <SiteUsageChart data={siteStats} />
                : <Text type="secondary">{selectedDate ? 'ไม่มีข้อมูลในวันที่เลือก' : 'กำลังโหลดข้อมูล...'}</Text>}
          </Card>
        </Col>

        {/* Top sites list with drilldown */}
        {siteStats.length > 0 && (
          <Col xs={24} md={12}>
            <Card title="อันดับเว็บที่ใช้งานมากสุด">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                {selectedDate ? `ข้อมูลวันที่ ${dayjs(selectedDate).format('D MMM YYYY')}` : 'นับจากจำนวน DNS entries ใน cache ปัจจุบัน'} — คลิกเพื่อดูรายละเอียด
              </Text>
              {siteStats.slice(0, 10).map((s, i) => (
                <Tooltip key={s.name} title={s.name !== 'อื่นๆ' ? `คลิกดู domain ใน ${s.name}` : ''}>
                  <div
                    onClick={() => s.name !== 'อื่นๆ' && openDrilldown(s.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                      borderBottom: '1px solid #f5f5f5',
                      cursor: s.name !== 'อื่นๆ' ? 'pointer' : 'default',
                      borderRadius: 6,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (s.name !== 'อื่นๆ') e.currentTarget.style.background = '#f5f5f5'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Text style={{ width: 18, color: '#aaa', textAlign: 'right', flexShrink: 0, fontSize: 12 }}>{i + 1}</Text>
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
        title={
          drilldown && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SiteLogo domain={siteStats.find(s => s.name === drilldown.category)?.logo} size={24} />
              <span>{drilldown.category} — Domain Breakdown</span>
              <Tag color="blue" style={{ marginLeft: 4 }}>{dayjs(drilldown?.date).format('D MMM YYYY')}</Tag>
            </div>
          )
        }
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
                {
                  title: 'Domain',
                  dataIndex: 'base_domain',
                  render: d => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <SiteLogo domain={d} size={16} />
                      <Text style={{ fontSize: 13 }}>{d}</Text>
                    </div>
                  ),
                },
                {
                  title: 'DNS Queries',
                  dataIndex: 'total_count',
                  width: 120,
                  render: (v, _, i, arr) => {
                    const max = drilldown?.domains?.[0]?.total_count || 1;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', height: 6 }}>
                          <div style={{ width: `${(v / max) * 100}%`, background: '#1677ff', height: '100%' }} />
                        </div>
                        <Text style={{ fontSize: 12 }}>{v}</Text>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        {!drilldown?.loading && drilldown?.domains?.length === 0 && (
          <Text type="secondary">ไม่มีข้อมูล domain ในวันที่เลือก (ข้อมูลเก็บทุกชั่วโมง)</Text>
        )}
      </Modal>
    </div>
  );
}
