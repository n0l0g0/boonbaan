import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine } from 'recharts';

function formatTime(t, mode) {
  const d = new Date(t);
  if (mode === 'realtime') {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  if (mode === 'minute') return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (mode === 'hour') return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (mode === 'day') return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  // legacy fallback
  return d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
      <div style={{ marginBottom: 4, color: '#888' }}>{formatTime(label, mode)}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{p.value} Mbps</strong>
        </div>
      ))}
    </div>
  );
}

// Realtime chart — data is array of { rxBps, txBps, t }
export function RealtimeBandwidthChart({ data }) {
  const formatted = data.map((d, i) => ({
    t: d.t || i,
    rx: +(d.rxBps / 1_000_000).toFixed(2),
    tx: +(d.txBps / 1_000_000).toFixed(2),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={t => formatTime(t, 'realtime')}
          tickCount={6}
          interval="preserveStartEnd"
          style={{ fontSize: 11 }}
          minTickGap={60}
        />
        <YAxis unit=" Mbps" width={70} tickFormatter={v => v.toFixed(1)} />
        <Tooltip content={<CustomTooltip mode="realtime" />} />
        <Legend />
        <Line type="monotone" dataKey="rx" stroke="#1677ff" dot={false} name="Download (RX)" strokeWidth={2} />
        <Line type="monotone" dataKey="tx" stroke="#52c41a" dot={false} name="Upload (TX)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Historical chart — data from DB, array of { t, rx_bps, tx_bps }
export function HistoricalBandwidthChart({ data, bucket, hours }) {
  // bucket from backend: 'minute' | 'hour' | 'day'; fall back to legacy `hours` prop
  const mode = bucket || (hours && hours <= 1 ? 'minute' : 'hour');
  const formatted = data.map(d => ({
    t: new Date(d.t).getTime(),
    rx: +(Number(d.rx_bps) / 1_000_000).toFixed(2),
    tx: +(Number(d.tx_bps) / 1_000_000).toFixed(2),
  }));

  const maxVal = Math.max(...formatted.map(d => Math.max(d.rx, d.tx)), 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['auto', 'auto']}
          tickFormatter={t => formatTime(t, mode)}
          tickCount={8}
          style={{ fontSize: 11 }}
        />
        <YAxis unit=" Mbps" width={70} tickFormatter={v => v.toFixed(1)} />
        <Tooltip content={<CustomTooltip mode={mode} />} />
        <Legend />
        {maxVal > 0 && <ReferenceLine y={maxVal} stroke="#ff4d4f" strokeDasharray="4 4" label={{ value: `Peak ${maxVal} Mbps`, position: 'insideTopRight', fontSize: 11, fill: '#ff4d4f' }} />}
        <Line type="monotone" dataKey="rx" stroke="#1677ff" dot={false} name="Download (RX)" strokeWidth={2} />
        <Line type="monotone" dataKey="tx" stroke="#52c41a" dot={false} name="Upload (TX)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Default export kept for backward compat (realtime)
export default function BandwidthChart({ data }) {
  return <RealtimeBandwidthChart data={data} />;
}
