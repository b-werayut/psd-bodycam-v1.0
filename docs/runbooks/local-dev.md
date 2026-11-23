# คู่มือรันระบบบนเครื่อง dev (local)

ช่วง dev ทั้งทีมพัฒนาบนเครื่องตัวเอง (DL63): PostgreSQL + Redis บนเครื่อง, DSS middleware เรียกผ่าน VPN (เริ่มใช้ใน P1), ใบงานจาก Booking ใช้ mock / `booking-simulator` จนกว่าทีม Booking ส่ง spec · ยังไม่ deploy ขึ้น Azure

> ⚠️ ใช้ database ใหม่ของระบบนี้ (`bwc`, `bwc_test`) เท่านั้น **ห้ามชี้ DB ของระบบเดิม** (`internal_bodycam`, `internal_bodycam_test`) — ชื่อตารางและ `drizzle.__drizzle_migrations` ชนกัน และไม่ย้ายข้อมูลจากระบบเดิม (Part 4 §4.7)

## 1. สิ่งที่ต้องมีบนเครื่อง

| อะไร | เวอร์ชัน / หมายเหตุ |
|---|---|
| Node.js + npm | 22 ขึ้นไป (CI และ pipeline ใช้ 22 · เครื่อง dev ใช้ 24 ได้) |
| PostgreSQL | 16 ขึ้นไป ที่ `localhost:5432` (ทีมใช้ 18) — ต้องมี extension `btree_gist` (ติดมากับตัวติดตั้งมาตรฐาน) |
| Redis | 7 ขึ้นไป ที่ `localhost:6379` — ใช้ Docker ก็ได้ (ข้อ 2) |
| VPN ของ PSD | เมื่อเริ่ม P1 (เรียก DSS middleware) |

ไม่มี PostgreSQL บนเครื่อง ใช้ของ Docker แทนได้:

```powershell
docker compose -f docker-compose.dev.yml --profile postgres up -d
```

(PostgreSQL 16 ที่ port **5433** user / password / database = `bwc` — แก้ `DATABASE_URL` ให้ตรง)

## 2. Redis

```powershell
docker compose -f docker-compose.dev.yml up -d
```

หรือถ้ามี container ชื่อ `redis` อยู่แล้ว: `docker start redis` · ตรวจ: `docker exec redis redis-cli ping` ต้องได้ `PONG`

Redis ไม่ขึ้นระบบยังใช้งานได้ (login / refresh นับโควตาในหน่วยความจำ) แต่ `/api/health/redis` ตอบ 503, งานที่ต้องใช้ lock ถูกข้าม และ event จาก worker ไม่ถึงหน้าจอ

## 3. สร้าง role และ database

รันครั้งเดียวด้วย superuser `postgres` (PowerShell):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE ROLE bwc LOGIN CREATEDB PASSWORD 'ตั้งรหัสเอง'"
```

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE bwc OWNER bwc"
```

`bwc_test` ไม่ต้องสร้างเอง — `npm run db:prepare:test` สร้างให้ (role ต้องมีสิทธิ์ `CREATEDB`)

## 4. ตั้งค่า env

```powershell
Copy-Item server\.env.example server\.env
```

แก้ใน `server/.env` อย่างน้อย:

- `DATABASE_URL` / `DATABASE_URL_TEST` — ใส่รหัสของ role `bwc` (อักขระพิเศษต้อง URL-encode เช่น `@` → `%40`)
- `JWT_ACCESS_SECRET` — ค่าสุ่มอย่างน้อย 32 ตัว เช่นจาก `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `BOOKING_INBOUND_SECRETS` — ค่าสุ่มสำหรับ `booking-simulator` (ใช้ตั้งแต่ P3a)
- `AZURE_AD_*` เว้นว่างไว้ได้ (ข้อ 8) · `GRAPH_*` ใส่เมื่อจะใช้หน้า ผู้ใช้จาก Entra

`client/.env` ไม่ต้องมี — Vite proxy `/api` และ `/socket.io` ไปที่ `http://localhost:3000` ให้แล้ว (`client/vite.config.ts`)

