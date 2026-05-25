const router = require('express').Router();
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const ExcelJS = require('exceljs');

router.get('/monthly', auth, async (req, res) => {
  const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  try {
    const [bw, alerts, backups, uptimes] = await Promise.all([
      query(`SELECT date_trunc('hour', recorded_at) AS t, ROUND(AVG(rx_bps)) rx_bps, ROUND(AVG(tx_bps)) tx_bps
             FROM bandwidth_history WHERE recorded_at >= $1 AND recorded_at < $2 GROUP BY t ORDER BY t`, [start, end]),
      query(`SELECT * FROM alert_history WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at`, [start, end]),
      query(`SELECT * FROM backup_history WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at`, [start, end]),
      query(`SELECT * FROM uptime_history WHERE recorded_at >= $1 AND recorded_at < $2 ORDER BY recorded_at`, [start, end]),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Boonbaan';

    // Bandwidth sheet
    const bwSheet = wb.addWorksheet('Bandwidth Usage');
    bwSheet.columns = [
      { header: 'Time', key: 't', width: 22 },
      { header: 'RX (Mbps)', key: 'rx', width: 14 },
      { header: 'TX (Mbps)', key: 'tx', width: 14 },
    ];
    bwSheet.getRow(1).font = { bold: true };
    for (const row of bw.rows) {
      bwSheet.addRow({ t: new Date(row.t).toLocaleString('th-TH'), rx: (row.rx_bps / 1e6).toFixed(3), tx: (row.tx_bps / 1e6).toFixed(3) });
    }

    // Alerts sheet
    const alertSheet = wb.addWorksheet('Alerts');
    alertSheet.columns = [
      { header: 'Time', key: 't', width: 22 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Subject', key: 'subject', width: 40 },
      { header: 'Body', key: 'body', width: 60 },
    ];
    alertSheet.getRow(1).font = { bold: true };
    for (const row of alerts.rows) {
      alertSheet.addRow({ t: new Date(row.created_at).toLocaleString('th-TH'), level: row.level, subject: row.subject, body: row.body });
    }

    // Backups sheet
    const backupSheet = wb.addWorksheet('Backups');
    backupSheet.columns = [
      { header: 'Time', key: 't', width: 22 },
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Drive Link', key: 'drive_link', width: 50 },
    ];
    backupSheet.getRow(1).font = { bold: true };
    for (const row of backups.rows) {
      backupSheet.addRow({ t: new Date(row.created_at).toLocaleString('th-TH'), name: row.name, status: row.status, drive_link: row.drive_link || '-' });
    }

    const filename = `report-${year}-${String(month).padStart(2, '0')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
