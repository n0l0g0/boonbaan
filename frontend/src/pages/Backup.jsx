import { useEffect, useState } from 'react';
import { Table, Button, Card, Row, Col, message, Typography, Tag, Space } from 'antd';
import { SaveOutlined, CloudUploadOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons';
import api from '../services/api';

const { Title } = Typography;

const TZ = 'th-TH';
const TZ_OPT = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };

function fmtDate(v) { return v ? new Date(v).toLocaleString(TZ, TZ_OPT) : '-'; }

export default function Backup() {
  const [data, setData] = useState({ router: [], drive: [], history: [] });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    try { setData((await api.get('/backup/list')).data); } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createBackup() {
    setCreating(true);
    try {
      const r = await api.post('/backup/create');
      message.success(`Backup สำเร็จ: ${r.data.name}${r.data.drive ? ' (อัปโหลดไป Google Drive แล้ว)' : ''}`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Backup ล้มเหลว');
    } finally { setCreating(false); }
  }

  async function createExport() {
    setExporting(true);
    try {
      const r = await api.post('/backup/export');
      message.success(`Export สำเร็จ: ${r.data.name}.rsc (${r.data.lines} บรรทัด)${r.data.drive ? ' — อัปโหลดไป Google Drive แล้ว' : ''}`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Export ล้มเหลว');
    } finally { setExporting(false); }
  }

  const routerCols = [
    { title: 'ชื่อไฟล์', dataIndex: 'name' },
    { title: 'ขนาด', dataIndex: 'size', render: v => v ? `${(v / 1024).toFixed(1)} KB` : '-' },
    { title: 'วันที่', dataIndex: 'creation-time' },
  ];

  const driveCols = [
    { title: 'ชื่อไฟล์', dataIndex: 'name', render: (v, r) => <a href={r.webViewLink} target="_blank" rel="noreferrer">{v}</a> },
    { title: 'ขนาด', dataIndex: 'size', render: v => v ? `${(v / 1024).toFixed(1)} KB` : '-' },
    { title: 'วันที่', dataIndex: 'createdTime', render: v => fmtDate(v) },
  ];

  const historyCols = [
    {
      title: 'ประเภท', dataIndex: 'type', width: 90,
      render: v => <Tag color={v === 'export' ? 'purple' : 'blue'}>{v === 'export' ? 'Export (.rsc)' : 'Backup (.backup)'}</Tag>,
    },
    { title: 'ชื่อ', dataIndex: 'name' },
    { title: 'สถานะ', dataIndex: 'status', width: 90, render: v => <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag> },
    { title: 'Google Drive', dataIndex: 'drive_link', render: v => v ? <a href={v} target="_blank" rel="noreferrer">เปิด</a> : '-' },
    { title: 'เวลา (+7)', dataIndex: 'created_at', render: v => fmtDate(v) },
  ];

  return (
    <div>
      <Title level={4}>Backup & Export</Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<SaveOutlined />} onClick={createBackup} loading={creating}>
          Binary Backup (.backup)
        </Button>
        <Button icon={<ExportOutlined />} onClick={createExport} loading={exporting}>
          Export Config (.rsc)
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={`ไฟล์บน Router (${data.router.length})`} size="small">
            <Table dataSource={data.router} columns={routerCols} rowKey="name" size="small" pagination={false} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<><CloudUploadOutlined /> Google Drive ({data.drive.length})</>} size="small">
            <Table dataSource={data.drive} columns={driveCols} rowKey="id" size="small" pagination={false} />
          </Card>
        </Col>
        <Col xs={24}>
          <Card title={`ประวัติ Backup & Export`} size="small">
            <Table
              dataSource={data.history}
              columns={historyCols}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
