import { useEffect, useState } from 'react';
import {
  Form, Input, Switch, Button, Card, message, Tabs, InputNumber, Divider,
  Select, Spin, Alert, Tag, Typography, Collapse, Steps, Row, Col,
  Space, Upload, Tooltip, Badge, TimePicker,
} from 'antd';
import dayjs from 'dayjs';
import {
  SaveOutlined, ReloadOutlined, ApiOutlined, CheckCircleOutlined,
  CloseCircleOutlined, InfoCircleOutlined, CodeOutlined, MailOutlined,
  CloudUploadOutlined, SendOutlined, GoogleOutlined, SettingOutlined,
  FileTextOutlined, CalendarOutlined, BellOutlined,
} from '@ant-design/icons';
import api from '../services/api';

const { Text, Paragraph, Title } = Typography;

function normalize(raw, boolKeys, numKeys) {
  const out = { ...raw };
  boolKeys.forEach(k => { if (k in out) out[k] = out[k] === true || out[k] === 'true'; });
  numKeys.forEach(k => { if (k in out) out[k] = out[k] !== undefined && out[k] !== '' ? Number(out[k]) : undefined; });
  return out;
}

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setSettings((await api.get('/settings')).data); } catch { }
  }

  useEffect(() => { load(); }, []);

  async function save(updates) {
    setSaving(true);
    try {
      await api.patch('/settings', updates);
      message.success('บันทึกสำเร็จ');
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
    setSaving(false);
  }

  const tabItems = [
    {
      key: 'mikrotik',
      label: <><ApiOutlined /> MikroTik</>,
      children: <MikrotikForm settings={settings} saving={saving} onSave={save} />,
    },
    {
      key: 'smtp',
      label: <><MailOutlined /> SMTP / Email</>,
      children: <SmtpForm settings={settings} saving={saving} onSave={save} />,
    },
    {
      key: 'gdrive',
      label: <><CloudUploadOutlined /> Google Drive</>,
      children: <GDriveForm settings={settings} saving={saving} onSave={save} />,
    },
    {
      key: 'thresholds',
      label: <><BellOutlined /> Alert Thresholds</>,
      children: <ThresholdForm settings={settings} saving={saving} onSave={save} />,
    },
    {
      key: 'alert-rules',
      label: <><BellOutlined /> Custom Alert Rules</>,
      children: <AlertRulesManager />,
    },
    {
      key: 'notifications',
      label: <><BellOutlined /> Notifications</>,
      children: <NotificationForm settings={settings} saving={saving} onSave={save} />,
    },
    {
      key: 'network',
      label: <><SettingOutlined /> Network</>,
      children: <NetworkForm settings={settings} saving={saving} onSave={save} />,
    },
  ];

  return <Tabs items={tabItems} />;
}

// ── SMTP Form ─────────────────────────────────────────────────────────────────

function SmtpForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sendingReport, setSendingReport] = useState('');

  useEffect(() => {
    form.setFieldsValue(normalize(settings,
      ['smtp_secure', 'alert_email_enabled', 'report_daily_enabled', 'report_monthly_enabled'],
      ['smtp_port']
    ));
  }, [settings]);

  async function testSmtp() {
    const v = form.getFieldsValue();
    if (!v.smtp_host || !v.smtp_user) { message.warning('กรุณาใส่ Host และ Username ก่อน'); return; }
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post('/settings/test-smtp', {
        host: v.smtp_host, port: v.smtp_port, user: v.smtp_user,
        pass: v.smtp_pass, secure: v.smtp_secure, to: v.smtp_to,
      });
      setTestResult({ ok: true, msg: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, msg: e.response?.data?.error || e.message });
    }
    setTesting(false);
  }

  async function sendNow(type) {
    setSendingReport(type);
    try {
      await api.post('/settings/send-report-now', { type });
      message.success(`ส่ง${type === 'daily' ? 'รายงานประจำวัน' : 'รายงานประจำเดือน'}สำเร็จ`);
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
    setSendingReport('');
  }

  return (
    <Row gutter={24}>
      <Col xs={24} lg={13}>
        <Card title={<><MailOutlined /> ตั้งค่า SMTP Server</>} style={{ marginBottom: 16 }}>
          <Form form={form} layout="vertical" onFinish={v => {
            const { smtp_pass, ...rest } = v;
            if (!smtp_pass) { delete rest.smtp_pass; } else { rest.smtp_pass = smtp_pass; }
            setTestResult(null);
            onSave(rest);
          }}>
            <Row gutter={12}>
              <Col xs={16}>
                <Form.Item name="smtp_host" label="SMTP Host" rules={[{ required: true, message: 'จำเป็น' }]}>
                  <Input placeholder="smtp.gmail.com" />
                </Form.Item>
              </Col>
              <Col xs={8}>
                <Form.Item name="smtp_port" label="Port">
                  <InputNumber style={{ width: '100%' }} placeholder="587" min={1} max={65535} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="smtp_user" label="Username / Email" rules={[{ required: true, message: 'จำเป็น' }]}>
              <Input placeholder="yourname@gmail.com" />
            </Form.Item>

            <Form.Item name="smtp_pass" label="Password / App Password" extra="สำหรับ Gmail ให้ใช้ App Password (ไม่ใช่ password ปกติ)">
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>

            <Row gutter={12}>
              <Col xs={12}>
                <Form.Item name="smtp_from" label="From (ชื่อผู้ส่ง)" extra="เว้นว่างใช้ username">
                  <Input placeholder="บุญบ้าน" />
                </Form.Item>
              </Col>
              <Col xs={12}>
                <Form.Item name="smtp_secure" label="SSL/TLS" valuePropName="checked" extra="เปิดสำหรับ port 465">
                  <Switch checkedChildren="SSL" unCheckedChildren="STARTTLS" />
                </Form.Item>
              </Col>
            </Row>

            <Divider>ผู้รับรายงาน</Divider>

            <Form.Item name="smtp_to" label="ส่งถึง (To)" extra="Email ปลายทาง ใส่หลาย email คั่นด้วย ,">
              <Input placeholder="admin@example.com, manager@example.com" />
            </Form.Item>

            <Form.Item name="alert_email_enabled" label="เปิดแจ้งเตือน Alert ทาง Email" valuePropName="checked">
              <Switch />
            </Form.Item>

            {testResult && (
              <Form.Item>
                <Alert
                  type={testResult.ok ? 'success' : 'error'}
                  showIcon
                  icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  message={testResult.msg}
                />
              </Form.Item>
            )}

            <Space wrap>
              <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>บันทึก</Button>
              <Button onClick={testSmtp} loading={testing} icon={<MailOutlined />}>ทดสอบส่ง Email</Button>
            </Space>
          </Form>
        </Card>

        <Card title={<><CalendarOutlined /> ตั้งค่าส่งรายงานอัตโนมัติ</>}>
          <Row gutter={16}>
            {/* Daily report */}
            <Col xs={24} sm={12}>
              <Card size="small" style={{ marginBottom: 12, borderColor: settings.report_daily_enabled === 'true' ? '#52c41a' : '#d9d9d9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text strong><FileTextOutlined /> รายงานประจำวัน</Text>
                  <Switch
                    checked={settings.report_daily_enabled === 'true'}
                    onChange={v => onSave({ report_daily_enabled: String(v) })}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                  สรุป Bandwidth, Alert และ Web Block ประจำวัน
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>ส่งเวลา:</Text>
                  <TimePicker
                    format="HH:mm"
                    minuteStep={5}
                    value={settings.report_daily_time ? dayjs(settings.report_daily_time, 'HH:mm') : dayjs('08:00', 'HH:mm')}
                    onChange={(_, timeStr) => timeStr && onSave({ report_daily_time: timeStr })}
                    style={{ flex: 1 }}
                    size="small"
                    allowClear={false}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>ทุกวัน</Text>
                </div>
                <Button size="small" icon={<SendOutlined />} loading={sendingReport === 'daily'}
                  onClick={() => sendNow('daily')}>
                  ส่งทดสอบตอนนี้
                </Button>
              </Card>
            </Col>

            {/* Monthly report */}
            <Col xs={24} sm={12}>
              <Card size="small" style={{ marginBottom: 12, borderColor: settings.report_monthly_enabled === 'true' ? '#52c41a' : '#d9d9d9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text strong><CalendarOutlined /> รายงานประจำเดือน</Text>
                  <Switch
                    checked={settings.report_monthly_enabled === 'true'}
                    onChange={v => onSave({ report_monthly_enabled: String(v) })}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                  สรุปรายเดือน: Bandwidth, Alert, Top blocked sites
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>วันที่:</Text>
                  <Select
                    size="small"
                    style={{ width: 70 }}
                    value={Number(settings.report_monthly_day) || 1}
                    onChange={v => onSave({ report_monthly_day: String(v) })}
                    options={Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: i + 1 }))}
                  />
                  <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>เวลา:</Text>
                  <TimePicker
                    format="HH:mm"
                    minuteStep={5}
                    value={settings.report_monthly_time ? dayjs(settings.report_monthly_time, 'HH:mm') : dayjs('08:00', 'HH:mm')}
                    onChange={(_, timeStr) => timeStr && onSave({ report_monthly_time: timeStr })}
                    style={{ flex: 1 }}
                    size="small"
                    allowClear={false}
                  />
                </div>
                <Button size="small" icon={<SendOutlined />} loading={sendingReport === 'monthly'}
                  onClick={() => sendNow('monthly')}>
                  ส่งทดสอบตอนนี้
                </Button>
              </Card>
            </Col>
          </Row>
        </Card>
      </Col>

      <Col xs={24} lg={11}>
        <Card title={<><InfoCircleOutlined /> วิธีตั้งค่า Gmail</>} size="small">
          <Steps direction="vertical" size="small" current={-1} style={{ marginTop: 8 }}
            items={[
              {
                title: 'เปิด 2-Factor Authentication',
                description: <Text type="secondary" style={{ fontSize: 12 }}>ไปที่ Google Account → Security → 2-Step Verification</Text>,
              },
              {
                title: 'สร้าง App Password',
                description: (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Google Account → Security → App passwords → เลือก Mail</Text>
                    <pre style={{ background: '#f5f5f5', padding: '6px 10px', borderRadius: 4, fontSize: 11, marginTop: 4 }}>
                      SMTP Host: smtp.gmail.com{'\n'}Port: 587 (STARTTLS) หรือ 465 (SSL){'\n'}Password: App Password ที่ได้
                    </pre>
                  </div>
                ),
              },
              {
                title: 'ตั้งค่า SMTP ด้านซ้าย',
                description: <Text type="secondary" style={{ fontSize: 12 }}>ใส่ค่าและกดปุ่ม "ทดสอบส่ง Email"</Text>,
              },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Text strong style={{ fontSize: 12 }}>สำหรับ Provider อื่น</Text>
          <pre style={{ background: '#f5f5f5', padding: '8px', borderRadius: 4, fontSize: 11, marginTop: 6 }}>
{`Outlook/Office365:
  Host: smtp.office365.com
  Port: 587, STARTTLS

Yahoo Mail:
  Host: smtp.mail.yahoo.com
  Port: 465, SSL

Custom SMTP:
  ใส่ค่าตาม server ของคุณ`}
          </pre>
        </Card>
      </Col>
    </Row>
  );
}

// ── Google Drive Form ─────────────────────────────────────────────────────────

function GDriveForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  const [credText, setCredText] = useState('');
  const [driveStatus, setDriveStatus] = useState(null); // {connected, type, hasToken, ...}
  const [disconnecting, setDisconnecting] = useState(false);

  // Detect credential type from JSON text
  const credType = (() => {
    try {
      const j = JSON.parse(credText);
      if (j.type === 'service_account') return 'service_account';
      if (j.web || j.installed) return 'oauth2';
    } catch { }
    return null;
  })();

  async function loadStatus() {
    try { setDriveStatus((await api.get('/settings/gdrive/status')).data); } catch { }
  }

  useEffect(() => {
    form.setFieldsValue({
      ...normalize(settings, ['gdrive_logs_enabled'], []),
      gdrive_backup_folder_id: settings.gdrive_backup_folder_id || '',
      gdrive_logs_folder_id: settings.gdrive_logs_folder_id || '',
    });
    setCredText(settings.gdrive_credentials || '');
    loadStatus();
  }, [settings]);  // eslint-disable-line

  // Handle redirect back from Google OAuth2
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (params.get('gdrive') === 'connected') {
      message.success('เชื่อมต่อ Google Drive สำเร็จ!');
      loadStatus();
      window.history.replaceState(null, '', window.location.pathname + '#/settings');
    } else if (params.get('gdrive') === 'error') {
      message.error('เชื่อมต่อ Google Drive ไม่สำเร็จ: ' + (params.get('msg') || ''));
      window.history.replaceState(null, '', window.location.pathname + '#/settings');
    }
  }, []);

  function handleFileUpload(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target.result);
        setCredText(JSON.stringify(json, null, 2));
        message.success(`โหลดไฟล์ ${file.name} สำเร็จ`);
      } catch { message.error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง'); }
    };
    reader.readAsText(file);
    return false;
  }

  async function saveCredentials() {
    if (!credText) { message.warning('กรุณาใส่ Credentials JSON'); return; }
    try { JSON.parse(credText); } catch { message.error('JSON ไม่ถูกต้อง'); return; }
    await onSave({
      gdrive_credentials: credText,
      gdrive_backup_folder_id: form.getFieldValue('gdrive_backup_folder_id') || '',
      gdrive_logs_folder_id: form.getFieldValue('gdrive_logs_folder_id') || '',
    });
  }

  function startOAuth() {
    // Open backend OAuth2 redirect in current tab
    window.location.href = `${api.defaults.baseURL || '/api'}/settings/gdrive/auth`;
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api.delete('/settings/gdrive/disconnect');
      message.success('ยกเลิกการเชื่อมต่อแล้ว');
      loadStatus();
    } catch { message.error('เกิดข้อผิดพลาด'); }
    setDisconnecting(false);
  }

  const isConnected = driveStatus?.connected;

  return (
    <Row gutter={24}>
      <Col xs={24} lg={14}>

        {/* Connection status card */}
        <Card style={{ marginBottom: 16, borderColor: isConnected ? '#52c41a' : '#d9d9d9', background: isConnected ? '#f6ffed' : '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 36 }}>
              {isConnected ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloudUploadOutlined style={{ color: '#aaa' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 16 }}>
                Google Drive — {isConnected
                  ? <Tag color="success">เชื่อมต่อแล้ว</Tag>
                  : <Tag color="default">ยังไม่เชื่อมต่อ</Tag>}
              </Text>
              <div style={{ marginTop: 4 }}>
                {isConnected
                  ? <Text type="secondary" style={{ fontSize: 12 }}>
                      {driveStatus.type === 'service_account'
                        ? `Service Account: ${driveStatus.email}`
                        : 'OAuth2 — พร้อม upload logs'}
                    </Text>
                  : <Text type="secondary" style={{ fontSize: 12 }}>ใส่ credentials แล้ว Authorize เพื่อเชื่อมต่อ</Text>}
              </div>
            </div>
            {isConnected && (
              <Button danger size="small" loading={disconnecting} onClick={disconnect}>
                ยกเลิกการเชื่อมต่อ
              </Button>
            )}
          </div>
        </Card>

        <Card title={<><CloudUploadOutlined /> Credentials & ตั้งค่า</>} style={{ marginBottom: 16 }}>
          <Form form={form} layout="vertical">

            <Form.Item
              label={
                <Space>
                  <span>Credentials JSON</span>
                  <Tag color={credType === 'service_account' ? 'blue' : credType === 'oauth2' ? 'green' : 'default'}>
                    {credType === 'service_account' ? 'Service Account' : credType === 'oauth2' ? 'OAuth2 Web Client ✓' : 'ยังไม่มี'}
                  </Tag>
                  <Upload beforeUpload={handleFileUpload} showUploadList={false} accept=".json">
                    <Button size="small" icon={<CloudUploadOutlined />}>อัปโหลดไฟล์ .json</Button>
                  </Upload>
                </Space>
              }
              extra="รองรับทั้ง Service Account JSON และ OAuth2 Web Client JSON"
            >
              <Input.TextArea
                rows={7}
                value={credText}
                onChange={e => setCredText(e.target.value)}
                placeholder={'{\n  "web": { "client_id": "...", "client_secret": "..." }\n}\nหรือ\n{\n  "type": "service_account", "client_email": "..."\n}'}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
            </Form.Item>

            <Form.Item name="gdrive_backup_folder_id" label={<><span style={{marginRight:6}}>📁</span>Folder ID — Backup</>}
              extra="ID ของโฟลเดอร์ Backup ใน Drive: drive.google.com/drive/folders/[FOLDER_ID]">
              <Input placeholder="Folder ID สำหรับ Backup" />
            </Form.Item>

            <Form.Item name="gdrive_logs_folder_id" label={<><span style={{marginRight:6}}>📄</span>Folder ID — Logs</>}
              extra="ID ของโฟลเดอร์ Logs ใน Drive: drive.google.com/drive/folders/[FOLDER_ID]">
              <Input placeholder="Folder ID สำหรับ Logs" />
            </Form.Item>

            {/* OAuth2 connect button — shown when credentials are OAuth2 Web Client */}
            {credType === 'oauth2' && !isConnected && (
              <Alert
                style={{ marginBottom: 12 }}
                type="info"
                showIcon
                message="ต้อง Authorize ก่อนใช้งาน"
                description={
                  <div>
                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                      1. กด "บันทึก Credentials" ก่อน<br />
                      2. กด "Authorize กับ Google" — browser จะเปิด Google<br />
                      3. เลือก account และกด Allow<br />
                      4. ระบบจะกลับมาที่หน้านี้อัตโนมัติ
                    </div>
                    <Alert type="warning" showIcon style={{ fontSize: 11 }}
                      message={`ต้องเพิ่ม redirect URI นี้ใน Google Cloud Console → OAuth2 Client → Authorized redirect URIs: ${window.location.protocol}//${window.location.hostname}:3001/api/settings/gdrive/callback`} />
                  </div>
                }
              />
            )}

            {credType === 'service_account' && !isConnected && (
              <Alert style={{ marginBottom: 12 }} type="info" showIcon
                message="Service Account — บันทึกแล้วพร้อมใช้งานทันที ไม่ต้อง Authorize" />
            )}

            <Space wrap>
              <Button type="primary" icon={<SaveOutlined />} onClick={saveCredentials} loading={saving}>
                บันทึก Credentials
              </Button>
              {credType === 'oauth2' && (
                <Button
                  type={isConnected ? 'default' : 'primary'}
                  icon={<CheckCircleOutlined />}
                  style={!isConnected ? { background: '#4285F4', borderColor: '#4285F4' } : {}}
                  onClick={startOAuth}
                  disabled={!credText}
                >
                  {isConnected ? 'Re-Authorize กับ Google' : 'Authorize กับ Google'}
                </Button>
              )}
            </Space>
          </Form>
        </Card>

        <Card title="ตั้งค่าการ Upload Logs" size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
            <div>
              <Text strong><FileTextOutlined /> Upload Blocked Log อัตโนมัติ</Text>
              <div><Text type="secondary" style={{ fontSize: 12 }}>อัปโหลด CSV ของ blocked access log ไปพร้อมกับรายงาน Email (รายวัน/รายเดือน)</Text></div>
            </div>
            <Switch
              checked={settings.gdrive_logs_enabled === 'true'}
              onChange={v => onSave({ gdrive_logs_enabled: String(v) })}
            />
          </div>
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card title={<><InfoCircleOutlined /> วิธีใช้ OAuth2 Web Client (ที่มีอยู่แล้ว)</>} size="small" style={{ marginBottom: 12 }}>
          <Steps direction="vertical" size="small" current={-1}
            items={[
              { title: 'วาง Credentials JSON ด้านซ้าย', description: <Text type="secondary" style={{ fontSize: 12 }}>ใช้ไฟล์ที่ดาวน์โหลดจาก Google Cloud Console → APIs & Services → Credentials</Text> },
              {
                title: 'เพิ่ม Redirect URI',
                description: (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Google Cloud Console → Credentials → คลิก OAuth2 Client → Authorized redirect URIs → เพิ่ม:</Text>
                    <pre style={{ background: '#f5f5f5', padding: 6, borderRadius: 4, fontSize: 10, marginTop: 4, wordBreak: 'break-all' }}>
                      {`${window.location.protocol}//${window.location.hostname}:3001/api/settings/gdrive/callback`}
                    </pre>
                  </div>
                ),
              },
              { title: 'กด "บันทึก Credentials"', description: <Text type="secondary" style={{ fontSize: 12 }}>บันทึกไฟล์ JSON ลง database ก่อน</Text> },
              { title: 'กด "Authorize กับ Google"', description: <Text type="secondary" style={{ fontSize: 12 }}>Browser จะเปิด Google OAuth2 consent screen — เลือก account และ Allow</Text> },
              { title: 'เสร็จสิ้น', description: <Text type="secondary" style={{ fontSize: 12 }}>ระบบจะกลับมาที่หน้านี้และแสดง "เชื่อมต่อแล้ว" อัตโนมัติ</Text> },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}

// ── MikroTik Form ─────────────────────────────────────────────────────────────

const MIKROTIK_GUIDE = [
  {
    key: '1',
    label: <><CodeOutlined /> ขั้นตอนที่ 1 — เปิด REST API (HTTPS)</>,
    children: (
      <div>
        <Paragraph>รันใน Winbox Terminal หรือ SSH:</Paragraph>
        <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 12 }}>{
`/ip service set www-ssl disabled=no port=443
/ip service set www-ssl certificate=none`
        }</pre>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          ถ้าต้องการใช้ port อื่น เช่น 8443 ให้เปลี่ยน <Text code>port=443</Text> เป็น <Text code>port=8443</Text>
        </Paragraph>
      </div>
    ),
  },
  {
    key: '2',
    label: <><CodeOutlined /> ขั้นตอนที่ 2 — สร้าง API User</>,
    children: (
      <div>
        <Paragraph>สร้าง user แยกจาก admin เพื่อความปลอดภัย:</Paragraph>
        <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 12 }}>{
`/user add name=apiuser password=StrongPass123! group=full`
        }</pre>
        <Alert type="warning" showIcon style={{ marginTop: 8 }}
          message="ห้ามใช้ user admin โดยตรงบน production — สร้าง user แยกและตั้ง password แข็งแรง" />
      </div>
    ),
  },
  {
    key: '3',
    label: <><CodeOutlined /> ขั้นตอนที่ 3 — อนุญาต IP ของ Server</>,
    children: (
      <div>
        <Paragraph>อนุญาตเฉพาะ IP ของ VPS ที่รัน backend เข้าถึง API:</Paragraph>
        <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 12 }}>{
`/ip firewall filter add chain=input \\
  src-address=<VPS_IP> \\
  dst-port=443 protocol=tcp \\
  action=accept comment="Boonbaan API" \\
  place-before=0`
        }</pre>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          แทน <Text code>&lt;VPS_IP&gt;</Text> ด้วย IP จริงของ server ที่รัน backend
        </Paragraph>
      </div>
    ),
  },
  {
    key: '4',
    label: <><CodeOutlined /> ขั้นตอนที่ 4 — เปิด Web Proxy (สำหรับ Web Filter)</>,
    children: (
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 12 }}>{
`/ip proxy set enabled=yes port=8080 max-cache-size=none
/ip firewall nat add chain=dstnat src-address=192.168.88.0/24 \\
  protocol=tcp dst-port=80 action=redirect to-ports=8080`
      }</pre>
    ),
  },
  {
    key: '5',
    label: <><CodeOutlined /> ขั้นตอนที่ 5 — เปิด IP Accounting</>,
    children: (
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 12 }}>{
`/ip accounting set enabled=yes account-local-traffic=no threshold=256`
      }</pre>
    ),
  },
];

function MikrotikForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    form.setFieldsValue(normalize(settings, ['mikrotik_ssl'], ['mikrotik_port']));
  }, [settings]);

  async function testConnection() {
    try { await form.validateFields(['mikrotik_host', 'mikrotik_user']); } catch { return; }
    setTesting(true); setTestResult(null);
    try {
      const values = form.getFieldsValue();
      const r = await api.post('/settings/test-mikrotik', {
        host: values.mikrotik_host, port: String(values.mikrotik_port || 443),
        user: values.mikrotik_user, pass: values.mikrotik_pass, ssl: values.mikrotik_ssl,
      });
      setTestResult({ ok: true, ...r.data });
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.error || e.message });
    }
    setTesting(false);
  }

  function handleSave(v) {
    if (v.mikrotik_pass && v.mikrotik_pass !== v.mikrotik_pass_confirm) { message.error('Password ไม่ตรงกัน'); return; }
    const { mikrotik_pass_confirm, ...rest } = v;
    if (!rest.mikrotik_pass) delete rest.mikrotik_pass;
    setTestResult(null);
    onSave(rest);
  }

  return (
    <Row gutter={24} align="top">
      <Col xs={24} lg={12}>
        <Card title={<><ApiOutlined /> ข้อมูลการเชื่อมต่อ</>}>
          <Form form={form} layout="vertical" onFinish={handleSave}>
            <Form.Item name="mikrotik_host" label="Host / IP" rules={[{ required: true, message: 'กรุณาใส่ IP หรือ hostname' }]}>
              <Input placeholder="192.168.88.1" />
            </Form.Item>
            <Form.Item name="mikrotik_port" label="Port" extra="ค่าเริ่มต้น: 443 (HTTPS) หรือ 80 (HTTP)">
              <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="443" />
            </Form.Item>
            <Form.Item name="mikrotik_user" label="Username" rules={[{ required: true, message: 'กรุณาใส่ username' }]}>
              <Input placeholder="apiuser" autoComplete="off" />
            </Form.Item>
            <Form.Item name="mikrotik_pass" label="Password" extra="เว้นว่างถ้าไม่ต้องการเปลี่ยน password">
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="mikrotik_pass_confirm" label="ยืนยัน Password"
              dependencies={['mikrotik_pass']}
              rules={[({ getFieldValue }) => ({
                validator(_, value) {
                  const pass = getFieldValue('mikrotik_pass');
                  if (!pass || !value || pass === value) return Promise.resolve();
                  return Promise.reject(new Error('Password ไม่ตรงกัน'));
                },
              })]}>
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="mikrotik_ssl" label="ใช้ HTTPS (SSL)" valuePropName="checked" extra="เปิดเมื่อใช้ port 443">
              <Switch />
            </Form.Item>
            {testResult && (
              <Form.Item>
                {testResult.ok
                  ? <Alert type="success" showIcon icon={<CheckCircleOutlined />}
                      message={<span>เชื่อมต่อสำเร็จ — <b>{testResult.identity}</b> <Tag color="blue">RouterOS {testResult.version}</Tag><Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>Uptime: {testResult.uptime}</Text></span>} />
                  : <Alert type="error" showIcon icon={<CloseCircleOutlined />} message={`เชื่อมต่อไม่ได้: ${testResult.error}`} />}
              </Form.Item>
            )}
            <Button.Group>
              <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>บันทึก</Button>
              <Button onClick={testConnection} loading={testing} icon={<ApiOutlined />}>ทดสอบการเชื่อมต่อ</Button>
            </Button.Group>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title={<><InfoCircleOutlined /> วิธีตั้งค่า MikroTik</>} size="small">
          <Collapse items={MIKROTIK_GUIDE} ghost size="small" expandIconPosition="start" />
        </Card>
      </Col>
    </Row>
  );
}

