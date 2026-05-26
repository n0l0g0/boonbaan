import { useEffect, useState } from 'react';
import { Table, Tag, Input, Select, DatePicker, Space, Button, Tooltip, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../services/api';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const SERVICE_OPTS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'vpn', label: 'VPN' },
];

const ACTION_OPTS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'admin_changed_password', label: 'Admin เปลี่ยนรหัส' },
  { value: 'reset_link_generated', label: 'สร้างลิงก์รีเซ็ต' },
  { value: 'reset_email_sent', label: 'ส่งอีเมลรีเซ็ต' },
  { value: 'user_reset_via_link', label: 'User รีเซ็ตผ่านลิงก์' },
];

const ACTION_LABEL = Object.fromEntries(ACTION_OPTS.filter(o => o.value).map(o => [o.value, o.label]));
const ACTION_COLOR = {
  admin_changed_password: 'blue',
  reset_link_generated: 'cyan',
  reset_email_sent: 'geekblue',
  user_reset_via_link: 'green',
};

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    service: '', action: '', target: '', actor: '', status: '', range: null,
  });

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.service) params.service = filters.service;
      if (filters.action) params.action = filters.action;
      if (filters.target.trim()) params.target = filters.target.trim();
      if (filters.actor.trim()) params.actor = filters.actor.trim();
      if (filters.status) params.status = filters.status;
      if (filters.range?.[0]) params.since = filters.range[0].toISOString();
      if (filters.range?.[1]) params.until = filters.range[1].toISOString();
      const r = await api.get('/audit/password', { params });
      setRows(r.data.rows || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const cols = [
    {
      title: 'เวลา',
      dataIndex: 'created_at',
      width: 170,
      render: v => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
      sorter: (a, b) => new Date(a.created_at) - new Date(b.created_at),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Service', dataIndex: 'service', width: 90,
      render: v => <Tag color={v === 'vpn' ? 'purple' : 'blue'}>{v?.toUpperCase()}</Tag>,
    },
    {
      title: 'Action', dataIndex: 'action', width: 200,
      render: v => <Tag color={ACTION_COLOR[v] || 'default'}>{ACTION_LABEL[v] || v}</Tag>,
    },
    { title: 'Target user', dataIndex: 'target_username', width: 150, render: v => <Text strong>{v}</Text> },
    { title: 'Actor', dataIndex: 'actor_username', width: 130, render: v => v || <Text type="secondary">(public)</Text> },
    { title: 'IP', dataIndex: 'actor_ip', width: 140 },
    {
      title: 'Status', dataIndex: 'status', width: 90,
      render: v => v === 'success'
        ? <Tag color="green">success</Tag>
        : <Tag color="red">{v}</Tag>,
    },
    {
      title: 'Details', dataIndex: 'details',
      render: v => {
        if (!v) return '-';
        if (v.email) return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>→ {v.email}</span>;
        return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{JSON.stringify(v)}</span>;
      },
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          value={filters.service}
          onChange={v => setFilters(f => ({ ...f, service: v }))}
          options={SERVICE_OPTS}
          style={{ width: 140 }}
        />
        <Select
          value={filters.action}
          onChange={v => setFilters(f => ({ ...f, action: v }))}
          options={ACTION_OPTS}
          style={{ width: 220 }}
        />
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder="target user"
          value={filters.target}
          onChange={e => setFilters(f => ({ ...f, target: e.target.value }))}
          onPressEnter={load}
          style={{ width: 180 }}
        />
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder="actor (admin)"
          value={filters.actor}
          onChange={e => setFilters(f => ({ ...f, actor: e.target.value }))}
          onPressEnter={load}
          style={{ width: 180 }}
        />
        <RangePicker
          showTime
          value={filters.range}
          onChange={v => setFilters(f => ({ ...f, range: v }))}
        />
        <Tooltip title="ใช้ filter">
          <Button type="primary" icon={<SearchOutlined />} onClick={load}>ค้นหา</Button>
        </Tooltip>
        <Tooltip title="โหลดใหม่">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Tooltip>
        <span style={{ color: '#888' }}>ทั้งหมด {rows.length} รายการ (จำกัด 200 รายการล่าสุด)</span>
      </Space>
      <Table
        dataSource={rows}
        columns={cols}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: ['10', '20', '30', '50', '100'],
          showSizeChanger: true,
          showTotal: (t, r) => `${r[0]}-${r[1]} จาก ${t} รายการ`,
        }}
      />
    </>
  );
}
