import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { Progress, Typography } from 'antd';
import { PASSWORD_RULES, passwordStrengthScore } from '../utils/passwordPolicy';

const { Text } = Typography;

const STRENGTH = [
  { label: 'อ่อนมาก', color: '#ff4d4f' },
  { label: 'อ่อน',    color: '#ff7a45' },
  { label: 'พอใช้',   color: '#faad14' },
  { label: 'ดี',      color: '#73d13d' },
  { label: 'แข็งแรง', color: '#52c41a' },
  { label: 'แข็งแรงมาก', color: '#389e0d' },
];

export default function PasswordChecklist({ value = '' }) {
  const score = passwordStrengthScore(value);
  const pct = Math.round((score / PASSWORD_RULES.length) * 100);
  const meta = STRENGTH[score] || STRENGTH[0];

  return (
    <div style={{ marginTop: 4 }}>
      <Progress
        percent={pct}
        showInfo={false}
        size="small"
        strokeColor={meta.color}
        style={{ marginBottom: 4 }}
      />
      <Text type="secondary" style={{ fontSize: 11 }}>
        ความแข็งแรง: <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
      </Text>
      <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', fontSize: 12 }}>
        {PASSWORD_RULES.map(r => {
          const ok = r.test(String(value || ''));
          return (
            <li key={r.id} style={{ color: ok ? '#52c41a' : '#8c8c8c', lineHeight: 1.7 }}>
              {ok
                ? <CheckCircleFilled style={{ marginRight: 6 }} />
                : <CloseCircleFilled style={{ marginRight: 6, color: '#bfbfbf' }} />}
              {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
