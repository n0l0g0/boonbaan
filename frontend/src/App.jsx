import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme as antTheme } from 'antd';
import { useState } from 'react';
import thTH from 'antd/locale/th_TH';
import { GoogleOAuthProvider } from '@react-oauth/google';

import AppLayout from './components/Layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Hotspot from './pages/Hotspot';
import MAC from './pages/MAC';
import VLAN from './pages/VLAN';
import WebFilter from './pages/WebFilter';
import VPN from './pages/VPN';
import AP from './pages/AP';
import Monitor from './pages/Monitor';
import Backup from './pages/Backup';
import Config from './pages/Config';
import Logs from './pages/Logs';
import Users from './pages/Users';
import NetworkScan from './pages/NetworkScan';
import Scheduler from './pages/Scheduler';
import Report from './pages/Report';
import Settings from './pages/Settings';
import Devices from './pages/Devices';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  function toggleDark() {
    setDarkMode(d => {
      localStorage.setItem('darkMode', String(!d));
      return !d;
    });
  }

  return (
    <GoogleOAuthProvider clientId="1077004651426-bug2jj73prsmnd7p6apqbkqb42pr48ba.apps.googleusercontent.com">
    <ConfigProvider
      locale={thTH}
      theme={{
        token: { colorPrimary: '#1677ff' },
        algorithm: darkMode ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><AppLayout darkMode={darkMode} onToggleDark={toggleDark} /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="hotspot" element={<Hotspot />} />
            <Route path="mac" element={<MAC />} />
            <Route path="vlan" element={<VLAN />} />
            <Route path="webfilter" element={<WebFilter />} />
            <Route path="vpn" element={<VPN />} />
            <Route path="ap" element={<AP />} />
            <Route path="monitor" element={<Monitor />} />
            <Route path="backup" element={<Backup />} />
            <Route path="config" element={<Config />} />
            <Route path="logs" element={<Logs />} />
            <Route path="users" element={<Users />} />
            <Route path="network-scan" element={<NetworkScan />} />
            <Route path="scheduler" element={<Scheduler />} />
            <Route path="report" element={<Report />} />
            <Route path="settings" element={<Settings />} />
            <Route path="devices" element={<Devices />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
    </GoogleOAuthProvider>
  );
}
