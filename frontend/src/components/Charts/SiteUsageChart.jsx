import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const RADIAN = Math.PI / 180;
const FAVICON = domain => `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

function SiteLogo({ domain, size = 20 }) {
  if (!domain) return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 4, background: '#eee' }} />;
  return (
    <img
      src={FAVICON(domain)}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: 'contain', verticalAlign: 'middle', flexShrink: 0 }}
      onError={e => { e.target.style.display = 'none'; }}
    />
  );
}

function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct }) {
  if (pct < 5) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700}>
      {`${pct}%`}
    </text>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 160 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <SiteLogo domain={d.logo} size={22} />
        <strong style={{ fontSize: 14 }}>{d.name}</strong>
      </div>
      <div style={{ color: '#555', fontSize: 13 }}>{d.value.toLocaleString()} DNS entries</div>
      <div style={{ color: d.color, fontWeight: 700, fontSize: 16, marginTop: 2 }}>{d.pct}%</div>
    </div>
  );
}

// Custom legend rendered outside recharts for full logo support
function SiteLegend({ data }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center', marginTop: 12 }}>
      {data.map(d => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <SiteLogo domain={d.logo} size={18} />
          <span style={{ color: '#333' }}>{d.name}</span>
          <span style={{ color: '#aaa', fontSize: 12 }}>({d.pct}%)</span>
        </div>
      ))}
    </div>
  );
}

export default function SiteUsageChart({ data }) {
  if (!data?.length) return null;
  const top = data.slice(0, 9);

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={top}
              cx="50%"
              cy="50%"
              outerRadius={120}
              innerRadius={50}
              dataKey="value"
              labelLine={false}
              label={<CustomLabel />}
              paddingAngle={2}
            >
              {top.map((entry, i) => (
                <Cell key={i} fill={entry.color} stroke="#fff" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center logo overlay — sized to fit innerRadius=50 */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 88, height: 88, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <img src="/logo-192.png" alt="บุญบ้าน" style={{ width: 84, height: 84, objectFit: 'contain' }} />
        </div>
      </div>
      <SiteLegend data={top} />
    </div>
  );
}

export { SiteLogo };
