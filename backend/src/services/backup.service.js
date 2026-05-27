const os = require('os');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const mikrotik = require('./mikrotik');
const { uploadBackup, generateFileName } = require('./gdrive');
const { query } = require('../config/db');
const { getMikrotikConfig } = require('../config/mikrotik');
const { sendGoogleChat } = require('./notification');

// Create backup on router, download, upload to GDrive, record in history.
// Used by both the manual /backup/create route and the scheduled backup task.
async function createBackupWithUpload(prefix = 'backup') {
  const backupName = generateFileName(prefix, 'backup').replace(/\.backup$/, '');
  try {
    await mikrotik.saveBackup(backupName);

    const cfg = await getMikrotikConfig();
    const agent = new https.Agent({ rejectUnauthorized: false });
    const baseURL = `${cfg.ssl ? 'https' : 'http'}://${cfg.host}:${cfg.port}/rest`;
    const dlRes = await axios.get(`${baseURL}/file/${backupName}.backup`, {
      auth: { username: cfg.user, password: cfg.pass },
      httpsAgent: agent,
      responseType: 'arraybuffer',
    });

    const tmpFile = path.join(os.tmpdir(), `${backupName}.backup`);
    fs.writeFileSync(tmpFile, dlRes.data);

    let driveFile = null;
    try {
      driveFile = await uploadBackup(tmpFile, `${backupName}.backup`);
      if (driveFile) {
        const ts = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
        sendGoogleChat(
          `💾 *Backup อัปโหลดสำเร็จ*\n` +
          `📄 ไฟล์: \`${backupName}.backup\`\n` +
          `🔗 ${driveFile.webViewLink}\n` +
          `🕐 ${ts}`
        ).catch(() => {});
      }
    } catch (e) {
      console.warn('GDrive upload failed:', e.message);
    }
    fs.unlinkSync(tmpFile);

    await query(
      `INSERT INTO backup_history (name, status, drive_file_id, drive_link, type) VALUES ($1, $2, $3, $4, 'backup')`,
      [backupName, 'success', driveFile?.id || null, driveFile?.webViewLink || null]
    ).catch(() => {});

    return { name: backupName, drive: driveFile };
  } catch (err) {
    await query(
      `INSERT INTO backup_history (name, status, error_message, type) VALUES ($1, $2, $3, 'backup')`,
      [backupName, 'failed', err.message]
    ).catch(() => {});
    throw err;
  }
}

module.exports = { createBackupWithUpload };