## 5. ติดตั้ง, สร้างตาราง, ใส่ข้อมูลตั้งต้น

```powershell
cd server
npm install
npm run db:migrate
npm run db:seed
npm run db:prepare:test
```

- `db:migrate` สร้างตารางและข้อมูลอ้างอิง (role 4 ตัว, permission 24 ตัว, setting การล็อกบัญชี) — รันซ้ำได้ผลเดิม
- `db:seed` สร้างบัญชีทดสอบและพนักงาน 2 คน (ใช้บนเครื่อง dev เท่านั้น · รันซ้ำ = รีเซ็ตรหัสผ่านและปลดล็อกบัญชีทดสอบ)
- `db:prepare:test` สร้าง `bwc_test` + migrate สำหรับ integration test
- ตรวจหลัง `db:migrate`: ถ้า log ไม่ขึ้น `migrations applied successfully` ให้รันซ้ำอีกครั้ง (เคยเจอ drizzle-kit จบเงียบ ๆ โดยไม่สร้างตารางในรอบแรก)

เช่นเดียวกันที่ `client/`: `npm install`

## 6. รันระบบ

เปิด 3 terminal:

```powershell
cd server; npm run start:api:dev
```

```powershell
cd server; npm run start:worker:dev
```

```powershell
cd client; npm run dev
```

ตอน api / worker เริ่ม ระบบตรวจว่า migration ลงครบ — log `schema ตรงกับ image (ลงแล้ว N migration จาก N ไฟล์)` · ถ้าค้างจะไม่ยอมสตาร์ต (แก้ด้วย `npm run db:migrate`)

ใน Claude Code (desktop) ใช้ preview `api` และ `client` จาก `.claude/launch.json` แทนได้

## 7. เข้าใช้งาน

| อะไร | ที่อยู่ |
|---|---|
| หน้าเว็บ | http://localhost:5173 |
| Swagger UI | http://localhost:3000/api/docs (JSON: `/api/docs-json`) — กด Authorize แล้วใส่ `accessToken` จาก `POST /api/auth/login` |
| Health | `/api/health` · `/api/health/db` · `/api/health/redis` (ปกติตอบ `{ "status": "ok" }`, ล่มตอบ 503) |

บัญชีทดสอบจาก `db:seed`:

| ชื่อผู้ใช้ | บทบาท | รหัสผ่าน |
|---|---|---|
| `admin` | ผู้ดูแลระบบ | `SEED_ADMIN_PASSWORD` (ไม่ตั้ง = `Admin@12345`) |
| `companyadmin1` | ผู้ดูแลบริษัท | `SEED_DEMO_PASSWORD` (ไม่ตั้ง = `Demo@12345`) |
| `operator1` | ผู้ปฏิบัติการ | เหมือนข้างบน |
| `viewer1` | ผู้ดูข้อมูล | เหมือนข้างบน |

ใส่รหัสผ่านผิด 3 ครั้งบัญชีจะถูกล็อก 15 นาที (DL65 · ปรับได้ที่หน้า ตั้งค่าระบบ ด้วยบัญชี `admin`)

## 8. เข้าสู่ระบบด้วย Microsoft (Entra SSO) บนเครื่อง

ตอนนี้ app registration ฝั่ง dev ลงทะเบียน redirect URI เฉพาะโดเมนที่ deploy อยู่ จึงใช้ชื่อผู้ใช้ + รหัสผ่านไปก่อน (DL65) · เมื่อจะทดสอบ SSO บนเครื่อง:

