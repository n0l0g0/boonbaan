import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Popconfirm, message, Tabs, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function Hotspot() {
  const [users, setUsers] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [u, a] = await Promise.allSettled([api.get('/hotspot/users'), api.get('/hotspot/active')]);
    setUsers(u.value?.data || []);
    setActive(a.value?.data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addUser(values) {
    try {
      await api.post('/hotspot/users', values);
      message.success('เพิ่ม user สำเร็จ');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function removeUser(id) {
    try {
      await api.delete(`/hotspot/users/${id}`);
      message.success('ลบ user สำเร็จ');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  const userCols = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Password', dataIndex: 'password' },
    { title: 'Profile', dataIndex: 'profile' },
    { title: 'Comment', dataIndex: 'comment' },
    { title: 'Disabled', dataIndex: 'disabled', render: v => <Tag color={v === 'true' ? 'red' : 'green'}>{v === 'true' ? 'Yes' : 'No'}</Tag> },
    {
      title: 'Action',
      render: (_, r) => (
        <Popconfirm title="ลบ user?" onConfirm={() => removeUser(r['.id'])}>
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const activeCols = [
    { title: 'User', dataIndex: 'user' },
    { title: 'IP', dataIndex: 'address' },
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'Uptime', dataIndex: 'uptime' },
    { title: 'Bytes In', dataIndex: 'bytes-in', render: v => v ? `${(v/1024/1024).toFixed(2)} MB` : '-' },
    { title: 'Bytes Out', dataIndex: 'bytes-out', render: v => v ? `${(v/1024/1024).toFixed(2)} MB` : '-' },
  ];

  const items = [
    {
      key: 'users',
      label: 'Users',
      children: (
        <>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>
            เพิ่ม User
          </Button>
          <Table dataSource={users} columns={userCols} rowKey=".id" loading={loading} size="small" />
        </>
      ),
    },
    {
      key: 'active',
      label: `Active (${active.length})`,
      children: <Table dataSource={active} columns={activeCols} rowKey=".id" loading={loading} size="small" />,
    },
  ];

  return (
    <>
      <Tabs items={items} />
      <Modal title="เพิ่ม Hotspot User" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addUser}>
          <Form.Item name="name" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password">
            <Input.Password />
          </Form.Item>
          <Form.Item name="profile" label="Profile" initialValue="default">
            <Input />
          </Form.Item>
          <Form.Item name="comment" label="Comment">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
