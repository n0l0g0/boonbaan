import { useEffect, useState } from 'react';
import { Tabs, Table, Card, Descriptions, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import api from '../services/api';

export default function Config() {
  const [interfaces, setInterfaces] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [leases, setLeases] = useState([]);
  const [routerboard, setRouterboard] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [ifaces, addrs, dhcp, rb] = await Promise.allSettled([
      api.get('/config/interfaces'),
      api.get('/config/addresses'),
      api.get('/config/dhcp-leases'),
      api.get('/config/routerboard'),
    ]);
    setInterfaces(ifaces.value?.data || []);
    setAddresses(addrs.value?.data || []);
    setLeases(dhcp.value?.data || []);
    setRouterboard(rb.value?.data || null);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const ifaceCols = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'type' },
    { title: 'MTU', dataIndex: 'mtu' },
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'Running', dataIndex: 'running', render: v => v === 'true' ? '✅' : '❌' },
    { title: 'TX/RX Bytes', render: (_, r) => `${r['tx-byte'] || 0} / ${r['rx-byte'] || 0}` },
  ];

  const addrCols = [
    { title: 'Address', dataIndex: 'address' },
    { title: 'Network', dataIndex: 'network' },
    { title: 'Interface', dataIndex: 'interface' },
  ];

  const leaseCols = [
    { title: 'IP', dataIndex: 'address' },
    { title: 'MAC', dataIndex: 'mac-address' },
    { title: 'Hostname', dataIndex: 'host-name' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Expires', dataIndex: 'expires-after' },
  ];

  const items = [
    {
      key: 'routerboard', label: 'Routerboard',
      children: routerboard ? (
        <Descriptions bordered size="small" column={2}>
          {Object.entries(routerboard).map(([k, v]) => (
            <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
          ))}
        </Descriptions>
      ) : '-',
    },
    { key: 'interfaces', label: `Interfaces (${interfaces.length})`, children: <Table dataSource={interfaces} columns={ifaceCols} rowKey=".id" loading={loading} size="small" /> },
    { key: 'addresses', label: `IP Addresses (${addresses.length})`, children: <Table dataSource={addresses} columns={addrCols} rowKey=".id" loading={loading} size="small" /> },
    { key: 'dhcp', label: `DHCP Leases (${leases.length})`, children: <Table dataSource={leases} columns={leaseCols} rowKey=".id" loading={loading} size="small" /> },
  ];

  return (
    <>
      <Button icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ marginBottom: 16 }}>Refresh</Button>
      <Tabs items={items} />
    </>
  );
}
