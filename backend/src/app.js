require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { runMigrations } = require('./config/migrate');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/mac', require('./routes/mac'));
app.use('/api/vlan', require('./routes/vlan'));
app.use('/api/webfilter', require('./routes/webfilter'));
app.use('/api/vpn', require('./routes/vpn'));
app.use('/api/hotspot', require('./routes/hotspot'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/monitor', require('./routes/monitor'));
app.use('/api/config', require('./routes/config'));
app.use('/api/ap', require('./routes/ap'));
app.use('/api/history', require('./routes/history'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/routers', require('./routes/routers'));
app.use('/api/network', require('./routes/network'));
app.use('/api/voucher', require('./routes/voucher'));
app.use('/api/scheduler', require('./routes/scheduler'));
app.use('/api/report', require('./routes/report'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/alerts', require('./routes/alerts'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Socket.io
const { registerSocketHandlers } = require('./socket/monitor.socket');
const { startMonitorCron, setSocketIo } = require('./jobs/monitor.cron');
const { startScheduler } = require('./jobs/scheduler');

setSocketIo(io);
registerSocketHandlers(io);

const PORT = process.env.PORT || 3001;

runMigrations()
  .then(async () => {
    startMonitorCron();
    await startScheduler();
    server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