// ── Threshold Form ────────────────────────────────────────────────────────────

function ThresholdForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  useEffect(() => { form.setFieldsValue(normalize(settings, [], ['threshold_warning', 'threshold_critical'])); }, [settings]);
  return (
    <Card style={{ maxWidth: 480 }}>
      <Form form={form} layout="vertical" onFinish={v => onSave(v)}>
        <Form.Item name="threshold_warning" label="Warning Threshold (%)" extra="แจ้งเตือนสีเหลืองเมื่อ CPU/Memory/Disk/Bandwidth เกิน">
          <InputNumber min={1} max={99} style={{ width: '100%' }} addonAfter="%" />
        </Form.Item>
        <Form.Item name="threshold_critical" label="Critical Threshold (%)" extra="แจ้งเตือนสีแดงเมื่อเกิน">
          <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="%" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>บันทึก</Button>
      </Form>
    </Card>
  );
}

// ── Notification Form ─────────────────────────────────────────────────────────

function NotificationForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue(normalize(settings,
      ['alert_email_enabled', 'alert_chat_enabled', 'line_notify_enabled', 'blocked_access_notify', 'hotspot_notify_enabled'],
      ['blocked_access_cooldown_sec']
    ));
  }, [settings]);
  return (
    <Card style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" onFinish={v => onSave(v)}>
        <Divider>Email</Divider>
        <Form.Item name="alert_email_enabled" label="เปิดการแจ้งเตือน Email" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Divider>Google Chat</Divider>
        <Form.Item name="alert_chat_enabled" label="เปิดการแจ้งเตือน Google Chat" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="google_chat_webhook" label="Google Chat Webhook URL">
          <Input placeholder="https://chat.googleapis.com/v1/spaces/..." />
        </Form.Item>
        <Divider>LINE Notify</Divider>
        <Form.Item name="line_notify_enabled" label="เปิดการแจ้งเตือน LINE" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="line_notify_token" label="LINE Notify Token" extra={<a href="https://notify-bot.line.me/my/" target="_blank" rel="noreferrer">ขอ Token ที่นี่</a>}>
          <Input.Password placeholder="ใส่ token จาก LINE Notify" />
        </Form.Item>
        <Divider>Hotspot</Divider>
        <Form.Item name="hotspot_notify_enabled" label="แจ้งเตือน Login / Logout Hotspot ไปยัง Google Chat" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Divider>Blocked Access</Divider>
        <Form.Item name="blocked_access_notify" label="แจ้งเตือนเมื่อมีการเข้าเว็บ Block" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="blocked_access_cooldown_sec" label="Cooldown ระหว่าง alert (วินาที)">
          <InputNumber min={60} max={3600} style={{ width: '100%' }} addonAfter="วินาที" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>บันทึก</Button>
      </Form>
    </Card>
  );
}