1. Azure Portal → App registrations → แอป SSO ของระบบ → Authentication → เพิ่ม platform **Single-page application** redirect URI `http://localhost:5173`
2. ใส่ `AZURE_AD_TENANT_ID` และ `AZURE_AD_CLIENT_ID` ใน `server/.env` แล้ว restart api — หน้า login จะแสดงปุ่ม เข้าสู่ระบบด้วยบัญชีองค์กร
3. ต้องมีบัญชีในระบบก่อน (ระบบไม่สร้างบัญชีให้อัตโนมัติ): สร้างผู้ใช้ที่หน้า ผู้ใช้ระบบ โดยใส่ **อีเมลให้ตรงกับบัญชี Microsoft (UPN)** หรือใช้หน้า ผู้ใช้จาก Entra — เข้าครั้งแรกระบบจะผูกบัญชี Microsoft ให้ ครั้งต่อไปจับคู่ด้วยบัญชีที่ผูกแล้ว
4. ไม่ตรงกับบัญชีใด = `SSO_ACCOUNT_NOT_FOUND` · บัญชีถูกระงับ = `ACCOUNT_DISABLED` · บัญชีที่ถูกล็อกเพราะรหัสผิดยังเข้าด้วย Microsoft ได้และถูกปลดล็อก

## 9. กล้อง: simulator หรือ DSS จริงผ่าน VPN (P1)

worker role `tracking` (`WORKER_ROLES` ไม่ตั้ง = ทุก role) รัน 3 งาน: DeviceSync (ตอนเริ่ม + ทุกชั่วโมง) → ตาราง `Devices`, GpsPoll (ทุก `gps.poll-interval-seconds` = 15 วินาที) → สถานะ + พิกัด, PartitionMaintenance (ตอนเริ่ม + ทุกวัน) → partition เดือนถัดไปของ `GpsLocations` / `AuditLogs` · งานทั้งหมดใช้ lock ใน Redis — Redis ไม่ขึ้นงานจะถูกข้าม

**Simulator (ค่าเริ่มต้น — ไม่ต้องต่อ VPN)**: `DSS_DRIVER=mock` ใน `server/.env` ⇒ กล้องจำลอง `SIM-0001`…`SIM-0100` (`DSS_MOCK_DEVICES`) เดินเป็นวงรอบจุดของตัวเองทั่วกรุงเทพ · ทุกตัวที่ 10 ออฟไลน์ · ทุกตัวที่ 7 (ที่ไม่ใช่ตัวที่ 10) ออนไลน์แต่ไม่มีพิกัด (เหมือนอยู่ในอาคาร)

```powershell
cd server; npm run start:worker:dev
```

log ที่ควรเห็น: `DeviceSync: {"created":100,…}` แล้ว `GpsPoll: ถาม 100 กล้อง | ได้สถานะ 100 | ได้พิกัด 77 …` ทุก ~15 วินาที → เปิด http://localhost:5173/tracking (บัญชี `operator1`) จะเห็นกล้อง 100 ตัว หมุดขยับเองโดยไม่ต้อง refresh และกดการ์ดกล้อง → ประวัติเส้นทาง ได้

**DSS จริงผ่าน VPN**: ต่อ VPN ของ PSD แล้วตั้งใน `server/.env` (อย่าส่งค่าเหล่านี้ทางแชตหรือ commit)

- `DSS_DRIVER=dss`
- `DSS_BASE_URL` = host:port ของ `psd-bwc-dss-services` (ไม่ต้องมี `/api/v1`)
- `DSS_API_KEY` = ค่าเดียวกับ `API_SECRET_KEY` ใน `.env` ของ `psd-bwc-dss-services`

แล้ว restart api + worker · ระบบเซ็น JWT อายุ 60 วินาทีใหม่ทุกคำขอ ⇒ นาฬิกาเครื่องเรากับเครื่อง DSS ต้องคลาดกันไม่เกิน 30 วินาที (ไม่งั้นได้ 401 ทุกคำขอ) · กล้องที่ชนิดไม่ใช่ bodycam (ชื่อชนิด / รุ่น / ชื่อไม่มีคำว่า body cam หรือ MPT) จะถูกข้ามและมี log `DeviceSync ข้าม …`

