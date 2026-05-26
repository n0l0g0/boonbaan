import { useEffect, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, theme, Switch, Tooltip, Input, Badge, Typography } from 'antd';
import {
  DashboardOutlined, WifiOutlined, BranchesOutlined, FilterOutlined,
  LockOutlined, SaveOutlined, SettingOutlined, FileTextOutlined,
  MonitorOutlined, ApartmentOutlined, UserOutlined, LogoutOutlined,
  TeamOutlined, ScanOutlined, ClockCircleOutlined,
  FileExcelOutlined, BulbOutlined, ClusterOutlined, MobileOutlined,
  KeyOutlined, SafetyCertificateOutlined, BellOutlined, SearchOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import ChangePasswordModal from '../ChangePasswordModal';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  {
    key: 'network-group',
    icon: <ClusterOutlined />,
    label: 'Network',
    children: [
      { key: '/hotspot', icon: <WifiOutlined />, label: 'Hotspot Users' },
      { key: '/mac', icon: <ApartmentOutlined />, label: 'MAC Binding' },
      { key: '/vlan', icon: <BranchesOutlined />, label: 'VLAN' },
      { key: '/vpn', icon: <LockOutlined />, label: 'VPN' },
      { key: '/ap', icon: <WifiOutlined />, label: 'Access Points' },
      { key: '/network-scan', icon: <ScanOutlined />, label: 'Network Scan' },
      { key: '/devices', icon: <MobileOutlined />, label: 'Devices' },
    ],
  },
  { key: '/webfilter', icon: <FilterOutlined />, label: 'Web Filter' },
  { key: '/monitor', icon: <MonitorOutlined />, label: 'Monitor' },
  {
    key: 'manage-group',
    icon: <SettingOutlined />,
    label: 'Management',
    children: [
      { key: '/backup', icon: <SaveOutlined />, label: 'Backup' },
      { key: '/config', icon: <SettingOutlined />, label: 'Config' },
      { key: '/scheduler', icon: <ClockCircleOutlined />, label: 'Scheduler' },
      { key: '/logs', icon: <FileTextOutlined />, label: 'Logs' },
      { key: '/report', icon: <FileExcelOutlined />, label: 'Monthly Report' },
    ],
  },
  {
    key: 'system-group',
    icon: <TeamOutlined />,
    label: 'System',
    children: [
      { key: '/users', icon: <TeamOutlined />, label: 'Users' },
      { key: '/audit-password', icon: <KeyOutlined />, label: 'Password Audit' },
      { key: '/bruteforce', icon: <SafetyCertificateOutlined />, label: 'Brute-Force Block' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
    ],
  },
];

// Build a flat lookup of path → label for the page-title header
const PATH_TITLES = (() => {
  const out = { '/': 'Dashboard' };
  function walk(items) {
    for (const it of items) {
      if (it.children) walk(it.children);
      else if (it.key) out[it.key] = it.label;
    }
  }
  walk(menuItems);
  return out;
})();

export default function AppLayout({ darkMode, onToggleDark }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();

  const username = localStorage.getItem('username') || 'Admin';
  const [pwOpen, setPwOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [alertCount, setAlertCount] = useState(0);

  // Poll alert count (critical + high in last 24h) for the bell badge
  useEffect(() => {
    async function load() {
      try {
        const r = await api.get('/dashboard/security-pulse?hours=24');
        setAlertCount((r.data?.critical || 0) + (r.data?.high || 0));
      } catch { /* ignore */ }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  function onSearch(value) {
    const q = (value || '').trim().toLowerCase();
    if (!q) return;
    // Simple fuzzy match across known pages
    const hit = Object.entries(PATH_TITLES).find(([, label]) => label.toLowerCase().includes(q));
    if (hit) { navigate(hit[0]); setSearch(''); }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    navigate('/login');
  }

  const userMenu = {
    items: [
      { key: 'change-password', icon: <KeyOutlined />, label: 'เปลี่ยนรหัสผ่าน', onClick: () => setPwOpen(true) },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: logout },
    ],
  };

  // Find which group key to open based on current path
  const openKeys = menuItems
    .filter(m => m.children?.some(c => c.key === pathname))
    .map(m => m.key);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220} breakpoint="lg" collapsedWidth={0}>
        <div style={{ padding: '14px 16px', color: '#fff', fontWeight: 700, fontSize: 16, borderBottom: '1px solid #333', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo-192.png" alt="บุญบ้าน" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
          <div>
            <div>บุญบ้าน</div>
            <div style={{ fontSize: 11, fontWeight: 400, color: '#aaa', letterSpacing: 0.5 }}>Boonbaan</div>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={({ key }) => { if (!key.endsWith('-group')) navigate(key); }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: token.colorBgContainer, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Typography.Title level={4} style={{ margin: 0, flex: '0 0 auto' }}>
            {PATH_TITLES[pathname] || ''}
          </Typography.Title>
          <Input
            placeholder="ค้นหาเมนู..."
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={e => onSearch(e.target.value)}
            style={{ maxWidth: 280, marginLeft: 12 }}
          />
          <div style={{ flex: 1 }} />
          <Tooltip title={darkMode ? 'Light mode' : 'Dark mode'}>
            <Switch
              checked={darkMode}
              onChange={onToggleDark}
              checkedChildren={<BulbOutlined />}
              unCheckedChildren={<BulbOutlined />}
            />
          </Tooltip>
          <Tooltip title={alertCount > 0 ? `${alertCount} security events (24h) — คลิกดูรายละเอียด` : 'ไม่มีเหตุการณ์อันตราย (24h)'}>
            <Badge count={alertCount} size="small" offset={[-2, 2]}>
              <BellOutlined
                style={{ fontSize: 18, cursor: 'pointer', color: alertCount > 0 ? '#ff4d4f' : token.colorTextSecondary }}
                onClick={() => navigate('/logs')}
              />
            </Badge>
          </Tooltip>
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} />
              <span>{username}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, background: token.colorBgContainer, borderRadius: token.borderRadius, padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </Layout>
  );
}