// ── Network Form ──────────────────────────────────────────────────────────────

function NetworkForm({ settings, saving, onSave }) {
  const [form] = Form.useForm();
  const [interfaces, setInterfaces] = useState([]);
  const [ifLoading, setIfLoading] = useState(false);

  async function loadInterfaces() {
    setIfLoading(true);
    try { const r = await api.get('/network/interfaces'); setInterfaces(r.data); } catch { }
    setIfLoading(false);
  }

  useEffect(() => { loadInterfaces(); }, []);

  useEffect(() => {
    // Parse wan_interfaces JSON, fall back to legacy single-WAN settings
    let list = [];
    if (settings.wan_interfaces) {
      try { list = JSON.parse(settings.wan_interfaces); } catch { list = []; }
    }
    if (!Array.isArray(list) || list.length === 0) {
      if (settings.wan_interface) {
        list = [{ name: settings.wan_interface, bandwidth_mbps: Number(settings.wan_bandwidth_mbps) || 100, label: settings.wan_interface }];
      } else {
        list = [{ name: '', bandwidth_mbps: 1000, label: '' }];
      }
    }
    form.setFieldsValue({ wans: list });
  }, [settings]);

  const ifOptions = interfaces.map(i => ({
    value: i.name,
    label: (
      <span>
        <strong>{i.name}</strong>
        <span style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>
          {i.type}{i.comment ? ` — ${i.comment}` : ''}{i['mac-address'] ? ` (${i['mac-address']})` : ''}
        </span>
      </span>
    ),
  }));

  async function handleFinish(values) {
    const list = (values.wans || []).filter(w => w && w.name);
    if (list.length === 0) {
      message.error('ต้องมีอย่างน้อย 1 WAN');
      return;
    }
    const normalized = list.map(w => ({
      name: w.name,
      bandwidth_mbps: Number(w.bandwidth_mbps) || 100,
      label: w.label || w.name,
    }));
    // Save as JSON in wan_interfaces; also update legacy keys to first entry for backward compat
    await onSave({
      wan_interfaces: JSON.stringify(normalized),
      wan_interface: normalized[0].name,
      wan_bandwidth_mbps: normalized[0].bandwidth_mbps,
    });
  }

  return (
    <Card style={{ maxWidth: 720 }}>
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          รองรับ Multi-WAN — เพิ่มได้หลาย interface แต่ละตัวจะถูก monitor แยกกัน
        </Text>
        <Form.List name="wans">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Row key={key} gutter={8} align="top" style={{ marginBottom: 8 }}>
                  <Col flex="220px">
                    <Form.Item {...rest} name={[name, 'name']} rules={[{ required: true, message: 'เลือก interface' }]} style={{ marginBottom: 0 }}>
                      <Select showSearch placeholder="Interface..." loading={ifLoading} options={ifOptions}
                        optionFilterProp="value"
                        notFoundContent={ifLoading ? <Spin size="small" /> : 'ไม่พบ interface'}
                        dropdownRender={menu => (
                          <>{menu}
                            <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0' }}>
                              <Button size="small" type="link" icon={<ReloadOutlined />} onClick={loadInterfaces} loading={ifLoading}>โหลดใหม่</Button>
                            </div>
                          </>
                        )}
                      />
                    </Form.Item>
                  </Col>
                  <Col flex="150px">
                    <Form.Item {...rest} name={[name, 'bandwidth_mbps']} rules={[{ required: true, message: 'ใส่ Mbps' }]} style={{ marginBottom: 0 }}>
                      <InputNumber min={1} style={{ width: '100%' }} addonAfter="Mbps" placeholder="1000" />
                    </Form.Item>
                  </Col>
                  <Col flex="auto">
                    <Form.Item {...rest} name={[name, 'label']} style={{ marginBottom: 0 }}>
                      <Input placeholder="ชื่อแสดงผล (เช่น Main ISP, Backup)" />
                    </Form.Item>
                  </Col>
                  <Col flex="40px">
                    <Button danger icon={<CloseCircleOutlined />} onClick={() => remove(name)} disabled={fields.length <= 1} />
                  </Col>
                </Row>
              ))}
              <Button type="dashed" onClick={() => add({ name: '', bandwidth_mbps: 1000, label: '' })} block style={{ marginTop: 8 }}>
                + เพิ่ม WAN
              </Button>
            </>
          )}
        </Form.List>
        <Divider />
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>บันทึก</Button>
      </Form>
    </Card>
  );
}

