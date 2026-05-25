import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Tabs } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function MAC() {
  const [bindings, setBindings] = useState([]);
  const [arp, setArp] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/mac');
      setBindings(r.data.bindings || []);
      setArp(r.data.arp || []);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addBinding(values) {
    try {
      await api.post('/mac', values);
      message.success('เพิ่ม MAC Binding สำเร็จ');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/mac/${id}`);
      message.success('ลบ MAC Binding สำเร็จ');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  const bindingCols = [
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'IP', dataIndex: 'address' },
    { title: 'Server', dataIndex: 'server' },
    { title: 'Comment', dataIndex: 'comment' },
    {
      title: 'Action', render: (_, r) => (
        <Popconfirm title="ลบ?" onConfirm={() => remove(r['.id'])}>
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const arpCols = [
    { title: 'IP', dataIndex: 'address' },
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'Interface', dataIndex: 'interface' },
    { title: 'Status', dataIndex: 'status' },
  ];

  const items = [
    {
      key: 'bindings', label: 'MAC Bindings',
      children: (
        <>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>
            เพิ่ม Binding
          </Button>
          <Table dataSource={bindings} columns={bindingCols} rowKey=".id" loading={loading} size="small" />
        </>
      ),
    },
    {
      key: 'arp', label: 'ARP Table',
      children: <Table dataSource={arp} columns={arpCols} rowKey=".id" loading={loading} size="small" />,
    },
  ];

  return (
    <>
      <Tabs items={items} />
      <Modal title="เพิ่ม MAC Binding" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addBinding}>
          <Form.Item name="mac-address" label="MAC Address" rules={[{ required: true, pattern: /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, message: 'รูปแบบ MAC ไม่ถูกต้อง' }]}>
            <Input placeholder="AA:BB:CC:DD:EE:FF" />
          </Form.Item>
          <Form.Item name="address" label="IP Address">
            <Input placeholder="192.168.88.100" />
          </Form.Item>
          <Form.Item name="comment" label="Comment">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
