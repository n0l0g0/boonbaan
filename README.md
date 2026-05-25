# MikroTik Manager

Web application สำหรับบริหารจัดการ MikroTik RouterOS v7 ผ่าน REST API

## Features
- **Dashboard** — CPU, Memory, Disk, Bandwidth real-time
- **Hotspot Users** — เพิ่ม/ลบ/ดู active users
- **MAC Binding** — จัดการ MAC address binding + ARP table
- **VLAN** — จัดการ VLAN interface
- **Web Filter** — Web Proxy access rules (blacklist)
- **VPN** — PPP Secrets (L2TP/PPTP) + active connections
- **Access Points** — CAPsMAN AP status
- **Monitor** — Real-time charts + ISP status (via Socket.io)
- **Backup** — สร้าง backup อัตโนมัติ + upload Google Drive
- **Config** — Interfaces, IP Addresses, DHCP Leases, Routerboard info
- **Logs** — RouterOS log viewer + filter by topic
- **Alerts** — Email + Google Chat notifications เมื่อ CPU/Memory/Disk/Bandwidth เกิน threshold

## Tech Stack
- **Frontend**: React 18 + Ant Design 5 + Recharts + Socket.io client
- **Backend**: Node.js + Express + Socket.io + node-cron
- **MikroTik**: RouterOS v7 REST API

## Quick Start (Development)

### 1. Backend
```bash
cd backend
cp .env.example .env
# แก้ไข .env ใส่ข้อมูล MikroTik และ credentials
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env
# แก้ VITE_API_URL ถ้า backend ไม่ได้รันที่ localhost:3001
npm install
npm run dev
```

เปิด http://localhost:5173 แล้ว login ด้วย username/password ใน .env

## Deploy (Docker)

```bash
# แก้ docker-compose.yml ใส่ IP ของ VPS
cp backend/.env.example backend/.env
# แก้ไข backend/.env

docker compose up -d
```

## Environment Variables

### Backend (.env)
| Variable | ตัวอย่าง | คำอธิบาย |
|---|---|---|
| MIKROTIK_HOST | 192.168.88.1 | IP ของ Router |
| MIKROTIK_PORT | 443 | Port REST API |
| MIKROTIK_USER | admin | Username |
| MIKROTIK_PASS | password | Password |
| MIKROTIK_SSL | true | ใช้ HTTPS |
| JWT_SECRET | random-string | Secret สำหรับ JWT |
| ADMIN_USER | admin | Username เข้า web app |
| ADMIN_PASS | admin123 | Password เข้า web app |
| SMTP_HOST | smtp.gmail.com | SMTP server |
| SMTP_USER | you@gmail.com | Email |
| SMTP_PASS | app-password | Gmail App Password |
| ALERT_EMAIL_TO | admin@company.com | Email รับ alert |
| GOOGLE_CHAT_WEBHOOK | https://... | Google Chat Webhook URL |
| GDRIVE_SERVICE_ACCOUNT_PATH | ./gdrive-service-account.json | Path ไฟล์ Service Account |
| GDRIVE_FOLDER_ID | folder-id | Google Drive Folder ID |
| WAN_INTERFACE | ether1 | Interface WAN บน MikroTik |
| WAN_BANDWIDTH_MBPS | 100 | ความเร็ว WAN (Mbps) |
| ISP_GATEWAY | 10.1.0.1 | IP gateway ของ ISP สำหรับ ping |
| THRESHOLD_WARNING | 80 | % สำหรับ warning alert |
| THRESHOLD_CRITICAL | 90 | % สำหรับ critical alert |

## Google Drive Setup
1. สร้าง Service Account ใน Google Cloud Console
2. Enable Google Drive API
3. Download JSON key → วางที่ `backend/gdrive-service-account.json`
4. Share Google Drive folder กับ email ของ Service Account
5. ใส่ Folder ID ใน `GDRIVE_FOLDER_ID`

## Google Chat Webhook
1. เปิด Google Chat space
2. Apps & integrations → Webhooks → Add webhook
3. Copy URL → ใส่ใน `GOOGLE_CHAT_WEBHOOK`
