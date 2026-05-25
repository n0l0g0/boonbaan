import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);

  async function onFinish({ username, password }) {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      navigate('/');
    } catch {
      message.error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#001529' }}>
      <Card
        title={
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <img src="/logo-192.png" alt="บุญบ้าน" style={{ width: 96, height: 96, marginBottom: 4 }} />
            <div style={{ fontSize: 22, fontWeight: 700 }}>บุญบ้าน</div>
            <div style={{ fontSize: 12, color: '#888', letterSpacing: 1 }}>BOONBAAN</div>
          </div>
        }
        style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Login
          </Button>
        </Form>
      </Card>
    </div>
  );
}

import React from 'react';
