import { useEffect, useState } from 'react';
import { Table, Button, Tag, Descriptions, Card, Row, Col } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function AP() {
  const [data, setData] = useState({ registrations: [], accessPoints: [] });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setData((await api.get('/ap')).data); } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const regCols = [
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'AP MAC', dataIndex: 'ap-tx-signal', render: (_, r) => r['ap-mac-address'] || '-' },
    { title: 'Interface', dataIndex: 'interface' },
    { title: 'SSID', dataIndex: 'ssid' },
    { title: 'Signal', dataIndex: 'rx-signal', render: v => v ? `${v} dBm` : '-' },
    { title: 'Uptime', dataIndex: 'uptime' },
    { title: 'Bytes In', dataIndex: 'bytes', render: v => '-' },
  ];

  return (
    <div>
      <Button icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ marginBottom: 16 }}>
        Refresh
      </Button>
      <Card title={`Access Points (${data.accessPoints.length})`} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          {data.accessPoints.map((ap, i) => (
            <Col key={i} xs={24} sm={12} md={8}>
              <Card size="small" style={{ marginBottom: 8 }}>
                <div><strong>{ap.name || ap.mac}</strong></div>
                <Tag color={ap.state === 'running' ? 'green' : 'red'}>{ap.state}</Tag>
                <div style={{ fontSize: 12, color: '#888' }}>{ap.address}</div>
              </Card>
            </Col>
          ))}
          {data.accessPoints.length === 0 && <Col><span style={{ color: '#888' }}>ไม่พบ Access Point (CAPsMAN)</span></Col>}
        </Row>
      </Card>
      <Card title={`Registrations (${data.registrations.length})`}>
        <Table dataSource={data.registrations} columns={regCols} rowKey=".id" loading={loading} size="small" />
      </Card>
    </div>
  );
}
