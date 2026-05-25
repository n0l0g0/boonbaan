const router = require('express').Router();
const auth = require('../middleware/auth');
const mikrotik = require('../services/mikrotik');
const { uploadBackup, listBackupsOnDrive, generateFileName } = require('../services/gdrive');
const { createBackupWithUpload } = require('../services/backup.service');
const { notify } = require('../services/notification');
const { query } = require('../config/db');
const os = require('os');
const path = require('path');
const fs = require('fs');

router.get('/list', auth, async (req, res) => {
  try {
    const [routerFiles, driveFiles, dbHistory] = await Promise.allSettled([
      mikrotik.listBackups(),
      listBackupsOnDrive(),
      query('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 50'),
    ]);
    res.json({
      router: routerFiles.value || [],
      drive: driveFiles.value || [],
      history: dbHistory.value?.rows || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/create', auth, async (req, res) => {
  try {
    const r = await createBackupWithUpload('backup');
    res.json(r);
  } catch (err) {
    await notify('critical', 'Backup Failed', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Export config as .rsc script
router.post('/export', auth, async (req, res) => {
  const exportName = generateFileName('export', 'rsc').replace(/\.rsc$/, '');
  try {
    const { getMikrotikClient } = require('../config/mikrotik');
    const mk = await getMikrotikClient.fromDB();

    // RouterOS v7: POST /export returns config script as text
    const exportRes = await mk.post('/export', {}).then(r => r.data).catch(async () => {
      // fallback: GET /export
      return mk.get('/export').then(r => r.data);
    });

    const scriptContent = typeof exportRes === 'string' ? exportRes : JSON.stringify(exportRes, null, 2);
    const fileName = `${exportName}.rsc`;
    const tmpFile = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(tmpFile, scriptContent, 'utf8');

    let driveFile = null;
    try {
      driveFile = await uploadBackup(tmpFile, fileName);
    } catch (e) {
      console.warn('GDrive export upload failed:', e.message);
    }
    fs.unlinkSync(tmpFile);

    await query(
      `INSERT INTO backup_history (name, status, drive_file_id, drive_link, type) VALUES ($1, $2, $3, $4, 'export')`,
      [exportName, 'success', driveFile?.id || null, driveFile?.webViewLink || null]
    ).catch(() => {});

    res.json({ name: exportName, drive: driveFile, lines: scriptContent.split('\n').length });
  } catch (err) {
    await query(
      `INSERT INTO backup_history (name, status, error_message, type) VALUES ($1, $2, $3, 'export')`,
      [exportName, 'failed', err.message]
    ).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