// ── Alert Rules Manager ───────────────────────────────────────────────────────

function AlertRulesManager() {
  const [rules, setRules] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [comparators, setComparators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null | rule | 'new'
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([api.get('/alerts/metrics'), api.get('/alerts/rules')]);
      setMetrics(m.data.metrics);
      setComparators(m.data.comparators);
      setRules(r.data);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(rule) {
    setEditing(rule || 'new');
    form.setFieldsValue(rule || { name: '', metric: 'cpu', comparator: '>', threshold: 80, duration_minutes: 0, severity: 'warning', enabled: true });
  }

  async function handleSave(values) {
    try {
      if (editing === 'new') await api.post('/alerts/rules', values);
      else await api.patch(`/alerts/rules/${editing.id}`, values);
      message.success('บันทึกสำเร็จ');
      setEditing(null);
      load();
    } catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  async function handleDelete(id) {
    try { await api.delete(`/alerts/rules/${id}`); load(); }
    catch (e) { message.error(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  }

  async function toggleEnabled(rule) {
    try { await api.patch(`/alerts/rules/${rule.id}`, { enabled: !rule.enabled }); load(); }
    catch { }
  }

  return (
    <Card style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text type="secondary">{'ตั้ง alert เองตาม metric ต่างๆ — เช่น แจ้งเมื่อ device > 50, CPU > 90% นาน 5 นาที'}</Text>
        <Button type="primary" icon={<SaveOutlined />} onClick={() => startEdit(null)}>เพิ่ม Rule</Button>
      </div>

      <Tabs items={[{
        key: 'list', label: `Rules (${rules.length})`,
        children: (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rules.length === 0 && <Text type="secondary">ยังไม่มี alert rule</Text>}
            {rules.map(r => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderBottom: '1px solid #f0f0f0' }}>
                <Switch checked={r.enabled} onChange={() => toggleEnabled(r)} size="small" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{r.name} <Tag color={r.severity === 'critical' ? 'red' : 'orange'}>{r.severity}</Tag></div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {metrics[r.metric]?.label || r.metric} {r.comparator} {r.threshold}{metrics[r.metric]?.unit || ''}
                    {r.duration_minutes > 0 ? ` นาน ${r.duration_minutes} นาที` : ''}
                    {r.last_triggered ? ` · last fired ${dayjs(r.last_triggered).fromNow ? dayjs(r.last_triggered).format('DD/MM HH:mm') : ''}` : ''}
                  </Text>
                </div>
                <Button size="small" onClick={() => startEdit(r)}>Edit</Button>
                <Button size="small" danger onClick={() => handleDelete(r.id)}>Delete</Button>
              </li>
            ))}
          </ul>
        ),
      }]} />

      {editing && (
        <Card style={{ marginTop: 16 }} title={editing === 'new' ? 'New Rule' : `Edit: ${editing.name}`}
              extra={<Button size="small" onClick={() => setEditing(null)}>ยกเลิก</Button>}>
          <Form form={form} layout="vertical" onFinish={handleSave}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                  <Input placeholder="เช่น Too many devices" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="metric" label="Metric" rules={[{ required: true }]}>
                  <Select options={Object.entries(metrics).map(([k, v]) => ({ value: k, label: `${v.label}${v.unit ? ' (' + v.unit + ')' : ''}` }))} />
                </Form.Item>
              </Col>
              <Col xs={8}>
                <Form.Item name="comparator" label="Comparator" rules={[{ required: true }]}>
                  <Select options={comparators.map(c => ({ value: c, label: c }))} />
                </Form.Item>
              </Col>
              <Col xs={8}>
                <Form.Item name="threshold" label="Threshold" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={8}>
                <Form.Item name="duration_minutes" label="Duration (min)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12}>
                <Form.Item name="severity" label="Severity">
                  <Select options={[{ value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]} />
                </Form.Item>
              </Col>
              <Col xs={12}>
                <Form.Item name="enabled" label="Enabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>บันทึก</Button>
          </Form>
        </Card>
      )}
    </Card>
  );
}
