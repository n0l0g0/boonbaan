import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Popconfirm, message, Tabs, Tag, Alert, Statistic, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined, EyeInvisibleOutlined, LinkOutlined, CopyOutlined, MailOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../services/api';
import PasswordChecklist from '../components/PasswordChecklist';
import { passwordIssues } from '../utils/passwordPolicy';

export default function Hotspot() {
  const [users, setUsers] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [resetInfo, setResetInfo] = useState(null); // { url, expiresAt, username }
  const [emailTarget, setEmailTarget] = useState(null); // hotspot user record
  const [sendingEmail, setSendingEmail] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('users');
  const [activeRefreshAt, setActiveRefreshAt] = useState(null);
  const [usersRefreshAt, setUsersRefreshAt] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [emailForm] = Form.useForm();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const newPassword = Form.useWatch('password', form);
  const editPassword = Form.useWatch('password', editForm);

  async function load() {
    setLoading(true);
    const [u, a] = await Promise.allSettled([api.get('/hotspot/users'), api.get('/hotspot/active')]);
    setUsers(u.value?.data || []);
    setActive(a.value?.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    api.get('/hotspot/profiles')
      .then(r => setProfiles(r.data || []))
      .catch(() => {});
  }, []);

  // Auto-refresh users list every 30s while the Users tab is open
  useEffect(() => {
    if (activeTab !== 'users') return;
    async function refreshUsers() {
      try {
        const r = await api.get('/hotspot/users');
        setUsers(r.data || []);
        setUsersRefreshAt(new Date());
      } catch { /* keep last data on error */ }
    }
    const id = setInterval(refreshUsers, 30_000);
    return () => clearInterval(id);
  }, [activeTab]);

  // Auto-refresh active sessions every 30s while the Active tab is open
  useEffect(() => {
    if (activeTab !== 'active') return;
    async function refreshActive() {
      try {
        const r = await api.get('/hotspot/active');
        setActive(r.data || []);
        setActiveRefreshAt(new Date());
      } catch { /* keep last data on error */ }
    }
    refreshActive();
    const id = setInterval(refreshActive, 30000);
    return () => clearInterval(id);
  }, [activeTab]);

  async function addUser(values) {
    const issues = passwordIssues(values.password || '');
    if (issues.length) {
      message.error('Password ไม่ผ่านเงื่อนไข: ' + issues.map(i => i.label).join(', '));
      return;
    }
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

  async function saveEdit(values) {
    const issues = passwordIssues(values.password || '');
    if (issues.length) {
      message.error('Password ไม่ผ่านเงื่อนไข: ' + issues.map(i => i.label).join(', '));
      return;
    }
    try {
      await api.patch(`/hotspot/users/${editTarget['.id']}`, { password: values.password });
      message.success('อัพเดท password สำเร็จ');
      setEditTarget(null);
      editForm.resetFields();
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

  function openEdit(record) {
    setEditTarget(record);
    editForm.setFieldsValue({ password: '' });
  }

  async function generateResetLink(record) {
    try {
      const r = await api.post(`/hotspot/users/${encodeURIComponent(record['.id'])}/reset-token`);
      const url = `${window.location.origin}/reset-hotspot/${r.data.token}`;
      setResetInfo({ url, expiresAt: r.data.expires_at, username: r.data.username });
    } catch (e) {
      message.error(e.response?.data?.error || 'สร้างลิงก์ไม่สำเร็จ');
    }
  }

  function openEmailReset(record) {
    const prefill = EMAIL_RE.test(record.comment || '') ? record.comment : '';
    emailForm.setFieldsValue({ email: prefill });
    setEmailTarget(record);
  }

  async function submitEmailReset(values) {
    if (!emailTarget) return;
    setSendingEmail(true);
    try {
      const r = await api.post(`/hotspot/users/${encodeURIComponent(emailTarget['.id'])}/send-reset-email`, { email: values.email });
      message.success(`ส่งลิงก์รีเซ็ตไปที่ ${r.data.email} แล้ว (อายุ 10 นาที)`);
      setEmailTarget(null);
      emailForm.resetFields();
    } catch (e) {
      message.error(e.response?.data?.error || 'ส่งอีเมลไม่สำเร็จ');
    }
    setSendingEmail(false);
  }

  async function copyResetLink() {
    if (!resetInfo) return;
    try {
      await navigator.clipboard.writeText(resetInfo.url);
      message.success('คัดลอกลิงก์แล้ว — ลิงก์มีอายุ 10 นาที กรุณาส่งให้ผู้ใช้ทำรายการก่อนหมดเวลา');
    } catch {
      message.error('คัดลอกไม่สำเร็จ');
    }
  }

  const BUILTIN_USERS = ['default', 'default-trial'];

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users
      .filter(u => !BUILTIN_USERS.includes(u.name))
      .filter(u => !q || (u.name || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }));
  }, [users, search]);

  const userCols = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Password',
      dataIndex: 'password',
      render: (v, r) => {
        if (!v) return <span style={{ color: '#bfbfbf' }}>-</span>;
        const show = revealed[r['.id']];
        return (
          <Space size={4}>
            <span style={{ fontFamily: 'monospace' }}>{show ? v : '••••••••'}</span>
            <Button
              type="text"
              size="small"
              icon={show ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setRevealed(s => ({ ...s, [r['.id']]: !s[r['.id']] }))}
            />
          </Space>
        );
      },
    },
    { title: 'Profile', dataIndex: 'profile' },
    { title: 'Comment', dataIndex: 'comment' },
    { title: 'Disabled', dataIndex: 'disabled', render: v => <Tag color={v === 'true' ? 'red' : 'green'}>{v === 'true' ? 'Yes' : 'No'}</Tag> },
    {
      title: 'Action',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="แก้ไข password (admin)"><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} /></Tooltip>
          <Tooltip title="สร้างลิงก์ให้ user รีเซ็ตรหัสเอง (อายุ 10 นาที)">
            <Button size="small" icon={<LinkOutlined />} onClick={() => generateResetLink(r)} />
          </Tooltip>
          <Tooltip title="ส่งอีเมลพร้อมลิงก์รีเซ็ต (อายุ 10 นาที)">
            <Button size="small" icon={<MailOutlined />} onClick={() => openEmailReset(r)} />
          </Tooltip>
          <Popconfirm title="ลบ user?" onConfirm={() => removeUser(r['.id'])}>
            <Button danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
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
          <Space style={{ marginBottom: 16 }} wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              เพิ่ม User
            </Button>
            <Tooltip title="โหลดข้อมูลใหม่จาก MikroTik">
              <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>รีเฟรช</Button>
            </Tooltip>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาตามชื่อ user"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 260 }}
            />
            <span style={{ color: '#888' }}>ทั้งหมด {filteredUsers.length} รายการ</span>
            <span style={{ color: '#bbb', fontSize: 12 }}>
              อัพเดตอัตโนมัติทุก 30 วินาที{usersRefreshAt ? ` — ล่าสุด ${usersRefreshAt.toLocaleTimeString()}` : ''}
            </span>
          </Space>
          <Table
            dataSource={filteredUsers}
            columns={userCols}
            rowKey=".id"
            loading={loading}
            size="small"
            pagination={{
              defaultPageSize: 10,
              pageSizeOptions: ['10', '20', '30', '50'],
              showSizeChanger: true,
              showTotal: (total, range) => `${range[0]}-${range[1]} จาก ${total} รายการ`,
            }}
          />
        </>
      ),
    },
    {
      key: 'active',
      label: `Active (${active.length})`,
      children: (
        <>
          <Space style={{ marginBottom: 12 }}>
            <span style={{ color: '#888' }}>
              อัพเดตอัตโนมัติทุก 30 วินาที{activeRefreshAt ? ` — ล่าสุด ${activeRefreshAt.toLocaleTimeString()}` : ''}
            </span>
          </Space>
          <Table dataSource={active} columns={activeCols} rowKey=".id" loading={loading} size="small" />
        </>
      ),
    },
  ];

  return (
    <>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />
      <Modal title="เพิ่ม Hotspot User" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="บันทึก">
        <Form form={form} layout="vertical" onFinish={addUser}>
          <Form.Item name="name" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'กรุณากรอก password' }]}>
            <Input.Password />
          </Form.Item>
          <PasswordChecklist value={newPassword || ''} />
          <Form.Item name="profile" label="Profile" initialValue="default" style={{ marginTop: 12 }}>
            <Select
              options={profiles.map(p => ({ value: p.name, label: p.name }))}
              placeholder="เลือก Profile"
              showSearch
            />
          </Form.Item>
          <Form.Item name="comment" label="Comment">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={resetInfo ? `ลิงก์รีเซ็ตรหัสของ ${resetInfo.username}` : 'ลิงก์รีเซ็ตรหัส'}
        open={!!resetInfo}
        onCancel={() => setResetInfo(null)}
        footer={<Button onClick={() => setResetInfo(null)}>ปิด</Button>}
        destroyOnClose
      >
        {resetInfo && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <span>
                  ลิงก์มีอายุ 10 นาที กรุณาทำรายการให้เสร็จก่อนหมดเวลา — เหลือเวลา{' '}
                  <Statistic.Countdown
                    value={new Date(resetInfo.expiresAt).getTime()}
                    format="mm:ss"
                    valueStyle={{ fontSize: 14, display: 'inline' }}
                    onFinish={() => setResetInfo(null)}
                  />
                </span>
              }
            />
            <Input.Group compact>
              <Input value={resetInfo.url} readOnly style={{ width: 'calc(100% - 110px)' }} />
              <Button type="primary" icon={<CopyOutlined />} onClick={copyResetLink} style={{ width: 110 }}>คัดลอก</Button>
            </Input.Group>
          </>
        )}
      </Modal>
      <Modal
        title={emailTarget ? `ส่งอีเมลรีเซ็ตรหัส: ${emailTarget.name}` : 'ส่งอีเมลรีเซ็ตรหัส'}
        open={!!emailTarget}
        onCancel={() => { setEmailTarget(null); emailForm.resetFields(); }}
        onOk={() => emailForm.submit()}
        okText="ส่งอีเมล"
        confirmLoading={sendingEmail}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="ระบบจะสร้างลิงก์รีเซ็ตรหัสผ่าน (อายุ 10 นาที) และส่งไปยังอีเมลที่ระบุผ่าน SMTP"
        />
        <Form form={emailForm} layout="vertical" onFinish={submitEmailReset}>
          <Form.Item
            name="email"
            label="อีเมลผู้รับ"
            rules={[
              { required: true, message: 'กรุณากรอกอีเมล' },
              { type: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง' },
            ]}
          >
            <Input placeholder="user@example.com" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={editTarget ? `แก้ไข Password: ${editTarget.name}` : 'แก้ไข Password'}
        open={!!editTarget}
        onCancel={() => { setEditTarget(null); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        okText="บันทึก"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={saveEdit}>
          <Form.Item name="password" label="Password ใหม่" rules={[{ required: true, message: 'กรุณากรอก password' }]}>
            <Input.Password autoFocus />
          </Form.Item>
          <PasswordChecklist value={editPassword || ''} />
        </Form>
      </Modal>
    </>
  );
}
