const cron = require('node-cron');
const { query } = require('../config/db');
const { notify } = require('../services/notification');
const { createBackupWithUpload } = require('../services/backup.service');

const activeCrons = new Map();

async function runScheduledTask(task) {
  let status = 'success';
  let result = '';
  try {
    if (task.type === 'backup') {
      // Full backup: create on router, download, upload to Google Drive, record history
      const r = await createBackupWithUpload('auto-backup');
      result = r.drive ? `Backup created: ${r.name} (uploaded to Drive)` : `Backup created: ${r.name} (Drive upload failed/disabled)`;
    } else if (task.type === 'reboot') {
      const mk = require('../config/mikrotik').getMikrotikClient();
      await mk.post('/system/reboot', {});
      result = 'Reboot command sent';
    }
    await notify('warning', `Scheduled Task: ${task.name}`, `${result} — ran at ${new Date().toLocaleString()}`);
  } catch (err) {
    status = 'failed';
    result = err.message;
    await notify('critical', `Scheduled Task Failed: ${task.name}`, err.message);
  }
  await query('UPDATE scheduled_tasks SET last_run=NOW(), last_status=$1 WHERE id=$2', [status, task.id]).catch(() => {});
  return result;
}

async function startScheduler() {
  // Stop all existing crons
  for (const [, job] of activeCrons) job.stop();
  activeCrons.clear();

  try {
    const r = await query('SELECT * FROM scheduled_tasks WHERE enabled=true');
    for (const task of r.rows) {
      if (!cron.validate(task.cron_expr)) continue;
      const job = cron.schedule(task.cron_expr, () => runScheduledTask(task), { timezone: 'Asia/Bangkok' });
      activeCrons.set(task.id, job);
    }
    console.log(`Scheduler started: ${r.rows.length} tasks`);
  } catch (err) {
    console.error('Scheduler start failed:', err.message);
  }
}

module.exports = { startScheduler, runScheduledTask };
