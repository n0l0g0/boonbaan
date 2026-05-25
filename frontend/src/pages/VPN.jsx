import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, message, Popconfirm, Tabs, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function VPN() {
  const [secrets, setSecrets] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [s, a] = await Promise.allSettled([api.get('/vpn/secrets'), api.get('/vpn/active')]);
    setSecrets(s.value?.data || []);
    setActive(a.value?.data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addSecret(values) {
    try {
      await api.post('/vpn/secrets', values);
      message.success('เพิ่ม VPN user สำเร็จ');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/vpn/secrets/${id}`);
      message.success('ลบสำเร็จ');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  const secretCols = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Service', dataIndex: 'service', render: v => <Tag>{v}</Tag> },
    { title: 'Local Address', dataIndex: 'local-address' },
    { title: 'Remote Address', dataIndex: 'remote-address' },
    { title: 'Profile', dataIndex: 'profile' },
    { title: 'Comment', dataIndex: 'comment' },
    {
      title: 'Action', render: (_, r) => (
        <Popconfirm title="ลบ?" onConfirm={() => remove(r['.id'])}>
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const activeCols = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Service', dataIndex: 'service' },
    { title: 'Caller ID', dataIndex: 'caller-id' },
    { title: 'Address', dataIndex: 'address' },
    { title: 'Uptime', dataIndex: 'uptime' },
  ];

  const items = [
    {
      key: 'secrets', label: 'VPN Users',
      children: (
        <>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>
            เพิ่ม VPN User
          </Button>
          <Table dataSource={secrets} columns={secretCols} rowKey=".id" loading={loading} size="small" />
        </>
      ),
    },
    {
      key: 'active', label: `Active (${active.length})`,
      children: <Table dataSource={active} columns={activeCols} rowKey=".id" loading={loading} size="small" />,
    },
  ];

  return (
    <>
      <Tabs items={items} />
      <Modal title="เพิ่ม VPN User" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addSecret}>
          <Form.Item name="name" label="Username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item name="service" label="Service" initialValue="l2tp">
            <Select options={[{ value: 'l2tp', label: 'L2TP' }, { value: 'pptp', label: 'PPTP' }, { value: 'any', label: 'Any' }]} />
          </Form.Item>
          <Form.Item name="local-address" label="Local IP"><Input placeholder="10.0.0.1" /></Form.Item>
          <Form.Item name="remote-address" label="Remote IP Pool / IP"><Input placeholder="10.0.0.0/24" /></Form.Item>
          <Form.Item name="comment" label="Comment"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
