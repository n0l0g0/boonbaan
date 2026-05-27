# MikroTik Manager

Web application สำหรับบริหารจัดการ MikroTik RouterOS v7 ผ่าน REST API

## Features

| หมวด | รายละเอียด |
|------|-----------|
| **Dashboard** | CPU, Memory, Disk, Bandwidth real-time |
| **Hotspot Users** | เพิ่ม/ลบ/แก้ไข + profile dropdown จาก MikroTik + auto-refresh 30s |
| **Hotspot Active** | ดู session ที่ online อยู่ + auto-refresh 30s |
| **Password Reset** | ส่งลิงก์รีเซ็ตรหัส Hotspot/VPN ผ่าน Email (token 10 นาที) |
| **VPN** | PPP Secrets (L2TP/PPTP) + active connections + password reset via email |
| **MAC Binding** | จัดการ MAC address binding + ARP table |
| **VLAN** | จัดการ VLAN interface |
| **Web Filter** | Web Proxy access rules (blacklist) |
| **Access Points** | CAPsMAN AP status |
| **Monitor** | Real-time charts + ISP/WAN status (via Socket.io) |
| **Brute-Force** | ตรวจจับและ auto-block IP ที่ login ผิดซ้ำผ่าน MikroTik address-list |
| **Audit Log** | บันทึกทุก password operation (admin/user) |
| **Backup** | สร้าง backup อัตโนมัติ + upload Google Drive |
| **Config** | Interfaces, IP Addresses, DHCP Leases, Routerboard info |
| **Logs** | RouterOS log viewer + threat classifier |
| **Alerts** | Email + Google Chat + LINE เมื่อ CPU/Memory/Disk/Bandwidth เกิน threshold |
| **Notifications** | Google Chat แจ้งเตือน Hotspot Login/Logout + WAN Up/Down |
| **Users** | จัดการ admin/viewer ของ web app + auto-refresh 30s |

## Tech Stack

- **Frontend**: React 18 + Ant Design 5 + Recharts + Socket.io client + Vite
- **Backend**: Node.js + Express + Socket.io + node-cron + PostgreSQL
- **MikroTik**: RouterOS v7 REST API
- **Auth**: JWT + Google OAuth 2.0
- **Deploy**: Docker Compose

## Quick Start (Development)

### 1. Backend
```bash
cd backend
cp .env.example .env        # ⚠️ แก้ไข .env — ห้าม commit ไฟล์นี้ขึ้น git
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env        # แก้ VITE_API_URL ถ้า backend ไม่ได้รันที่ localhost:3001
npm install
npm run dev
```

เปิด http://localhost:5173 แล้ว login ด้วย username/password ที่ตั้งใน `ADMIN_USER` / `ADMIN_PASS`

## Deploy (Docker)

```bash
cp backend/.env.example backend/.env
# แก้ไข backend/.env ให้ครบก่อน deploy

docker compose up -d
```

## Environment Variables

> ⚠️ **สำคัญ**: ไฟล์ `.env` มี credentials ห้าม commit ขึ้น git เด็ดขาด
> ไฟล์นี้อยู่ใน `.gitignore` แล้ว — ใช้ `.env.example` เป็น template เท่านั้น

### Backend (`backend/.env`)

| Variable | ตัวอย่าง | คำอธิบาย |
|---|---|---|
| `MIKROTIK_HOST` | `192.168.88.1` | IP ของ Router |
| `MIKROTIK_PORT` | `443` | Port REST API |
| `MIKROTIK_USER` | `admin` | MikroTik username |
| `MIKROTIK_PASS` | `••••••••` | MikroTik password |
| `MIKROTIK_SSL` | `true` | ใช้ HTTPS |
| `POSTGRES_HOST` | `postgres` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `boonbaan` | Database name |
| `POSTGRES_USER` | `boonbaan` | Database username |
| `POSTGRES_PASS` | `••••••••` | Database password |
| `JWT_SECRET` | *(random string ยาวๆ)* | Secret สำหรับ sign JWT |
| `ADMIN_USER` | `admin` | Username เข้า web app |
| `ADMIN_PASS` | `••••••••` | Password เข้า web app |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | `you@gmail.com` | Email ผู้ส่ง |
| `SMTP_PASS` | `••••••••` | Gmail App Password |
| `ALERT_EMAIL_TO` | `admin@company.com` | Email รับ alert |
| `GOOGLE_CLIENT_ID` | `xxxxx.apps.googleusercontent.com` | Google OAuth Client ID |
| `ALLOWED_EMAIL_DOMAIN` | `company.com` | จำกัด Google login เฉพาะ domain นี้ |
| `GOOGLE_CHAT_WEBHOOK` | `https://chat.googleapis.com/...` | Google Chat Webhook URL |
| `GDRIVE_SERVICE_ACCOUNT_PATH` | `./gdrive-service-account.json` | Path ไฟล์ Service Account |
| `GDRIVE_FOLDER_ID` | `1AbCdEf...` | Google Drive Folder ID |
| `WAN_INTERFACE` | `ether1` | Interface WAN บน MikroTik |
| `WAN_BANDWIDTH_MBPS` | `100` | ความเร็ว WAN (Mbps) |
| `THRESHOLD_WARNING` | `80` | % สำหรับ warning alert |
| `THRESHOLD_CRITICAL` | `90` | % สำหรับ critical alert |

## Google Drive Backup

1. สร้าง Service Account ใน [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Drive API**
3. Download JSON key → วางที่ `backend/gdrive-service-account.json`  
   *(ไฟล์นี้อยู่ใน `.gitignore` แล้ว — ห้าม commit)*
4. Share Google Drive folder กับ email ของ Service Account
5. ใส่ Folder ID ใน `GDRIVE_FOLDER_ID`

## Google Chat Notifications

แจ้งเตือนผ่าน Google Chat ในกรณีต่อไปนี้:
- 🔴 CPU / Memory / Disk / Bandwidth เกิน threshold
- 🔴 WAN Down / 🟡 WAN Up
- 🟢 Hotspot Login / 🔴 Hotspot Logout
- 🚨 Brute-force IP ถูก auto-block

**ตั้งค่า Webhook:**
1. เปิด Google Chat Space → Apps & integrations → Webhooks → Add webhook
2. Copy URL → ใส่ใน Settings → Google Chat Webhook URL

การแจ้งเตือนแต่ละประเภทสามารถเปิด/ปิดได้ในหน้า **Settings** ของ web app

## Security Notes

- ไฟล์ `.env`, `*.pem`, `*client_secret*.json`, `*service_account*.json` อยู่ใน `.gitignore` แล้ว
- หาก credentials หลุดไป git history ให้รีบเปลี่ยนทันที: MikroTik password, DB password, JWT secret, SMTP password, Google OAuth secret
- ใช้ `JWT_SECRET` ที่มีความยาวอย่างน้อย 32 ตัวอักษร และสุ่มขึ้นมา
