import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, Form, Input, Button, Alert, Result, Spin, Typography, Statistic } from 'antd';
import PasswordChecklist from '../components/PasswordChecklist';
import { passwordIssues } from '../utils/passwordPolicy';

const { Title, Text } = Typography;
const { Countdown } = Statistic;

const BASE = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
const pub = axios.create({ baseURL: `${BASE}/api` });

export default function HotspotReset() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true });
  const [form] = Form.useForm();
  const newPw = Form.useWatch('newPassword', form);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    pub.get(`/hotspot/reset/${token}`)
      .then(r => setState({ loading: false, username: r.data.username, expiresAt: r.data.expires_at }))
      .catch(e => setState({ loading: false, error: e.response?.data?.error || 'invalid' }));
  }, [token]);

  async function submit(values) {
    setErr('');
    if (values.newPassword !== values.confirm) {
      setErr('รหัสใหม่และยืนยันไม่ตรงกัน');
      return;
    }
    const issues = passwordIssues(values.newPassword);
    if (issues.length) {
      setErr('Password ไม่ผ่านเงื่อนไข: ' + issues.map(i => i.label).join(', '));
      return;
    }
    setSubmitting(true);
    try {
      await pub.post(`/hotspot/reset/${token}`, {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      setDone(true);
    } catch (e) {
      setErr(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
    setSubmitting(false);
  }

  const wrap = (children) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#f0f2f5' }}>
      <Card style={{ width: '100%', maxWidth: 460 }}>{children}</Card>
    </div>
  );

  if (state.loading) return wrap(<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>);

  if (state.error) {
    const msg = state.error === 'expired' ? 'ลิงก์หมดอายุแล้ว'
              : state.error === 'used'    ? 'ลิงก์ถูกใช้งานไปแล้ว'
              : 'ลิงก์ไม่ถูกต้อง';
    return wrap(<Result status="error" title={msg} subTitle="กรุณาติดต่อ admin เพื่อขอลิงก์ใหม่" />);
  }

  if (done) {
    return wrap(<Result status="success" title="เปลี่ยนรหัสผ่านสำเร็จ" subTitle={`Username: ${state.username} — กรุณาใช้รหัสใหม่ในการล็อกอินครั้งต่อไป`} />);
  }

  return wrap(
    <>
      <Title level={4} style={{ marginTop: 0 }}>เปลี่ยนรหัส Hotspot</Title>
      <Text type="secondary">Username: <strong>{state.username}</strong></Text>
      <Alert
        type="warning"
        showIcon
        style={{ margin: '12px 0' }}
        message={
          <span>
            ลิงก์มีอายุ 10 นาที กรุณาทำรายการให้เสร็จก่อนหมดเวลา — เหลือเวลา{' '}
            <Countdown
              value={new Date(state.expiresAt).getTime()}
              format="mm:ss"
              valueStyle={{ fontSize: 14, display: 'inline' }}
              onFinish={() => setState(s => ({ ...s, error: 'expired' }))}
            />
          </span>
        }
      />
      {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} showIcon closable onClose={() => setErr('')} />}
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="oldPassword" label="รหัสผ่านเดิม" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label="รหัสผ่านใหม่" rules={[{ required: true }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <PasswordChecklist value={newPw || ''} />
        <Form.Item name="confirm" label="ยืนยันรหัสผ่านใหม่" style={{ marginTop: 12 }} rules={[{ required: true }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} block>บันทึก</Button>
      </Form>
    </>
  );
}
