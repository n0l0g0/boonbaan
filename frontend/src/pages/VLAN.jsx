import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, message, Popconfirm, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function VLAN() {
  const [vlans, setVlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try { setVlans((await api.get('/vlan')).data); } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addVlan(values) {
    try {
      await api.post('/vlan', { ...values, 'vlan-id': String(values['vlan-id']) });
      message.success('เพิ่ม VLAN สำเร็จ');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/vlan/${id}`);
      message.success('ลบ VLAN สำเร็จ');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  const cols = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'VLAN ID', dataIndex: 'vlan-id' },
    { title: 'Interface', dataIndex: 'interface' },
    { title: 'Running', dataIndex: 'running', render: v => <Tag color={v === 'true' ? 'green' : 'red'}>{v === 'true' ? 'Yes' : 'No'}</Tag> },
    { title: 'Comment', dataIndex: 'comment' },
    {
      title: 'Action', render: (_, r) => (
        <Popconfirm title="ลบ VLAN?" onConfirm={() => remove(r['.id'])}>
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>
        เพิ่ม VLAN
      </Button>
      <Table dataSource={vlans} columns={cols} rowKey=".id" loading={loading} size="small" />
      <Modal title="เพิ่ม VLAN" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addVlan}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="vlan-id" label="VLAN ID" rules={[{ required: true }]}>
            <InputNumber min={1} max={4094} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="interface" label="Interface" rules={[{ required: true }]}><Input placeholder="ether1" /></Form.Item>
          <Form.Item name="comment" label="Comment"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
