import { useState } from 'react';
import { Card, Button, Select, Row, Col, Typography, Space } from 'antd';
import { FileExcelOutlined, DownloadOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const MONTHS = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
];

export default function Report() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);

  async function downloadReport() {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/report/monthly?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
    setLoading(false);
  }

  const yearOptions = Array.from({ length: 3 }, (_, i) => ({ value: now.getFullYear() - i, label: String(now.getFullYear() - i) }));
  const monthOptions = MONTHS.map((m, i) => ({ value: i + 1, label: m }));

  return (
    <div>
      <Title level={4}>Monthly Report</Title>
      <Card style={{ maxWidth: 480 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Row gutter={12}>
            <Col span={12}>
              <Text>ปี</Text>
              <Select options={yearOptions} value={year} onChange={setYear} style={{ width: '100%', marginTop: 4 }} />
            </Col>
            <Col span={12}>
              <Text>เดือน</Text>
              <Select options={monthOptions} value={month} onChange={setMonth} style={{ width: '100%', marginTop: 4 }} />
            </Col>
          </Row>

          <Button type="primary" icon={<FileExcelOutlined />} size="large" block loading={loading} onClick={downloadReport}>
            <DownloadOutlined /> Download Report ({MONTHS[month - 1]} {year})
          </Button>

          <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, fontSize: 13 }}>
            <Text type="secondary">รายงานประกอบด้วย:</Text>
            <ul style={{ marginTop: 6, paddingLeft: 20 }}>
              <li>Bandwidth usage รายชั่วโมง (RX/TX Mbps)</li>
              <li>Alert history ทั้งหมด</li>
              <li>Backup history + Google Drive links</li>
            </ul>
          </div>
        </Space>
      </Card>
    </div>
  );
}
