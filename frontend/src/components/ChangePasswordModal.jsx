import { Modal, Form, Input, message } from 'antd';
import api from '../services/api';
import PasswordChecklist from './PasswordChecklist';
import { passwordIssues } from '../utils/passwordPolicy';

export default function ChangePasswordModal({ open, onClose }) {
  const [form] = Form.useForm();
  const pwValue = Form.useWatch('newPassword', form) || '';

  async function submit(values) {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('เปลี่ยนรหัสผ่านสำเร็จ');
      form.resetFields();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.error || 'เกิดข้อผิดพลาด';
      const missing = e.response?.data?.missing;
      message.error(missing?.length ? `${msg}: ${missing.join(', ')}` : msg);
    }
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      title="เปลี่ยนรหัสผ่าน"
      open={open}
      onCancel={handleCancel}
      onOk={() => form.submit()}
      okText="บันทึก"
      cancelText="ยกเลิก"
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="currentPassword"
          label="รหัสผ่านปัจจุบัน"
          rules={[{ required: true, message: 'กรุณากรอกรหัสผ่านปัจจุบัน' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="รหัสผ่านใหม่"
          validateFirst
          rules={[
            { required: true, message: 'กรุณากรอกรหัสผ่านใหม่' },
            {
              validator: (_, v) => {
                if (!v) return Promise.resolve();
                const m = passwordIssues(v);
                return m.length
                  ? Promise.reject(new Error(`ยังขาด: ${m.map(x => x.label).join(', ')}`))
                  : Promise.resolve();
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <PasswordChecklist value={pwValue} />
        <Form.Item
          name="confirmPassword"
          label="ยืนยันรหัสผ่านใหม่"
          dependencies={['newPassword']}
          style={{ marginTop: 16 }}
          rules={[
            { required: true, message: 'กรุณายืนยันรหัสผ่าน' },
            ({ getFieldValue }) => ({
              validator(_, v) {
                if (!v || getFieldValue('newPassword') === v) return Promise.resolve();
                return Promise.reject(new Error('รหัสผ่านยืนยันไม่ตรงกัน'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
