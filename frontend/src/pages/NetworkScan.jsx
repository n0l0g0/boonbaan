import { useState } from 'react';
import { Table, Button, Tag, Card, Row, Col, Statistic, Input, Space, Typography } from 'antd';
import { ScanOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../services/api';

const { Text } = Typography;

export default function NetworkScan() {
  const [devices, setDevices] = useState([]);
  const [ipBw, setIpBw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bwLoading, setBwLoading] = useState(false);
  const [search, setSearch] = useState('');

  async function scan() {
    setLoading(true);
    try { setDevices((await api.get('/network/scan')).data); } catch { }
    setLoading(false);
  }

  async function takeSnapshot() {
    setBwLoading(true);
    try { setIpBw((await api.post('/network/ip-accounting/snapshot')).data); }
    catch { await api.post('/network/ip-accounting/enable').catch(() => {}); }
    setBwLoading(false);
  }

  const filtered = search
    ? devices.filter(d => d.ip?.includes(search) || d.mac?.includes(search) || d.hostname?.toLowerCase().includes(search.toLowerCase()))
    : devices;

  const cols = [
    { title: 'IP', dataIndex: 'ip', sorter: (a, b) => a.ip?.localeCompare(b.ip) },
    { title: 'MAC', dataIndex: 'mac', render: v => <Text code>{v}</Text> },
    { title: 'Hostname', dataIndex: 'hostname', render: v => v || '-' },
    { title: 'Interface', dataIndex: 'interface', render: v => v ? <Tag>{v}</Tag> : '-' },
    { title: 'Status', dataIndex: 'status', render: v => <Tag color={v === 'reachable' || v === 'bound' ? 'green' : 'default'}>{v || 'unknown'}</Tag> },
    { title: 'Source', dataIndex: 'source', render: v => <Tag color={v === 'dhcp' ? 'blue' : 'default'}>{v}</Tag> },
  ];

  const bwCols = [
    { title: 'Src IP', dataIndex: 'src-address' },
    { title: 'Dst IP', dataIndex: 'dst-address' },
    { title: 'Bytes', dataIndex: 'bytes', render: v => v ? `${(v / 1024).toFixed(1)} KB` : '-' },
    { title: 'Packets', dataIndex: 'packets' },
  ];

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic title="Devices Found" value={devices.length} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic title="Online (DHCP Bound)" value={devices.filter(d => d.leaseStatus === 'bound').length} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic title="IP BW Records" value={ipBw.length} /></Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Network Devices"
            extra={
              <Space>
                <Input prefix={<SearchOutlined />} placeholder="ค้นหา IP / MAC / Hostname" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} allowClear />
                <Button type="primary" icon={<ScanOutlined />} onClick={scan} loading={loading}>Scan</Button>
              </Space>
            }
          >
            <Table dataSource={filtered} columns={cols} rowKey="mac" loading={loading} size="small" pagination={{ pageSize: 20 }} />
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Bandwidth per IP (IP Accounting)"
            extra={<Button icon={<ReloadOutlined />} onClick={takeSnapshot} loading={bwLoading}>Take Snapshot</Button>}
          >
            {ipBw.length === 0
              ? <Text type="secondary">กด "Take Snapshot" เพื่อดึงข้อมูล (ต้องเปิด IP Accounting ใน MikroTik ก่อน)</Text>
              : <Table dataSource={ipBw} columns={bwCols} rowKey={(r, i) => i} size="small" pagination={{ pageSize: 20 }} />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
