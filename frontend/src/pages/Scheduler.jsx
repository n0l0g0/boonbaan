import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Switch, message, Popconfirm, Tag, Space, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, PlayCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import api from '../services/api';

const CRON_PRESETS = [
  { label: 'ทุกวัน 02:00', value: '0 2 * * *' },
  { label: 'ทุกวันอาทิตย์ 04:00', value: '0 4 * * 0' },
  { label: 'ทุกชั่วโมง', value: '0 * * * *' },
  { label: 'ทุก 6 ชั่วโมง', value: '0 */6 * * *' },
  { label: 'กำหนดเอง', value: 'custom' },
];

export default function Scheduler() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [running, setRunning] = useState({});
  const [cronPreset, setCronPreset] = useState('0 2 * * *');
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try { setTasks((await api.get('/scheduler')).data); } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function submit(values) {
    try {
      await api.post('/scheduler', values);
      message.success('เพิ่ม task สำเร็จ');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  async function toggleEnable(id, enabled) {
    try { await api.patch(`/scheduler/${id}`, { enabled: !enabled }); load(); }
    catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  async function runNow(id) {
    setRunning(r => ({ ...r, [id]: true }));
    try {
      await api.post(`/scheduler/${id}/run`);
      message.success('รัน task สำเร็จ');
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
    setRunning(r => ({ ...r, [id]: false }));
  }

  async function remove(id) {
    try { await api.delete(`/scheduler/${id}`); message.success('ลบสำเร็จ'); load(); }
    catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  const cols = [
    { title: 'เปิด/ปิด', width: 70, render: (_, r) => <Switch size="small" checked={r.enabled} onChange={() => toggleEnable(r.id, r.enabled)} /> },
    { title: 'ชื่อ Task', dataIndex: 'name' },
    { title: 'ประเภท', dataIndex: 'type', render: v => <Tag color={v === 'backup' ? 'blue' : 'orange'}>{v}</Tag> },
    { title: 'Cron', dataIndex: 'cron_expr', render: v => <code>{v}</code> },
    { title: 'รันล่าสุด', dataIndex: 'last_run', render: v => v ? new Date(v).toLocaleString('th-TH') : '-' },
    { title: 'Status', dataIndex: 'last_status', render: v => v ? <Tag color={v === 'success' ? 'green' : 'red'}>{v}</Tag> : '-' },
    {
      title: '', render: (_, r) => (
        <Space>
          <Tooltip title="รันทันที"><Button size="small" icon={<PlayCircleOutlined />} loading={!!running[r.id]} onClick={() => runNow(r.id)} /></Tooltip>
          <Popconfirm title="ลบ task?" onConfirm={() => remove(r.id)}>
            <Button danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>เพิ่ม Scheduled Task</Button>
      <Table dataSource={tasks} columns={cols} rowKey="id" loading={loading} size="small" />
      <Modal title={<><ClockCircleOutlined /> เพิ่ม Scheduled Task</>} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="ชื่อ Task" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="ประเภท" rules={[{ required: true }]}>
            <Select options={[{ value: 'backup', label: 'Backup' }, { value: 'reboot', label: 'Reboot Router' }]} />
          </Form.Item>
          <Form.Item label="เวลา">
            <Select options={CRON_PRESETS} value={cronPreset} onChange={v => { setCronPreset(v); if (v !== 'custom') form.setFieldValue('cron_expr', v); }} />
          </Form.Item>
          <Form.Item name="cron_expr" label="Cron Expression" rules={[{ required: true }]} extra="เช่น: 0 2 * * * = ทุกวัน 02:00">
            <Input placeholder="0 2 * * *" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
