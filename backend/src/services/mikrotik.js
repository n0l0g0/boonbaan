const { getMikrotikClient } = require('../config/mikrotik');

const mk = () => getMikrotikClient.fromDB();

const mikrotik = {
  // System
  getResource: () => mk().then(c => c.get('/system/resource')).then(r => r.data),
  getIdentity: () => mk().then(c => c.get('/system/identity')).then(r => r.data),
  getRouterboard: () => mk().then(c => c.get('/system/routerboard')).then(r => r.data),

  // Interfaces
  getInterfaces: () => mk().then(c => c.get('/interface')).then(r => r.data),
  getInterfaceStats: (name) => mk().then(c => c.get(`/interface/monitor-traffic?interface=${name}&once=`)).then(r => r.data),

  // IP
  getArp: () => mk().then(c => c.get('/ip/arp')).then(r => r.data),
  getAddresses: () => mk().then(c => c.get('/ip/address')).then(r => r.data),
  getDhcpLeases: () => mk().then(c => c.get('/ip/dhcp-server/lease')).then(r => r.data),

  // MAC Binding
  getMacBindings: () => mk().then(c => c.get('/ip/hotspot/host')).then(r => r.data),
  addMacBinding: (data) => mk().then(c => c.put('/ip/hotspot/host', data)).then(r => r.data),
  removeMacBinding: (id) => mk().then(c => c.delete(`/ip/hotspot/host/${id}`)).then(r => r.data),

  // VLAN
  getVlans: () => mk().then(c => c.get('/interface/vlan')).then(r => r.data),
  addVlan: (data) => mk().then(c => c.put('/interface/vlan', data)).then(r => r.data),
  updateVlan: (id, data) => mk().then(c => c.patch(`/interface/vlan/${id}`, data)).then(r => r.data),
  removeVlan: (id) => mk().then(c => c.delete(`/interface/vlan/${id}`)).then(r => r.data),

  // Web Filter (Proxy Access Rules)
  getProxyRules: () => mk().then(c => c.get('/ip/proxy/access')).then(r => r.data),
  addProxyRule: (data) => mk().then(c => c.put('/ip/proxy/access', data)).then(r => r.data),
  updateProxyRule: (id, data) => mk().then(c => c.patch(`/ip/proxy/access/${id}`, data)).then(r => r.data),
  removeProxyRule: (id) => mk().then(c => c.delete(`/ip/proxy/access/${id}`)).then(r => r.data),
  getProxySettings: () => mk().then(c => c.get('/ip/proxy')).then(r => r.data),

  // VPN (PPP)
  getPppSecrets: () => mk().then(c => c.get('/ppp/secret')).then(r => r.data),
  addPppSecret: (data) => mk().then(c => c.put('/ppp/secret', data)).then(r => r.data),
  updatePppSecret: (id, data) => mk().then(c => c.patch(`/ppp/secret/${id}`, data)).then(r => r.data),
  removePppSecret: (id) => mk().then(c => c.delete(`/ppp/secret/${id}`)).then(r => r.data),
  getPppActive: () => mk().then(c => c.get('/ppp/active')).then(r => r.data),
  removePppActive: (id) => mk().then(c => c.delete(`/ppp/active/${id}`)).then(r => r.data),
  kickPppByUser: async (username) => {
    const c = await mk();
    const list = await c.get('/ppp/active').then(r => r.data);
    const sessions = list.filter(s => s.name === username);
    await Promise.all(sessions.map(s => c.delete(`/ppp/active/${s['.id']}`).catch(() => {})));
    return sessions.length;
  },
  getL2tpServer: () => mk().then(c => c.get('/interface/l2tp-server/server')).then(r => r.data),
  getPptpServer: () => mk().then(c => c.get('/interface/pptp-server/server')).then(r => r.data),

  // Hotspot
  getHotspotUsers: () => mk().then(c => c.get('/ip/hotspot/user')).then(r => r.data),
  addHotspotUser: (data) => mk().then(c => c.put('/ip/hotspot/user', data)).then(r => r.data),
  updateHotspotUser: (id, data) => mk().then(c => c.patch(`/ip/hotspot/user/${id}`, data)).then(r => r.data),
  removeHotspotUser: (id) => mk().then(c => c.delete(`/ip/hotspot/user/${id}`)).then(r => r.data),
  getHotspotActive: () => mk().then(c => c.get('/ip/hotspot/active')).then(r => r.data),
  removeHotspotActive: (id) => mk().then(c => c.delete(`/ip/hotspot/active/${id}`)).then(r => r.data),
  kickHotspotByUser: async (username) => {
    const c = await mk();
    const list = await c.get('/ip/hotspot/active').then(r => r.data);
    const sessions = list.filter(s => s.user === username);
    await Promise.all(sessions.map(s => c.delete(`/ip/hotspot/active/${s['.id']}`).catch(() => {})));
    return sessions.length;
  },

  // Logs
  getLogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return mk().then(c => c.get(`/log${query ? '?' + query : ''}`)).then(r => r.data);
  },

  // Backup
  saveBackup: (name) => mk().then(c => c.post('/system/backup/save', { name })).then(r => r.data),
  listBackups: () => mk().then(c => c.get('/file')).then(r => r.data.filter(f => f.name.endsWith('.backup'))),
  getFile: (name) => mk().then(c => c.get(`/file/${name}`, { responseType: 'arraybuffer' })).then(r => r.data),
  removeFile: (id) => mk().then(c => c.delete(`/file/${id}`)).then(r => r.data),

  // Config export
  exportConfig: () => mk().then(c => c.post('/export', {})).then(r => r.data),

  // AP (CAPsMAN)
  getCapsmanRegistrations: () => mk().then(c => c.get('/caps-man/registration-table')).then(r => r.data),
  getCapsmanAps: () => mk().then(c => c.get('/caps-man/access-point')).then(r => r.data).catch(() => []),

  // Firewall (for monitoring blacklist hits)
  getFirewallRules: () => mk().then(c => c.get('/ip/firewall/filter')).then(r => r.data),

  // Address lists (used by brute-force auto-block)
  getAddressList: (listName) => mk().then(c =>
    c.get(`/ip/firewall/address-list${listName ? `?list=${encodeURIComponent(listName)}` : ''}`)
     .then(r => r.data)),
  addAddressListEntry: (data) => mk().then(c => c.put('/ip/firewall/address-list', data)).then(r => r.data),
  removeAddressListEntry: (id) => mk().then(c => c.delete(`/ip/firewall/address-list/${id}`)).then(r => r.data),
};

module.exports = mikrotik;
