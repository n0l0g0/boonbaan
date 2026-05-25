const { getLatestStats } = require('../jobs/monitor.cron');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Socket client connected:', socket.id);

    // Send current stats immediately on connect
    const stats = getLatestStats();
    if (stats) socket.emit('monitor:update', stats);

    socket.on('disconnect', () => {
      console.log('Socket client disconnected:', socket.id);
    });
  });
}

module.exports = { registerSocketHandlers };
