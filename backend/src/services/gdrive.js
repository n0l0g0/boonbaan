const { google } = require('googleapis');
const fs = require('fs');
const { Readable } = require('stream');
const { query } = require('../config/db');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function generateFileName(prefix, ext) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}_${datePart}_${timePart}_${rand}.${ext}`;
}

async function getGDriveConfig() {
  try {
    const r = await query("SELECT key, value FROM settings WHERE key = ANY($1)", [[
      'gdrive_enabled', 'gdrive_backup_folder_id', 'gdrive_logs_folder_id', 'gdrive_credentials', 'gdrive_refresh_token',
    ]]);
    const s = Object.fromEntries(r.rows.map(row => [row.key, row.value]));

    // Service Account ไม่มี OAuth flow — ถ้า credentials เป็น service_account ให้ enabled เสมอ
    let enabled = s.gdrive_enabled === 'true';
    if (!enabled && s.gdrive_credentials) {
      try {
        const cred = JSON.parse(s.gdrive_credentials);
        if (cred.type === 'service_account') enabled = true;
      } catch { /* invalid JSON */ }
    }

    return {
      enabled,
      backupFolderId: s.gdrive_backup_folder_id || null,
      logsFolderId: s.gdrive_logs_folder_id || null,
      credentials: s.gdrive_credentials || null,
      refreshToken: s.gdrive_refresh_token || null,
    };
  } catch { return { enabled: false }; }
}

function isServiceAccount(credJson) {
  return credJson.type === 'service_account';
}

function isOAuth2Client(credJson) {
  return !!(credJson.web || credJson.installed);
}

function buildOAuth2Client(credJson, redirectUri) {
  const web = credJson.web || credJson.installed;
  const callbackUri = redirectUri || (web.redirect_uris && web.redirect_uris[0]) || '';
  return new google.auth.OAuth2(web.client_id, web.client_secret, callbackUri);
}

async function getDriveClient(type = 'backup') {
  const cfg = await getGDriveConfig();
  if (!cfg.enabled || !cfg.credentials) return null;

  let auth;
  const credJson = JSON.parse(cfg.credentials);

  if (isServiceAccount(credJson)) {
    auth = new google.auth.GoogleAuth({ credentials: credJson, scopes: SCOPES });
  } else if (isOAuth2Client(credJson) && cfg.refreshToken) {
    const oauth2 = buildOAuth2Client(credJson);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    auth = oauth2;
  } else {
    return null;
  }

  const folderId = type === 'logs' ? cfg.logsFolderId : cfg.backupFolderId;
  return { drive: google.drive({ version: 'v3', auth }), folderId };
}

// Generate OAuth2 authorization URL
async function generateAuthUrl(credentialsJson, redirectUri) {
  const credJson = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
  if (!isOAuth2Client(credJson)) throw new Error('ต้องใช้ OAuth2 Web Client credentials');
  const oauth2 = buildOAuth2Client(credJson, redirectUri);
  return oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'select_account consent' });
}

// Exchange authorization code for tokens
async function exchangeCode(credentialsJson, code, redirectUri) {
  const credJson = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
  const oauth2 = buildOAuth2Client(credJson, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

// Test connection (supports both Service Account and OAuth2)
async function testDriveConnection(credentialsJson, folderId, refreshToken) {
  const credJson = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
  let auth;

  if (isServiceAccount(credJson)) {
    auth = new google.auth.GoogleAuth({ credentials: credJson, scopes: SCOPES });
  } else if (isOAuth2Client(credJson) && refreshToken) {
    const oauth2 = buildOAuth2Client(credJson);
    oauth2.setCredentials({ refresh_token: refreshToken });
    auth = oauth2;
  } else if (isOAuth2Client(credJson)) {
    // Not yet authorized — just validate the JSON structure
    const web = credJson.web || credJson.installed;
    return { needsAuth: true, clientId: web.client_id };
  } else {
    throw new Error('รูปแบบ credentials ไม่รองรับ');
  }

  const drive = google.drive({ version: 'v3', auth });
  const q = folderId ? `'${folderId}' in parents and trashed=false` : 'trashed=false';
  const res = await drive.files.list({
    q, pageSize: 5, fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return { ok: true, files: res.data.files || [] };
}

async function uploadFile(content, fileName, mimeType = 'text/plain') {
  const client = await getDriveClient('logs');
  if (!client) throw new Error('Google Drive ยังไม่ได้ตั้งค่า หรือยังไม่ได้ Authorize');
  const { drive, folderId } = client;
  const bodyStream = typeof content === 'string'
    ? Readable.from([Buffer.from(content, 'utf-8')])
    : content;
  const resource = { name: fileName, parents: folderId ? [folderId] : undefined };
  const media = { mimeType, body: bodyStream };
  const res = await drive.files.create({
    resource, media,
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

async function uploadBackup(filePath, fileName) {
  const client = await getDriveClient('backup');
  if (!client) throw new Error('Google Drive not configured');
  const { drive, folderId } = client;
  const media = { mimeType: 'application/octet-stream', body: fs.createReadStream(filePath) };
  const resource = { name: fileName, parents: folderId ? [folderId] : undefined };
  const res = await drive.files.create({
    resource, media,
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

async function listBackupsOnDrive() {
  const client = await getDriveClient('backup');
  if (!client) return [];
  const { drive, folderId } = client;
  const q = folderId ? `'${folderId}' in parents and trashed=false` : "name contains '.backup' and trashed=false";
  const res = await drive.files.list({
    q,
    fields: 'files(id,name,createdTime,size,webViewLink)',
    orderBy: 'createdTime desc',
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

module.exports = {
  uploadBackup, uploadFile, listBackupsOnDrive, testDriveConnection,
  getGDriveConfig, generateAuthUrl, exchangeCode, generateFileName,
};
