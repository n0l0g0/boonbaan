import { useState } from 'react';
import { Card, Form, InputNumber, Input, Button, Select, Table, Tag, Space, Typography, Divider, message } from 'antd';
import { GiftOutlined, PrinterOutlined, CopyOutlined } from '@ant-design/icons';
import api from '../services/api';

const { Text, Title } = Typography;

export default function Voucher() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  async function generate(values) {
    setLoading(true);
    try {
      const r = await api.post('/voucher/generate', values);
      setVouchers(r.data);
      message.success(`สร้าง ${r.data.length} voucher สำเร็จ`);
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
    setLoading(false);
  }

  function copyAll() {
    const text = vouchers.map(v => v.code).join('\n');
    navigator.clipboard.writeText(text);
    message.success('คัดลอกทุก code แล้ว');
  }

  function print() {
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Vouchers</title>
      <style>
        body { font-family: monospace; }
        .v { border: 1px dashed #333; padding: 12px 20px; margin: 8px; display: inline-block; width: 180px; text-align: center; }
        .code { font-size: 20px; font-weight: bold; letter-spacing: 2px; }
        .label { font-size: 11px; color: #666; }
      </style></head><body>
      ${vouchers.map(v => `<div class="v"><div class="label">WiFi Voucher</div><div class="code">${v.code}</div><div class="label">${v.profile}</div></div>`).join('')}
      </body></html>`);
    win.print();
  }

  const cols = [
    { title: 'Code', dataIndex: 'code', render: v => <Text code style={{ fontSize: 15, letterSpacing: 2 }}>{v}</Text> },
    { title: 'Profile', dataIndex: 'profile' },
    { title: 'Status', dataIndex: 'error', render: v => v ? <Tag color="red">Error: {v}</Tag> : <Tag color="green">สร้างแล้ว</Tag> },
  ];

  return (
    <div>
      <Card title={<><GiftOutlined /> สร้าง Hotspot Voucher</>} style={{ marginBottom: 16, maxWidth: 500 }}>
        <Form form={form} layout="vertical" onFinish={generate} initialValues={{ count: 10, profile: 'default', prefix: 'WIFI', codeLength: 6 }}>
          <Form.Item name="count" label="จำนวน Voucher"><InputNumber min={1} max={100} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="profile" label="Hotspot Profile"><Input placeholder="default" /></Form.Item>
          <Form.Item name="prefix" label="Prefix (นำหน้า code)"><Input placeholder="WIFI" /></Form.Item>
          <Form.Item name="codeLength" label="ความยาว code"><InputNumber min={4} max={12} style={{ width: '100%' }} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} icon={<GiftOutlined />} block>สร้าง Voucher</Button>
        </Form>
      </Card>

      {vouchers.length > 0 && (
        <Card
          title={`Vouchers (${vouchers.length})`}
          extra={<Space><Button icon={<CopyOutlined />} onClick={copyAll}>Copy ทั้งหมด</Button><Button icon={<PrinterOutlined />} onClick={print}>Print</Button></Space>}
        >
          <Table dataSource={vouchers} columns={cols} rowKey="code" size="small" pagination={false} />
        </Card>
      )}
    </div>
  );
}
