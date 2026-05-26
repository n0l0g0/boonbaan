import { useEffect, useState } from 'react';
import { Card, Row, Col, Form, Switch, InputNumber, Input, Button, Table, Tag, Tooltip, Space, message, Popconfirm, Alert, Statistic, Typography } from 'antd';
import { SaveOutlined, ReloadOutlined, ThunderboltOutlined, StopOutlined, PlayCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../services/api';

const { Text } = Typography;

const STATUS_COLOR = { active: 'red', expired: 'default', unblocked: 'orange' };

export default function BruteForce() {
  const [cfg, setCfg] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('active');
  const [form] = Form.useForm();

  async function loadCfg() {
    try {
      const r = await api.get('/bruteforce/settings');
      setCfg(r.data);
      form.setFieldsValue({
        bf_enabled: r.data.enabled,
        bf_window_min: r.data.windowMin,
        bf_threshold: r.data.threshold,
        bf_block_duration_min: r.data.blockMin,
        bf_address_list: r.data.listName,
        bf_whitelist_extra: r.data.whitelistExtra.join(', '),
      });
    } catch (e) { message.error(e.response?.data?.error || 'load settings failed'); }
  }

  async function loadBlocks() {
    setLoading(true);
    try {
      const r = await api.get('/bruteforce/blocks', { params: filter ? { status: filter } : {} });
      setBlocks(r.data);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { loadCfg(); }, []);
  useEffect(() => { loadBlocks(); }, [filter]);

  async function save(values) {
    setSaving(true);
    try {
      const r = await api.patch('/bruteforce/settings', values);
      setCfg(r.data);
      message.success('บันทึกแล้ว');
    } catch (e) { message.error(e.response?.data?.error || 'save failed'); }
    setSaving(false);
  }

  async function unblock(ip) {
    try {
      await api.post('/bruteforce/unblock', { ip });
      message.success(`Unblocked ${ip}`);
      loadBlocks();
    } catch (e) { message.error(e.response?.data?.error || 'unblock failed'); }
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await api.post('/bruteforce/evaluate');
      if (r.data.skipped === 'disabled') {
        message.warning('Brute-force protection ปิดอยู่');
      } else {
        message.success(`scan เสร็จ — block ใหม่ ${r.data.blocked} IP (candidates ${r.data.candidates}, skipped ${r.data.skipped})`);
      }
      loadBlocks();
    } catch (e) { message.error(e.response?.data?.error || 'evaluate failed'); }
    setRunning(false);
  }

  const activeCount = blocks.filter(b => b.status === 'active').length;

  const cols = [
    {
      title: 'Status', dataIndex: 'status', width: 100,
      render: v => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    { title: 'IP', dataIndex: 'ip', width: 140, render: v => <Text strong style={{ fontFamily: 'monospace' }}>{v}</Text> },
    { title: 'Attempts', dataIndex: 'attempts', width: 90, render: v => <Tag color="red">{v}</Tag> },
    {
      title: 'Category', dataIndex: 'categories', width: 220,
      render: v => v ? v.split(',').map(c => <Tag key={c} style={{ marginBottom: 2, fontSize: 11 }}>{c}</Tag>) : '-',
    },
    {
      title: 'First seen', dataIndex: 'first_seen', width: 160,
      render: v => <span style={{ fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: 'Blocked', dataIndex: 'blocked_at', width: 160,
      render: v => <span style={{ fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>,
    },
    {
      title: 'Expires', dataIndex: 'expires_at', width: 160,
      render: (v, r) => {
        if (r.status === 'unblocked') return <Text type="secondary">unblocked by {r.unblocked_by || '?'}</Text>;
        const ms = new Date(v) - Date.now();
        if (ms <= 0) return <Text type="secondary">expired</Text>;
        const min = Math.floor(ms / 60000);
        return <Text style={{ fontSize: 12 }}>{min} นาที</Text>;
      },
    },
    {
      title: 'Action', width: 110,
      render: (_, r) => r.status === 'active'
        ? (
          <Popconfirm title={`Unblock ${r.ip}?`} onConfirm={() => unblock(r.ip)}>
            <Button danger size="small" icon={<StopOutlined />}>Unblock</Button>
          </Popconfirm>
        )
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>,
    },
  ];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9}>
        <Card
          title={<Space><SafetyCertificateOutlined style={{ color: '#eb2f96' }} /> <b>Brute-Force Auto-Block</b></Space>}
          extra={cfg && <Tag color={cfg.enabled ? 'green' : 'default'}>{cfg.enabled ? 'ON' : 'OFF'}</Tag>}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="ทุก 30 วินาที ระบบจะ scan logs ที่จัดเป็น auth_failure ถ้า IP เดียวเกิน threshold ในช่วง window จะเพิ่ม IP ไปยัง MikroTik address-list อัตโนมัติ (พร้อม timeout)"
          />
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="ต้องมี firewall rule บน MikroTik"
            description={
              <code style={{ fontSize: 11 }}>
                /ip firewall filter add chain=input src-address-list={cfg?.listName || 'auto_blacklist'} action=drop comment="brute-force auto-block"
              </code>
            }
          />
          <Form form={form} layout="vertical" onFinish={save}>
            <Form.Item name="bf_enabled" label="เปิดใช้งาน" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="bf_window_min" label="Window (นาที)" tooltip="ดู log ย้อนหลังกี่นาที">
              <InputNumber min={1} max={1440} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bf_threshold" label="Threshold (จำนวนครั้ง)" tooltip="ถ้า auth_fail ใน window ≥ ค่านี้ → block">
              <InputNumber min={2} max={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bf_block_duration_min" label="ระยะเวลาบล็อก (นาที)" tooltip="MikroTik จะ auto-remove เมื่อหมดเวลา">
              <InputNumber min={1} max={60 * 24 * 30} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bf_address_list" label="ชื่อ address-list">
              <Input placeholder="auto_blacklist" />
            </Form.Item>
            <Form.Item
              name="bf_whitelist_extra"
              label="Whitelist เพิ่มเติม"
              tooltip="คั่นด้วย comma หรือ space — รองรับ IP หรือ CIDR (RFC1918 + 127/8 + 169.254/16 ถูก whitelist อัตโนมัติแล้ว)"
            >
              <Input placeholder="180.183.248.150, 1.2.3.0/24" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>บันทึก</Button>
              <Button icon={<PlayCircleOutlined />} loading={running} onClick={runNow}>Run scan ทันที</Button>
            </Space>
          </Form>
        </Card>
      </Col>

      <Col xs={24} lg={15}>
        <Card
          title={<Space><ThunderboltOutlined style={{ color: '#fa541c' }} /> <b>Blocked IPs</b></Space>}
          extra={
            <Space>
              <Statistic
                title="Active"
                value={activeCount}
                valueStyle={{ fontSize: 16, color: activeCount > 0 ? '#ff4d4f' : undefined }}
              />
              <Button.Group>
                <Button type={filter === 'active' ? 'primary' : 'default'} size="small" onClick={() => setFilter('active')}>Active</Button>
                <Button type={filter === 'unblocked' ? 'primary' : 'default'} size="small" onClick={() => setFilter('unblocked')}>Unblocked</Button>
                <Button type={filter === 'expired' ? 'primary' : 'default'} size="small" onClick={() => setFilter('expired')}>Expired</Button>
                <Button type={filter === '' ? 'primary' : 'default'} size="small" onClick={() => setFilter('')}>All</Button>
              </Button.Group>
              <Tooltip title="Refresh"><Button size="small" icon={<ReloadOutlined />} onClick={loadBlocks} loading={loading} /></Tooltip>
            </Space>
          }
        >
          <Table
            dataSource={blocks}
            columns={cols}
            rowKey="id"
            size="small"
            loading={loading}
            pagination={{ defaultPageSize: 20, pageSizeOptions: ['10', '20', '50', '100'], showSizeChanger: true }}
          />
        </Card>
      </Col>
    </Row>
  );
}