ไม่อยากให้ worker บนเครื่องยิง DSS: `GPS_POLL_ENABLED=false` · กล้องจำลองที่ค้างใน DB เมื่อเปลี่ยนเป็น DSS จริงจะถูกตั้ง `VendorMissingSince` + alert 13 (ระบบไม่ลบกล้อง) — ล้าง DB ใหม่ได้ตามข้อ 11 ช่วง dev

แผนที่ใช้ tile ของ OpenStreetMap สาธารณะเมื่อไม่ตั้ง `VITE_MAP_TILE_URL` ใน `client/.env` — ใช้ได้เฉพาะ dev

## 10. ทดสอบ

```powershell
cd server; npm run ci
```

(= lint + typecheck + unit + integration · integration ต้องมี PostgreSQL + Redis และ `bwc_test`) · ฝั่ง client: `npm run lint`, `npm run typecheck`, `npm test`

## 11. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `password authentication failed for user "bwc"` | role ยังไม่ถูกสร้าง หรือรหัสใน `DATABASE_URL` ไม่ตรง (ข้อ 3, 4) |
| api / worker ไม่สตาร์ต พร้อม log ว่า migration ค้าง | `npm run db:migrate` · ชั่วคราวตั้ง `DB_MIGRATION_CHECK=warn` ได้ แต่ schema ที่ไม่ตรงจะกลายเป็น 500 |
| integration test บอกว่าชื่อ database ต้องลงท้าย `_test` | `DATABASE_URL_TEST` ชี้ DB ผิด — ต้องเป็น `bwc_test` |
| login ไม่ได้ ขึ้นว่าบัญชีถูกล็อก | รอ 15 นาที · หรือ `admin` กด คืนสิทธิ์ ที่หน้า ผู้ใช้ระบบ · หรือ `npm run db:seed` (บัญชีทดสอบ) |
| `/api/health/redis` ตอบ 503 | Redis ไม่ขึ้น (ข้อ 2) — ระบบยัง login ได้ |
| หน้าเว็บไม่เด้งออกทันทีเมื่อถูกระงับ | socket ต่อไม่ติด — ตรวจว่า api รันอยู่และ Vite proxy `/socket.io` ไปถึง port 3000 |
| อยากล้าง DB เริ่มใหม่ | ช่วง dev ข้อมูลทิ้งได้ (DL50): `DROP DATABASE bwc` / `bwc_test` → `CREATE DATABASE bwc OWNER bwc` → ทำข้อ 5 ใหม่ |
| หน้าเว็บยังเป็นโค้ดเก่าหลังแก้ไฟล์ (เช่นเรียกฟังก์ชันใหม่แล้ว `is not a function`) | file watcher ของ Vite บน Windows พลาดการแก้ไขบางครั้ง — หยุดแล้วรัน `npm run dev` ใหม่ใน `client/` แล้ว refresh หน้า |
| worker log `DSS ตอบ 401` ทุกกล้อง | `DSS_API_KEY` ไม่ตรงกับ `API_SECRET_KEY` ของ `psd-bwc-dss-services` หรือนาฬิกาสองเครื่องคลาดกันเกิน 30 วินาที (ข้อ 9) |
| worker log `เรียก DSS ที่ … ไม่สำเร็จ (ETIMEDOUT …)` | ยังไม่ได้ต่อ VPN หรือ `DSS_BASE_URL` ผิด — ใช้ `DSS_DRIVER=mock` ไปก่อนได้ |
| แผนที่ติดตาม ไม่มีกล้องเลย | worker ไม่ได้รัน (DeviceSync สร้างกล้องตอน worker เริ่ม) หรือ Redis ไม่ขึ้น (งานถูกข้ามเพราะไม่มี lock) |
