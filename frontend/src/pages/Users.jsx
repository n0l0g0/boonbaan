import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, message, Popconfirm, Tag, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, UserOutlined } from '@ant-design/icons';
import api from '../services/api';
import PasswordChecklist from '../components/PasswordChecklist';
import { passwordIssues } from '../utils/passwordPolicy';

function passwordValidator(required) {
  return (_, value) => {
    if (!value) {
      return required
        ? Promise.reject(new Error('กรุณากรอกรหัสผ่าน'))
        : Promise.resolve();
    }
    const missing = passwordIssues(value);
    if (missing.length) return Promise.reject(new Error(`ยังขาด: ${missing.map(m => m.label).join(', ')}`));
    return Promise.resolve();
  };
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const pwValue = Form.useWatch('password', form) || '';
  const myUsername = localStorage.getItem('username');

  async function load() {
    setLoading(true);
    try { setUsers((await api.get('/users')).data); } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); form.resetFields(); setModalOpen(true); }
  function openEdit(u) { setEditing(u); form.setFieldsValue({ role: u.role }); setModalOpen(true); }

  async function submit(values) {
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, values);
        message.success('อัปเดตสำเร็จ');
      } else {
        await api.post('/users', values);
        message.success('เพิ่ม user สำเร็จ');
      }
      setModalOpen(false);
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  async function remove(id) {
    try { await api.delete(`/users/${id}`); message.success('ลบสำเร็จ'); load(); }
    catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  const cols = [
    { title: 'Username', dataIndex: 'username', render: (v, r) => <><UserOutlined /> {v} {v === myUsername && <Tag color="blue">คุณ</Tag>}</> },
    { title: 'Role', dataIndex: 'role', render: v => <Tag color={v === 'admin' ? 'red' : 'default'}>{v}</Tag> },
    { title: 'Last Login', dataIndex: 'last_login', render: v => v ? new Date(v).toLocaleString('th-TH') : '-' },
    { title: 'สร้างเมื่อ', dataIndex: 'created_at', render: v => new Date(v).toLocaleString('th-TH') },
    {
      title: '', render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="ลบ user?" onConfirm={() => remove(r.id)} disabled={r.username === myUsername}>
            <Button danger size="small" icon={<DeleteOutlined />} disabled={r.username === myUsername} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ marginBottom: 16 }}>เพิ่ม User</Button>
      <Table dataSource={users} columns={cols} rowKey="id" loading={loading} size="small" />
      <Modal
        title={editing ? 'แก้ไข User' : 'เพิ่ม User'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="บันทึก"
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          {!editing && <>
            <Form.Item name="username" label="Username" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item
              name="password"
              label="Password"
              validateFirst
              rules={[{ validator: passwordValidator(true) }]}
            >
              <Input.Password placeholder="อย่างน้อย 8 ตัว, ใหญ่/เล็ก/เลข/อักษรพิเศษ" />
            </Form.Item>
            <PasswordChecklist value={pwValue} />
          </>}
          {editing && <>
            <Form.Item
              name="password"
              label="Password ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
              validateFirst
              rules={[{ validator: passwordValidator(false) }]}
            >
              <Input.Password placeholder="ตั้งใหม่ตามนโยบายด้านล่าง หรือเว้นว่างเพื่อไม่เปลี่ยน" />
            </Form.Item>
            {pwValue && <PasswordChecklist value={pwValue} />}
          </>}
          <Form.Item name="role" label="Role" initialValue="viewer">
            <Select options={[{ value: 'admin', label: 'Admin (แก้ไขได้ทุกอย่าง)' }, { value: 'viewer', label: 'Viewer (ดูอย่างเดียว)' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
