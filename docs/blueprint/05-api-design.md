# Part 5 — API Design

---

## 5.1 Conventions

| หัวข้อ | กติกา | ต่างจาก reference |
|---|---|---|
| Prefix | `/api/*` (ไม่มี version ใน path · breaking change ใช้ header `X-API-Version` เมื่อจำเป็น) | เหมือนเดิม |
| Docs | Swagger `/api/docs`, `/api/docs-json` (ห้าม `addServer('/api')`) | เหมือนเดิม |
| JSON key | **camelCase ทุก response** (map จาก PascalCase ของ DB ที่ repository/DTO) | reference ปน PascalCase (CRUD) กับ camelCase (view model) |
| ID | bigint ส่งเป็น **string** | เหมือนเดิม |
| เวลา | ISO 8601 UTC (`2026-11-03T01:15:00.000Z`) · client แสดงผล Asia/Bangkok | เหมือนเดิม |
| List envelope | `{ data, page, pageSize, total }` · `pageSize` สูงสุด 100 · lookup ไม่แบ่งหน้า `{ data, total }` | เหมือนเดิม |
| Filter | query string · ช่วงเวลา `from` / `to` · ค้นหา `q` · หลายค่า `status=1,2` | |
| Concurrency | action ที่แก้ WO ต้องส่ง `If-Match: <rowVersion>` · ไม่ตรง ⇒ **412** | ใหม่ |
| Idempotency | POST ที่เปลี่ยนสถานะรับ `Idempotency-Key` (optional) — ส่งซ้ำได้ผลเดิม 24 ชม. | ใหม่ |
| Correlation | รับ/คืน `X-Correlation-Id` ทุก request | ใหม่ |
| Error | `{ statusCode, code, message, details?, correlationId }` · `message` ภาษาไทย · `code` คงที่สำหรับโปรแกรม | reference ใช้ default ของ Nest |
| Inbound จาก Smart Booking | `POST /integration/booking/jobs` ไม่ใช้ JWT — `@Public()` + `BookingInboundAuthGuard` (HMAC / api-key) · กันซ้ำด้วย `ExternalEventId` ของ `IntegrationInbox` (ไม่ใช้ `Idempotency-Key`) · ใช้ error format เดียวกัน (DL46 · §5.3) | ใหม่ |

### ความหมายของ status code

| Code | ใช้เมื่อ |
|---|---|
| 400 | validation / ค่าไม่ถูกต้องตามกติกาธุรกิจ (เช่น ขอ playback ช่วงเกิน 24 ชม.) · `VALIDATION_FAILED` เมื่อ body ที่ Smart Booking POST มาขาด field บังคับ (DL46) · **`PERMISSION_RESERVED_FOR_ADMIN`** = ให้ permission สงวนของ `ADMIN` กับ role อื่น (DL51 · §5.7) |
| 401 / 403 | ไม่ได้ login / ไม่มี permission · **`INBOUND_AUTH_FAILED` (401)** = ลายเซ็น HMAC / api-key / IP ของ Smart Booking ไม่ผ่านที่ `POST /integration/booking/jobs` (DL46) · **`ADMIN_ACCOUNT_PROTECTED` (403)** = ผู้ใช้ที่ไม่ใช่ `ADMIN` กำหนด role `ADMIN` (สร้าง / แก้ผู้ใช้ / สร้างจาก Entra — DL51) · บัญชี `ADMIN` เองถูกซ่อนจากผู้ใช้ที่ไม่ใช่ `ADMIN` ⇒ 404 (DL55) |
| **404** | ไม่พบ **หรืออยู่นอก data scope** (ไม่ยืนยันว่ามี record — กติกาเดิม) |
| 409 | สถานะหรือข้อมูลขัดกัน · ใบงานไม่มี action เปลี่ยนสถานะ เพราะสถานะตาม Booking เท่านั้น (DL33) · **`INTEGRATION_READ_API_DISABLED`** = เรียก refresh รายใบ / full reconcile ขณะไม่มี read API (`BOOKING_PROVIDER_DRIVER=none` — DL46) |
| 412 | `If-Match` ไม่ตรง `RowVersion` |
| 413 / 415 | body ใหญ่เกิน (inbound จาก Smart Booking ≤ 256 KB) / `Content-Type` ไม่ใช่ `application/json` (DL46) |
| 429 | rate limit / เกินโควตาสตรีม (มี `Retry-After`) |
| 503 | ระบบภายนอกไม่พร้อม (`BOOKING_UNAVAILABLE` — read API ของ Smart Booking, `VENDOR_UNAVAILABLE`) · `SERVICE_UNAVAILABLE` = ฐานข้อมูลของเราไม่พร้อมตอนรับ POST จาก Smart Booking (ให้ Booking retry — DL46) |

---

## 5.2 Endpoint Catalog

> คอลัมน์ Permission = ต้องมีทุกตัวที่ระบุ · ทุก endpoint ใช้ data scope ตาม role — `all` (ทุก role web: `ADMIN`, `COMPANY_ADMIN`, `OPERATOR`, `VIEWER` — ไม่มีแผนก DL53) / `team` (`TEAM_LEADER` — DL47) (Part 2 §2.8) · ✱ = port จาก reference · endpoint ที่ไม่มีหน้าจอเรียกแล้วตัดออกตาม DL53 (แผนก, ทีม, ฐาน, แก้ไข / sync กล้อง, tracking sessions, หน้า integration, `/booking-jobs`)

### Auth & Account ✱

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/auth/config` | Public | flags SSO/password |
| POST | `/auth/login` | Public | `{ username, password }` · rate limit |
| POST | `/auth/azure` | Public | `{ idToken }` |
| POST | `/auth/refresh` | Public | cookie (web) หรือ body (mobile) |
| POST | `/auth/logout` | Public | ใช้ refresh token |
| GET | `/auth/me` | login | user + role + permissions · web เห็น role `TEAM_LEADER` ⇒ เปิดหน้า "ใช้งานผ่านแอปมือถือ" (DL47) |
| POST | `/auth/change-password` | login | |
| GET / PATCH / DELETE | `/auth/devices[/:id]` | login | ทะเบียนเครื่องของตัวเอง (`deviceName`, `pushEnabled`) — **ไม่มี PIN** |

### Users, Roles, Employees

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/users` | `users:read` / `users:manage` · GET ของผู้ที่ไม่ใช่ `ADMIN` ไม่คืนบัญชี role `ADMIN` (DL55) · POST `roleCode = ADMIN` โดยผู้ที่ไม่ใช่ `ADMIN` ⇒ 403 `ADMIN_ACCOUNT_PROTECTED` (DL51) · หน้า ผู้ใช้จาก Entra สร้างบัญชีจากแถว Entra ผ่าน POST นี้ (ทีละรายการ หรือหลายรายการ ≤ 50 ด้วยบทบาทเดียวกัน — DL53) |
| GET / PATCH / DELETE | `/users/:id` | `users:read` / `users:manage` · ผู้ที่ไม่ใช่ `ADMIN`: เป้าหมายเป็นบัญชี `ADMIN` ⇒ 404 (ซ่อน — DL55) · เปลี่ยน role เป็น `ADMIN` ⇒ 403 `ADMIN_ACCOUNT_PROTECTED` · list / detail คืน `availableActions` ต่อแถว (`edit`, `suspend`, `restore`, `delete`) ให้ UI ซ่อนปุ่มระงับ / ลบของบัญชีตัวเอง |
| PATCH | `/users/:id/access` | `users:manage` ✱ ระงับ/คืนสิทธิ์ (ตัด session ทันที) · กติกาบัญชี `ADMIN` เดียวกับแถวบน |
| GET | `/roles`, `/roles/:id/permissions` | `users:read` · ผู้ที่ไม่ใช่ `ADMIN` ไม่เห็น role `ADMIN` ใน `/roles` (DL55) · `/roles` คืน `reservedPermissions` (permission สงวนของ `ADMIN` — ช่องที่ matrix ต้องล็อก · DL51) · `COMPANY_ADMIN` ใช้ดู matrix แบบอ่านอย่างเดียว |
| PUT | `/roles/:id/permissions` | `roles:manage` (`ADMIN` เท่านั้น) · ใส่ permission สงวนให้ role ที่ไม่ใช่ `ADMIN` ⇒ 400 `PERMISSION_RESERVED_FOR_ADMIN` (DL51) |
| GET | `/users/entra-directory` | `users:manage` ✱ · รายชื่อผู้ใช้จาก Microsoft Graph เทียบกับบัญชีในระบบ (= `sync-entra` แบบ dry run) · สถานะต่อแถว `update` / `keptLocal` / `linked` / `missing` (ยังไม่มีบัญชี — สร้างได้) / `conflict` (DL53) |
| POST | `/users/sync-entra` | `users:manage` ✱ · `{ dryRun, matchByUsername? }` · จับคู่บัญชีด้วย `AzureObjectId` → email = UPN (→ username = ส่วนหน้า `@` ของ UPN สำหรับบัญชีที่ไม่มี email เมื่อ `matchByUsername`) แล้วผูก `AzureObjectId` + เติม email / ชื่อเฉพาะช่องที่ยังว่าง · `dryRun` (default true) = คืนแผนอย่างเดียว · ไม่สร้างบัญชีเอง (DL53) |
| GET / POST / PATCH / DELETE | `/employees[/:id]` | `org:read` / `org:manage` · body มี `bookingEmployeeRef` (ใช้ map หัวหน้าทีมจากใบงาน — DL53) |

ไม่มี endpoint แผนก (ไม่มีแผนก) และทีม (ทีม / หัวหน้าทีมสร้างจากใบงาน Booking — Part 7 §7.5.2) ตาม DL53 · `entra-directory` / `sync-entra` เรียก Microsoft Graph ด้วย app registration แยกจากแอป SSO (env `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` · application permission `User.Read.All` + admin consent · กรองโดเมนด้วย `GRAPH_ALLOWED_DOMAINS` — แบบ reference) · ไม่ได้ตั้ง ⇒ 400 พร้อมข้อความบอก env ที่ขาด

### Devices

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/devices` | `devices:read` | filter `status`, `kind`, `teamId`, `online`, `q` · รวม state ปัจจุบัน + ทีมปัจจุบัน · ใช้โดย ภาพสดหลายจอ, ประวัติเส้นทาง (เลือกกล้อง), แอปหัวหน้าทีม |

อุปกรณ์มาจาก DSS อัตโนมัติ (job `DeviceSync` ใน worker — DL53) · ไม่มี endpoint แก้ไข / sync ด้วยมือ / ปลดระวาง / ตั้งสิทธิ์ดูภาพต่อเครื่อง / ฐาน (`/depots`) / ประวัติสถานะ / ประวัติผูกทีม

**สถานะกล้องบนหน้าจอ (DL35):** สถานะ platform (online / offline) ใน `GET /devices` และคอลัมน์กล้องของ `GET /work-orders` — `api` ดึงจาก DSS ผ่าน DSS middleware ตอน request · ภาพสดหลายจอ, หน้า ใบงาน และก่อนเปิด live เรียกตอนเปิดหน้า · ไม่มี push `device:status` ทาง Socket.IO (`DeviceState` ยังอัปเดตโดย GpsPoll และใช้ภายใน session engine)
- **cache (DL45)**: ผลจาก DSS เก็บใน Redis key `device-status:{deviceId}` อายุ `status.display-cache-seconds` (10s) ใช้ร่วมทุก api pod · ถาม DSS เฉพาะกล้องที่ไม่มีใน cache · Redis ล่ม ⇒ ถาม DSS ตรง (fail-open)
- ทุกอุปกรณ์ใน response มี `platformStatusFetchedAt` = เวลาที่ได้สถานะจาก DSS (ค่าจาก cache เก่าได้ ≤ 10s) ให้หน้าจอแสดงว่าอัปเดตเมื่อไร
- `platformState` ใน view model = `"online" | "offline" | "unknown"` (unknown คำนวณที่ server จาก `LastObservedAt`)

### Tracking

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/tracking/positions` | `tracking:view` ✱ | snapshot ทุกอุปกรณ์ใน scope |
| GET | `/tracking/devices/:id/history?from&to` | `tracking:history` ✱ | polyline segments + stops (ไม่มี road-match) · ช่วง ≤ 24 ชม. |

Session อ่านอย่างเดียว — ผูกกับใบงานโดย matching อัตโนมัติเท่านั้น · ไม่มี endpoint รายการ session (ไม่มีหน้า Tracking sessions — DL53) · session ของใบงานดูผ่าน `/work-orders/:id/sessions` · session ที่ยังไม่มีใบงาน (`AwaitingMatch` / `NoTeam`) รอข้อมูล Booking — ไม่มีหน้าค้นวิดีโอย้อนหลังรายกล้อง ดูได้เฉพาะภาพสดเมื่อกล้องออนไลน์ (DL53) · ไม่มี attach / classify ด้วยมือ (DL33)

### Work Orders

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/work-orders` | `work-orders:read` | ตารางของหน้า ใบงาน และ วิดีโอย้อนหลัง (`checkedIn=true` = เฉพาะใบที่ check-in แล้ว — DL53) · filter `status`, `teamId`, `needsReview`, `checkedIn`, `from`, `to`, `q` (เลข WO / เลข Booking / เลข DO / เลข SH / ชื่อทีม — DL46) · แต่ละแถวมี `workWindow` + `booking.siteName` + `cameras[]` (กล้องจาก sessions + `DeviceRefs` พร้อม `platformState` จาก cache สถานะกล้อง DL45 — ใช้แสดงปุ่ม ดูสด) |
| GET | `/work-orders/by-booking/:externalJobId` | `work-orders:read` | deep link จาก Booking app (Part 7 §7.9 — ผู้ใช้ web เท่านั้น) → `{ id }` · ไม่พบ / นอก scope = 404 |
| GET | `/work-orders/:id` | `work-orders:read` | detail + booking + team + summary |
| GET | `/work-orders/:id/sessions` | `work-orders:read` | ใช้เลือกกล้อง + ช่วงเวลาใน dialog ดูวิดีโอ (หน้า ใบงาน / วิดีโอย้อนหลัง / รายละเอียดใบงาน — DL36, DL53) |
| GET | `/work-orders/:id/events` | `work-orders:read` | timeline |
| GET | `/work-orders/:id/match-attempts` | `work-orders:read` | |
| PATCH | `/work-orders/:id` | `work-orders:edit-note` | `{ note }` + `If-Match` (แก้ได้แค่หมายเหตุ) |

ใบงานสร้างและอัปเดตจากข้อมูลที่ Smart Booking POST เข้ามาเท่านั้น (ผ่าน inbox processor · 1:1 กับ `BookingJobs` · DL46) — ไม่มี endpoint link / unlink / void / review queue (DL33) · `needsReview` + `reviewReasons` เป็นป้ายข้อมูลเท่านั้น

### Booking & Integration

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| POST | `/integration/booking/jobs` | Booking (HMAC) — `@Public()` + `BookingInboundAuthGuard` (ไม่ใช้ JWT / user permission) | **รับใบงานที่ Smart Booking POST เข้ามา** (DL46) · upsert ทั้ง snapshot ผ่าน `IntegrationInbox` (`Channel = 1 Push`) · 202 accepted / 200 duplicate · rate-limit group `booking-inbound` (600 req/min) · body ≤ 256 KB · `@Audit` ลง `IntegrationCallLogs` (`Direction = 2 Inbound`) · contract ดู §5.3 |
| POST | `/booking-jobs/:id/refresh` | `booking:refresh` | `fetchJob` สดจาก read API (timeout 5s · 503 `BOOKING_UNAVAILABLE` ถ้าไม่ได้) · **ใช้ได้เฉพาะเมื่อมี read API** (`BOOKING_PROVIDER_DRIVER ≠ none`) ไม่งั้น 409 `INTEGRATION_READ_API_DISABLED` และไม่อยู่ใน `availableActions` (DL46) |

- ข้อมูล Booking ของใบงาน (รวม `doNo` / `shNo`) มากับ `GET /work-orders/:id` · ไม่มี `GET /booking-jobs` (list / detail) และไม่มีปุ่ม "ดูข้อมูลดิบ" (`raw`) — ไม่มีหน้า `/booking-jobs` และไม่มี permission `integration:view` แล้ว (DL52, DL53)
- **ไม่มีหน้า / endpoint ดูแล integration ในระยะแรก** (ตัด `/integration/status`, `/integration/inbox`, `/integration/call-logs`, `/integration/booking/sync`, `/integration/mapping-issues` พร้อม `integration:view` / `integration:manage` — DL53): สถานะการเชื่อมต่อแจ้งด้วย alert ถึง `ADMIN` (10, 11, 12, 17 — §5.6) + แถบ stale จาก Socket.IO `integration:status` · inbox retry อัตโนมัติด้วย retry sweep · แถว `Dead` ประมวลผลใหม่อัตโนมัติ (`re-resolve` / รายวัน) หรือจากปุ่มบนการแจ้งเตือน → `POST /integration/inbox/:id/retry` (`settings:manage` — `ADMIN` · DL54) · full reconcile รันตามรอบเองเมื่อมี read API (Part 7 §7.5.4)

read API ของ Smart Booking (`fetchJob` / `fetchWindow`) มีหรือไม่ = **[Assumption]** — ถ้าไม่มี ใบงานที่ POST หายจะกลับมาได้เมื่อ Smart Booking ส่งซ้ำเท่านั้น (Part 7)

### Media ✱

| Method | Path | Permission |
|---|---|---|
| POST | `/streams/live` `{ deviceCode }` | `streaming:view-live` |
| POST | `/streams/playback` `{ deviceCode, startAt, endAt }` (≤ 24 ชม.) | `playback:view` |
| GET | `/streams/:token/playlist.m3u8`, `/streams/:token/segment` | Public (sealed token) |
| POST | `/streams/:token/stop` · GET `/streams/sessions` | `streaming:view-live` |
| GET | `/streams/recordings?deviceId&from&to` · `?workOrderId=` | `playback:view` · ใช้ใน dialog ดูวิดีโอของใบงาน (หน้า ใบงาน / วิดีโอย้อนหลัง / รายละเอียดใบงาน) ซึ่งติดป้าย "อยู่ในช่วงใบงาน" ให้ไฟล์ที่ทับ `workWindow` (DL52) · ไม่มีหน้าค้นรายกล้อง (DL53) |
| GET / PATCH | `/streams/role-access` | `roles:manage` |
| GET | `/evidence-exports/policy` · POST `/evidence-exports` · GET `/evidence-exports/:id` | `evidence:export` |
| POST | `/evidence-exports/:id/download-ticket` · GET `/evidence-exports/download?ticket=` | `evidence:download` / Public (ticket) |
| POST | `/talk/sessions` `{ streamSessionToken }` · WS `/api/talk/ws?ticket=` | `streaming:talk` |

`POST /evidence-exports` ใช้ job เดิมเมื่อ device + channel + start/end ตรงกันพอดีและ job ยัง `Queued` / `Processing` / `Ready` ที่ยังไม่หมดอายุ — ไม่งั้นสร้าง job ใหม่ (port `evidence-export-rules.ts` · ใช้จาก dialog ดูวิดีโอของใบงาน — DL36, DL53)

`TEAM_LEADER` ใช้ได้เฉพาะ `POST /streams/live` (+ `/streams/:token/stop` ของตัวเอง) กับกล้องใน scope `team` — ไม่มี playback / export / talk / live wall (DL47 · §5.4)

### Notifications, Dashboard, System

| Method | Path | Permission |
|---|---|---|
| GET | `/notifications`, `/notifications/unread-count` · PATCH `/notifications/:id/read` · POST `/notifications/read-all` | `notifications:read` ✱ |
| POST / GET / DELETE | `/notifications/push-tokens[/:token]` | `notifications:read` ✱ |
| GET | `/alerts` · POST `/alerts/:id/ack` · `/alerts/:id/resolve` | `alerts:view` / `alerts:manage` |
| GET | `/dashboard/overview` | `dashboard:view` |
| GET | `/audit-logs` | `audit:view` ✱ |
| GET / PATCH | `/settings`, `/settings/:key` | `settings:manage` ✱ |
| GET | `/health`, `/health/db`, `/health/redis`, `/health/integrations` | Public (ข้อมูลน้อย) / internal |
| GET | `/metrics` | internal network only |

---

## 5.3 Request / Response Examples

### GET `/api/work-orders?status=1&teamId=7&page=1&pageSize=20`

```json
{
  "data": [
    {
      "id": "1042",
      "workOrderNo": "WO-202611-00042",
      "title": "ติดตั้งกล้องวงจรปิด อาคาร B",
      "status": 1,
      "needsReview": false,
      "team": { "id": "7", "code": "TEAM-07", "name": "ทีมติดตั้ง 7" },
      "leader": { "id": "315", "name": "สมชาย ใจดี" },
      "booking": { "id": "8801", "externalJobNo": "BK-2611-0193", "doNo": "DO-6911-0042", "shNo": "SH-6911-0107", "plannedStartAt": "2026-11-03T02:00:00.000Z", "siteName": "อาคาร B" },
      "workWindow": { "from": "2026-11-03T01:58:40.000Z", "to": null },
      "openedAt": "2026-11-03T00:41:12.000Z",
      "lastActivityAt": "2026-11-03T03:10:00.000Z",
      "openSessionCount": 1,
      "cameras": [
        { "deviceId": "31", "deviceCode": "BWC-0031", "platformState": "online", "fromSession": true },
        { "deviceId": "90", "deviceCode": "BWC-0090", "platformState": "offline", "fromSession": false }
      ],
      "rowVersion": 3
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

`cameras` = กล้องจาก sessions ของใบงาน (`fromSession: true`) + กล้องใน `DeviceRefs` ที่ยังไม่มี session · `platformState` อ่านจาก cache สถานะกล้อง (DL45) — หน้า ใบงาน แสดงปุ่ม ดูสด เมื่อ `online` และผู้ใช้มี `streaming:view-live` (DL53)

### GET `/api/work-orders/1042`

```json
{
  "id": "1042",
  "workOrderNo": "WO-202611-00042",
  "title": "ติดตั้งกล้องวงจรปิด อาคาร B",
  "status": 1,
  "closeReason": null,
  "booking": {
    "id": "8801",
    "sourceSystem": "BOOKING",
    "externalJobId": "c1f0a9e2",
    "externalJobNo": "BK-2611-0193",
    "doNo": "DO-6911-0042",
    "shNo": "SH-6911-0107",
    "status": 3,
    "rawStatus": "IN_PROGRESS",
    "plannedStartAt": "2026-11-03T02:00:00.000Z",
    "plannedEndAt": "2026-11-03T06:00:00.000Z",
    "checkInAt": "2026-11-03T01:58:40.000Z",
    "checkOutAt": null,
    "deviceRefs": ["BWC-0031", "BWC-0090"],
    "site": { "name": "อาคาร B", "address": "…", "lat": 13.7563, "lng": 100.5018 },
    "lastSyncedAt": "2026-11-03T03:08:00.000Z",
    "isStale": false
  },
  "team": { "id": "7", "code": "TEAM-07", "name": "ทีมติดตั้ง 7" },
  "leader": { "id": "315", "name": "สมชาย ใจดี" },
  "workWindow": { "from": "2026-11-03T01:58:40.000Z", "to": null },
  "openedAt": "2026-11-03T00:41:12.000Z",
  "lastActivityAt": "2026-11-03T03:10:00.000Z",
  "closedAt": null,
  "needsReview": false,
  "reviewReasons": [],
  "note": null,
  "summary": { "sessionCount": 2, "activeSeconds": 8340, "recordedSeconds": 7210, "devices": ["BWC-0031", "BWC-0090"] },
  "availableActions": ["editNote", "exportEvidence"],
  "rowVersion": 4
}
```

`availableActions` คำนวณที่ server (pattern จาก `/my-jobs` ของ reference) — client ไม่เดากติกาเอง · **ไม่มีปุ่มปิด/reopen/link/void** เพราะใบงานและสถานะมาจาก Booking เท่านั้น (DL33 · `closedAt` = เวลา check-out) · `refreshBooking` อยู่ในรายการเฉพาะเมื่อมี read API (`BOOKING_PROVIDER_DRIVER ≠ none`) และผู้ใช้มี `booking:refresh` (DL46)

`workWindow` = ช่วงปฏิบัติงานจริงตาม Booking คำนวณที่ server (DL52): `from` = `BookingJobs.BookingCheckInAt` (null ⇒ ยังไม่ check-in ⇒ `workWindow = null`) · `to` = `BookingCheckOutAt` ?? `WorkOrders.ClosedAt` (ยกเลิก / `SafetyTimeout`) ?? `null` (ยังดำเนินการ — client ใช้เวลาปัจจุบัน) · ใช้แสดง "ปฏิบัติงานจริง" ในตารางหน้า ใบงาน / วิดีโอย้อนหลัง และติดป้าย "อยู่ในช่วงใบงาน" ให้ไฟล์ย้อนหลังที่ทับช่วงนี้ (`segment.startAt < to && segment.endAt > from`) · check-in ใหม่หลังปิด (reopen) ใช้คู่ check-in / check-out ล่าสุด

`doNo` / `shNo` = เลข DO / SH จาก Smart Booking — มีในข้อมูลใบงาน **[Confirmed]** · ความหมาย (น่าจะเป็น Delivery Order / Shipment) **[Assumption]** · ใช้แสดงและค้นหาเท่านั้น ไม่ใช้จับคู่ session (DL46) · `lastSyncedAt` = เวลาที่ได้รับข้อมูลใบงานนี้ล่าสุด

### POST `/api/integration/booking/jobs` — Smart Booking ส่งใบงานเข้ามา (DL46)

contract ร่าง v1 ที่ **ระบบเรากำหนด** · Smart Booking POST เมื่อสร้างใบงาน **[Confirmed]** · POST ซ้ำทั้งใบทุกครั้งที่เปลี่ยน (check-in, check-out, ยกเลิก, แก้ไข) **[Assumption]** — endpoint เดียวกัน = upsert · field ทุกตัวใน body **[Assumption]** จนกว่าทีม Booking ยืนยัน (ถ้า Smart Booking ใช้ body ของตัวเอง ⇒ เขียน `BookingInboundMapper` `smart-booking` ใน P3c — core เห็นแค่ `BookingJobSnapshot`)

```http
POST /api/integration/booking/jobs HTTP/1.1
Content-Type: application/json
X-Booking-Timestamp: 1794423480
X-Booking-Signature: sha256=5d1f…c09a
X-Correlation-Id: 0f6c2b7e-…
```

(`X-Correlation-Id` optional — ไม่ส่งมา ระบบสร้างให้และคืนใน response)

```json
{
  "eventId": "evt_01HZX…",
  "eventType": "job.created",
  "occurredAt": "2026-11-12T01:58:00+07:00",
  "job": {
    "jobId": "c1f0a9e2",
    "jobNo": "BK-2026-001234",
    "doNo": "DO-6911-0042",
    "shNo": "SH-6911-0107",
    "status": "SCHEDULED",
    "version": 3,
    "updatedAt": "2026-11-12T01:58:00+07:00",
    "title": "ติดตั้งระบบ ลูกค้า A",
    "teamRef": "T-07",
    "leaderRef": "EMP-1182",
    "scheduledDate": "2026-11-12",
    "plannedStartAt": "2026-11-12T08:00:00+07:00",
    "plannedEndAt": "2026-11-12T17:00:00+07:00",
    "checkInAt": null,
    "checkOutAt": null,
    "deviceRefs": ["BWC-0031"],
    "site": { "name": "คลังสินค้า บางนา", "address": "…", "lat": 13.66, "lng": 100.63 }
  }
}
```

- `eventType` = `job.created` · `job.updated` · `job.checked-in` · `job.checked-out` · `job.cancelled` — ใช้เป็นข้อมูลเท่านั้น การประมวลผล upsert snapshot ทั้งใบเสมอ (version guard เดิม) · เวลาเป็น ISO 8601 พร้อม offset
- บังคับ: `job.jobId`, `job.status` และ `job.version` หรือ `job.updatedAt` อย่างน้อยหนึ่งตัว · field ที่ไม่รู้จัก **เก็บไว้ใน raw แล้วข้าม** (ไม่ reject — Smart Booking เพิ่ม field ได้)
- `ExternalEventId` = `eventId` ถ้ามี ไม่งั้น `{jobId}:{version ?? updatedAt}`
- `teamRef` / `leaderRef` = ที่มาของทีมและหัวหน้าทีม — inbox processor สร้าง/อัปเดต `Teams` / `TeamMembers` จากค่านี้ (ไม่มีหน้าจัดการทีม — DL53) **[Assumption — Booking ส่งมากับทุกใบ]** · ไม่มี `departmentRef` (ไม่มีแผนก — DL53)

**Auth** (env `BOOKING_INBOUND_AUTH=hmac|api-key`, default `hmac` · วิธีที่ใช้จริงตกลงกับ Booking **[Assumption]**)

| โหมด | Header | ตรวจ |
|---|---|---|
| `hmac` | `X-Booking-Timestamp` (unix seconds) + `X-Booking-Signature: sha256=<hex>` | HMAC-SHA256(secret, `{timestamp}.{rawBody}`) · เวลาคลาดได้ ±300 s · เทียบแบบ constant-time |
| `api-key` | `X-Api-Key` | เทียบแบบ constant-time |

secret อยู่ใน env `BOOKING_INBOUND_SECRETS` (คั่นด้วย comma ใช้งานพร้อมกันได้ 2 ตัว — หมุน secret โดยไม่ดับ) จาก Kubernetes Secret · `BOOKING_INBOUND_ALLOWED_CIDRS` (optional — IP allowlist, ต้องตั้ง `TRUST_PROXY` ให้ถูก) · ไม่ log secret / signature / body เต็ม (CallLogs เก็บ excerpt ที่ redact แล้ว ≤ 4 KB) · เครือข่าย: `/api/integration/booking/*` ต้องเข้าถึงได้จาก Smart Booking ผ่าน ingress → nginx `web` → `api` (เส้นทางเดิม DL29) และเปิด firewall ขาเข้าจาก egress IP ของ Booking

**ลำดับใน `api`**: ตรวจ auth → validate DTO → `INSERT IntegrationInbox (Source='BOOKING', ExternalEventId, EventType, Payload=raw, Channel=1 Push) ON CONFLICT DO NOTHING` → หลัง commit enqueue BullMQ `booking-inbox` → ตอบ · `api` ไม่ map และไม่แตะ `BookingJobs` / `WorkOrders` — inbox processor ใน worker `integration` ทำ (`BookingInboundMapper` → upsert projection + ใบงาน 1:1 ใน transaction เดียว → `matching.rematch`) · enqueue Redis ไม่ได้หลัง insert ⇒ ยังตอบ 202 (retry sweep เก็บแถว `Pending` ที่เก่ากว่า 1 นาที)

**Response**

`202 Accepted` — เก็บ event ใหม่แล้ว

```json
{ "status": "accepted", "externalJobId": "c1f0a9e2", "correlationId": "0f6c2b7e-…" }
```

`200 OK` — `ExternalEventId` นี้เคยเก็บแล้ว (Smart Booking ต้องถือว่าสำเร็จเหมือน 202)

```json
{ "status": "duplicate", "externalJobId": "c1f0a9e2", "correlationId": "0f6c2b7e-…" }
```

`400 Bad Request`

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "ข้อมูลใบงานไม่ครบ",
  "details": [{ "field": "job.status", "issue": "required" }],
  "correlationId": "0f6c2b7e-…"
}
```

`401 Unauthorized`

```json
{
  "statusCode": 401,
  "code": "INBOUND_AUTH_FAILED",
  "message": "ตรวจสอบลายเซ็นไม่ผ่าน",
  "correlationId": "0f6c2b7e-…"
}
```

| Status | เมื่อ | Smart Booking ควรทำ |
|---|---|---|
| 202 / 200 | เก็บแล้ว / ซ้ำ | จบ |
| 400 `VALIDATION_FAILED` | ขาด `job.jobId`, `job.status` หรือขาดทั้ง `job.version` และ `job.updatedAt` · วันที่ผิดรูปแบบ | แก้ข้อมูลแล้วส่งใหม่ (ไม่ retry อัตโนมัติ) |
| 401 `INBOUND_AUTH_FAILED` | ลายเซ็น / key / timestamp / IP ไม่ผ่าน | ตรวจ secret / นาฬิกา |
| 413 / 415 | body > 256 KB / ไม่ใช่ JSON | แก้ฝั่งผู้ส่ง |
| 429 | เกิน `booking-inbound` 600 req/min (มี `Retry-After`) | retry ตาม `Retry-After` |
| 503 `SERVICE_UNAVAILABLE` | ฐานข้อมูลของเราไม่พร้อม | retry แบบ exponential backoff |

**ขอจาก Smart Booking [Assumption]**: retry เมื่อ timeout / non-2xx แบบ exponential backoff อย่างน้อย 24 ชม. · ส่งตามลำดับต่อใบงานเท่าที่ทำได้ (เรายังกันด้วย version / `updatedAt`) · ส่งใบงานซ้ำตามคำขอได้ (manual resend) ถ้ามี · ทดสอบใน dev ด้วย `booking-simulator` (`npm run booking:simulate -- <scenario>`) ที่ POST payload v1 ที่เซ็นแล้วเข้า endpoint จริง

### GET `/api/work-orders/by-booking/c1f0a9e2` — deep link จาก Booking app (Part 7 §7.9)

Booking app ลิงก์มาที่ `https://{host}/work-orders/by-booking/{externalJobId}` · SPA เรียก endpoint นี้แล้ว redirect ไป `/work-orders/:id`

```json
{ "id": "1042" }
```

ต้อง login + data scope ตามปกติ · ไม่พบใบงานหรือนอก scope = 404 · ใช้กับผู้ใช้ web (`ADMIN` / `COMPANY_ADMIN` / `OPERATOR` / `VIEWER`) เท่านั้น — `TEAM_LEADER` ไม่มี web UI (เปิดแล้วเห็นหน้า "ใช้งานผ่านแอปมือถือ" — DL47) · ข้อมูลใบงานเข้ามาทาง `POST /integration/booking/jobs` (DL46)

---

## 5.4 Mobile API (หัวหน้าทีม — live กล้องของตัวเอง + รายละเอียดใบงาน)

ผู้ใช้แอป = **หัวหน้าทีมภาคสนาม role `TEAM_LEADER` เท่านั้น** (requirement ฉบับ 2026-11-12 §4 · DL47 แทน DL4 / DL16) · ขอบเขต = **live กล้องของตัวเอง + รายละเอียดใบงานจาก Smart Booking** · ไม่มี playback, GPS (แผนที่ / ประวัติ), monitoring สถานะกล้อง, talk, alert, user management — ทั้งหมดอยู่บน web (requirement §4.3 · GPS history และ talk ยังเป็น Must บน web — DL48) · check-in / check-out ยังทำใน Booking app

- port จาก `docs/MOBILE-API-CONTRACT.md` ของ reference เฉพาะ login/SSO/refresh body-mode, ทะเบียนเครื่อง, push token — **ตัด PIN, my-jobs (approval/delegation), attachments, sites** · `/mobile/jobs` เขียนใหม่ อ่านอย่างเดียว
- **Login**: Entra SSO (`/auth/azure`) หรือ username/password (`/auth/login`) — ใช้ได้ทั้งสองแบบ: มีบัญชี Entra ⇒ SSO · ไม่มี ⇒ username/password แบบ reference (lockout ตาม Settings `auth.*`, refresh token แบบ body) **[Confirmed — DL49]** · `ADMIN` หรือ `COMPANY_ADMIN` (DL51) สร้างบัญชีใน User Management และผูกกับพนักงาน (`Employees.UserId`)
- **Data scope `team`** (DL47): พนักงานของผู้ใช้ = `Employees.UserId = me` · ทีม = ทีมที่พนักงานนั้นเป็นหัวหน้าอยู่ (`TeamMembers.Role = 1 Leader` ที่ active — เปลี่ยนหัวหน้ามีผลทันที DL22) · ใบงานใน scope = `BookingJobs.TeamId = ทีมของฉัน` หรือ `BookingJobs.LeaderEmployeeId = พนักงานของฉัน` · กล้องใน scope = `DeviceAssignments` ที่ active ของทีม + กล้องใน `DeviceRefs` ของใบงานที่ `Planned` / `Open` · นอก scope = 404 · ไม่มีทีม / ไม่ได้เป็นหัวหน้า ⇒ list ว่าง ไม่ใช่ error
- แอปเรียก endpoint เหล่านี้เท่านั้น (permission ตาม §5.7 คอลัมน์ `TEAM_LEADER`):

| Method | Path | Permission | Response หลัก |
|---|---|---|---|
| GET | `/mobile/me` | login (`TEAM_LEADER`) | `{ user, employee, team: { id, name } \| null, cameras: [{ deviceId, deviceCode, name, kind }] }` — หน้าแรก + ปุ่มลัด "กล้องของฉัน" |
| GET | `/mobile/jobs?status=planned\|open\|recent` | `work-orders:read` | ใบงานของทีม (list envelope): `workOrderId, workOrderNo, status, externalJobNo, doNo, shNo, title, plannedStartAt, plannedEndAt, checkInAt, checkOutAt, site{name,address}, cameras[]` · `recent` = `Closed` / `Cancelled` ภายใน 7 วัน |
| GET | `/mobile/jobs/:workOrderId` | `work-orders:read` + `booking:read` | Booking reference เต็ม (ไม่มี `raw`), กล้องที่ผูก, สรุป session (เริ่ม/จบเท่านั้น), ปุ่ม live ผ่าน `availableActions` |
| POST | `/streams/live` `{ deviceCode }` (ตัวเดิม) | `streaming:view-live` | live HLS ของกล้องใน scope `team` · หยุดด้วย `/streams/:token/stop` |
| GET / PATCH / DELETE | `/auth/devices[/:id]` | login | ทะเบียนเครื่อง (`deviceName`, `pushEnabled`) — ไม่มี PIN (เหมือนเดิม) |
| POST / GET / DELETE | `/notifications/push-tokens[/:token]` | `notifications:read` | FCM token (เหมือนเดิม) |

`GET /api/mobile/jobs/1042` ตัวอย่าง:

```json
{
  "workOrderId": "1042",
  "workOrderNo": "WO-202611-00042",
  "status": 1,
  "title": "ติดตั้งระบบ ลูกค้า A",
  "booking": {
    "externalJobId": "c1f0a9e2",
    "externalJobNo": "BK-2026-001234",
    "doNo": "DO-6911-0042",
    "shNo": "SH-6911-0107",
    "status": 3,
    "rawStatus": "IN_PROGRESS",
    "scheduledDate": "2026-11-12",
    "plannedStartAt": "2026-11-12T01:00:00.000Z",
    "plannedEndAt": "2026-11-12T10:00:00.000Z",
    "checkInAt": "2026-11-12T01:05:12.000Z",
    "checkOutAt": null,
    "site": { "name": "คลังสินค้า บางนา", "address": "…", "lat": 13.66, "lng": 100.63 },
    "lastSyncedAt": "2026-11-12T01:05:20.000Z"
  },
  "team": { "id": "7", "name": "ทีมติดตั้ง 7" },
  "leader": { "id": "315", "name": "สมชาย ใจดี" },
  "cameras": [
    { "deviceId": "31", "deviceCode": "BWC-0031", "name": "กล้องทีม 7", "kind": 1, "availableActions": ["viewLive"] }
  ],
  "sessions": [
    { "deviceCode": "BWC-0031", "startedAt": "2026-11-12T01:06:40.000Z", "endedAt": null }
  ]
}
```

- `availableActions` อยู่ระดับกล้อง · `viewLive` = กล้องอยู่ใน scope `team` + `Devices.StreamingEnabled` + ผู้ใช้มี `streaming:view-live` · ไม่แสดงสถานะ online/offline ในแอป (monitoring สถานะกล้องอยู่บน web — requirement §4.3) · กล้อง offline ⇒ `/streams/live` ตอบ error ตามปกติและแอปแสดงข้อความ
- **Push (FCM)**: "ใบงานใหม่ของทีม" เมื่อมีใบงานของทีมถูกสร้าง (หลัง commit ของ inbox processor) · deep link `bodycam://jobs/{workOrderId}` → หน้ารายละเอียดใบงาน · **ไม่ push alert เข้ามือถือแล้ว** (ผู้ใช้ web เห็น alert ที่กระดิ่งบน web) · `session:revoked` ⇒ logout
- แอปมือถือพัฒนาโดยทีมเราเอง (DL49) — endpoint ข้างบนเป็นขอบเขตเริ่มต้น ทีมเพิ่ม / ลดฟังก์ชันได้ โดยเพิ่ม endpoint ใต้ `/api/mobile/*` + permission ของ `TEAM_LEADER` ผ่าน data migration · ทุก endpoint ใหม่ยังต้องมี `@RequirePermission` + `@Audit` + scope `team`

---

## 5.5 WebSocket (Socket.IO namespace `/realtime`)

- Auth: `handshake.auth.token` = access token (ตรวจใน `server.use` middleware — port) · หมดอายุ ⇒ client reconnect ด้วย token ใหม่
- Rooms (ตัด company · ไม่มีแผนก — DL53): `org` (ทุกคนที่ login) · `user:{id}` · `tracking` (ผู้ใช้ web ที่มี `tracking:view`) · `alerts` (ผู้ใช้ web ที่มี `alerts:view`) · **`team:{id}`** (DL47 — `TEAM_LEADER` ของทีมนั้น join · คำนวณทีมตอน connect) · ไม่มี room `dept:*`
- `TEAM_LEADER` join เฉพาะ `org`, `user:{id}`, `team:{id}` — ไม่ join `tracking` / `alerts` จึงไม่ได้ `gps:batch` / `session:*` / `alert:new` (DL47)
- Worker emit ผ่าน `@socket.io/redis-emitter` (key `socket.io`, namespace `/realtime` ต้องตรงกันทั้งสองฝั่ง — กับดักเดิม)
- **emit หลัง commit เท่านั้น**

| Event | Room | Payload | ใช้ที่ |
|---|---|---|---|
| `gps:batch` ✱ | `tracking` | `{ points: [{ deviceId, lat, lng, speedKph, heading, recordedAt, isValidFix }] }` | แผนที่ (throttle flush 1s ที่ client) |
| `session:opened` | `tracking` | `{ sessionId, deviceId, teamId, workOrderId, startedAt }` | dashboard, แผนที่ (halo), หน้า ใบงาน |
| `session:closed` | `tracking` | `{ sessionId, deviceId, workOrderId, endedAt, endReason }` | |
| `workorder:changed` | `tracking` + `team:{teamId}` ของใบงาน (DL47) | `{ workOrderId, status, needsReview, rowVersion, change: 'created'\|'statusChanged'\|'sessionAttached'\|... }` | หน้า ใบงาน / วิดีโอย้อนหลัง / รายละเอียด (invalidate query) · แอปหัวหน้าทีม (งานของฉัน / รายละเอียดใบงาน) |
| `alert:new` ✱ | `alerts` / `user:{id}` | `{ alertId, alertType, severity, title, message, workOrderId?, deviceId? }` | toast, bell |
| `stream:status` ✱ | `user:{id}` | `{ sessionToken, status, endReason }` | player |
| `integration:status` | `org` (ทุกคน — payload ไม่มีข้อมูลอ่อนไหว) | `{ source: 'BOOKING', isStale, lastReceivedAt }` (DL46) · ไม่มีหน้ารายละเอียด integration (DL53) — ปัญหาการเชื่อมต่อแจ้ง `ADMIN` ด้วย alert (§5.6) | banner "Booking data stale" ทุกหน้าที่แสดงข้อมูล Booking |
| `session:revoked` ✱ | `user:{id}` | `{ scope: 'account' \| 'device', reason }` | logout ทันที |

Client: queue + flush, REST snapshot เมื่อ reconnect (pattern `useLivePositions` / `liveMerge` ของ reference) · `workorder:changed` → `queryClient.invalidateQueries(['work-orders'])` (debounce 800ms)

`workorder:changed` ส่งเข้า room `tracking` เพราะไม่มี room รวมของผู้ใช้ web แล้ว (`org` มี `TEAM_LEADER` ด้วย) — ผู้ใช้ web ทุก role ได้ `tracking:view` ตามค่าเริ่มต้น (§5.7) · role ที่ไม่มี `tracking:view` ได้ข้อมูลใหม่เมื่อ refetch

ไม่มี event `device:status` — สถานะ online/offline ไม่ push ขึ้นหน้าจอ หน้าจอดึงตอนเปิด (DL35 · §5.2 Devices)

---

## 5.6 Alert Types

ตั้งเลขใหม่ (ฐานข้อมูลใหม่ ไม่ต้องสืบทอดเลขที่ retired ของ reference) · เลขเป็น enum append-only — เลขที่เลิกใช้เป็น "สงวน" ห้ามใช้ซ้ำและห้ามเลื่อนเลข

| # | Code | Severity | ผู้รับ | เงื่อนไข |
|---|---|---|---|---|
| 1 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `CAMERA_ACTIVE_UNLINKED` (ใบงานไม่ผูก Booking) |
| 2 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `BOOKING_MATCH_SUGGESTED` (LinkStatus) |
| 3 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `BOOKING_MATCH_AMBIGUOUS` (LinkStatus) |
| 4 | `CAMERA_ACTIVE_NO_TEAM` | Warning | Admin + Operator | กล้องเปิดใช้แต่ Booking ยังไม่ผูกกล้องนี้กับทีม/งาน (session `NoTeam` — ไม่สร้างใบงาน รอ Booking) |
| 5 | `DEVICE_OFFLINE_DURING_JOB` | Warning | Operator | WO Open, Booking ช่วงงานยังไม่จบ, กล้อง offline ≥ `alert.offline-during-job-minutes` (10) |
| 6 | `WORK_ORDER_AUTO_CLOSED` | Info | Operator | ปิดด้วย SafetyTimeout (ไม่มี check-out ครบ 7 วัน) |
| 7 | `WORK_ORDER_CANCELLED_WITH_EVIDENCE` | Warning | Operator + Admin | Booking ยกเลิกแต่มี recording |
| 8 | `BOOKING_JOB_CHANGED_AFTER_CLOSE` | Info | Operator | |
| 9 | `RECORDING_OUTSIDE_WORK` | Warning | Operator | session ที่ไม่มี WO (`AwaitingMatch` / `NoTeam`) มี recording ≥ 10 นาที |
| 10 | `BOOKING_SYNC_STALE` | Warning / Critical | Admin | inbox backlog: แถว `IntegrationInbox` ที่ยัง `Pending` / `Failed` ที่เก่าที่สุดเก่ากว่า `booking.stale-after-minutes` (15) / > 60 นาที (ความหมายใหม่ — DL46 · code เดิม) |
| 11 | `INTEGRATION_DEAD_LETTER` | Warning | Admin | inbox `Dead` · การแจ้งเตือนมีปุ่ม "ประมวลผลใหม่" (`POST /integration/inbox/:id/retry`) · ประมวลผลผ่านแล้ว resolve เอง (DL54) |
| 12 | `BOOKING_MAPPING_ISSUES` | Info | Admin | รายวัน — สรุป ref ที่ map ไม่ได้ (leader / กล้อง / สถานะ) ใน `Data` ของ alert (ไม่มีหน้า integration — DL53) |
| 13 | `DEVICE_VENDOR_MISSING` | Warning | Admin | job `DeviceSync` (worker — DL53) ไม่พบเครื่องใน DSS device list (`VendorMissingSince`) |
| 14 | `WORK_ORDER_NO_CHECKOUT` | Warning | Operator | ใบงานไม่มี check-out เกิน 36 ชม. นับจาก `OpenedAt` (`workorder.stale-open-hours`) |
| 15 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `WORK_ORDER_AUTO_VOIDED` (auto-void ใบที่ไม่มี recording) |
| 16 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `REVIEW_QUEUE_OVERDUE` (SLA คิวตรวจสอบ) |
| 17 | `BOOKING_INBOUND_SILENT` | Warning | Admin | ไม่ได้รับ POST จาก Smart Booking (ที่ผ่าน auth) นาน `booking.inbound-silence-alert-hours` (24 ชม. · 0 = ปิด) — อาจเป็นปัญหาฝั่งผู้ส่งที่เรามองไม่เห็น (DL46) |

ผู้รับ **Operator** = ผู้ใช้ web ที่มี `alerts:view` (room `alerts` — ทุก role web เห็นทั้งบริษัท ไม่มีแผนก DL53) · ผู้รับ **Admin** = role `ADMIN` เท่านั้น (`user:{id}`) — `COMPANY_ADMIN` ไม่ได้รับ alert ระบบ / การเชื่อมต่อ (DL51) · ไม่มีหน้า integration แล้ว alert 10 / 11 / 12 / 17 จึงเป็นช่องทางเดียวที่ `ADMIN` รู้ปัญหาการเชื่อมต่อ Booking (DL53)

alert ส่งให้ผู้ใช้ web เท่านั้น (กระดิ่ง + toast) — ไม่ push เข้าแอปหัวหน้าทีม (DL47)

ทุก alert มี `DedupeKey` (เช่น `5:wo:1042`) กันซ้ำขณะยัง New/Acknowledged · ไม่มีการ "re-nag"

---

## 5.7 Permission Catalog

Catalog มี **24 permission** (DL53) · ทุก role web ใช้ scope `all`

| Permission | ADMIN | COMPANY_ADMIN (DL51) | OPERATOR | VIEWER | TEAM_LEADER (scope `team` · มือถือ) | ใช้ที่ (เมนู / หน้า) |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `dashboard:view` | ✓ | ✓ | ✓ | ✓ | | แดชบอร์ด |
| `tracking:view` | ✓ | ✓ | ✓ | ✓ | | แผนที่ติดตาม · room `tracking` |
| `tracking:history` | ✓ | ✓ | ✓ | ✓ | | ประวัติเส้นทาง |
| `work-orders:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ใบงาน · รายละเอียดใบงาน · วิดีโอย้อนหลัง · `/mobile/jobs` |
| `work-orders:edit-note` | ✓ | ✓ | ✓ | | | หมายเหตุใบงาน |
| `booking:read` | ✓ | ✓ | ✓ | ✓ | ✓ | panel Booking ของใบงาน · `/mobile/jobs/:id` |
| `booking:refresh` | ✓ | ✓ | ✓ | | | ปุ่ม refresh (เฉพาะมี read API) |
| `devices:read` | ✓ | ✓ | ✓ | ✓ | ✓ | `GET /devices` (ภาพสดหลายจอ, ประวัติเส้นทาง, มือถือ) |
| `org:read` | ✓ | ✓ | ✓ | ✓ | | พนักงาน |
| `org:manage` | ✓ | ✓ | | | | แก้ไขพนักงาน |
| `users:read` | ✓ | ✓ | | | | ผู้ใช้ระบบ (+ matrix สิทธิ์แบบอ่านอย่างเดียว) |
| `users:manage` | ✓ | ✓ (ไม่เห็นบัญชี `ADMIN` — DL55) | | | | จัดการผู้ใช้ · ผู้ใช้จาก Entra |
| `roles:manage` | ✓ | ✕ | | | | แก้ matrix สิทธิ์ · `/streams/role-access` |
| `streaming:view-live` | ✓ | ✓ | ✓ | | ✓ | ปุ่ม ดูสด · ภาพสดหลายจอ · live ในแอป |
| `streaming:live-wall` | ✓ | ✓ | ✓ | | | ภาพสดหลายจอ |
| `streaming:talk` | ✓ | ✓ | ✓ | | | talk ในภาพสดหลายจอ |
| `playback:view` | ✓ | ✓ | ✓ | | | ปุ่ม ดูย้อนหลัง / ดูวิดีโอ · วิดีโอย้อนหลัง |
| `evidence:export` | ✓ | ✓ | ✓ | | | สร้างไฟล์ MP4 |
| `evidence:download` | ✓ | ✓ | ✓ | | | ดาวน์โหลด MP4 |
| `notifications:read` | ✓ | ✓ | ✓ | ✓ | ✓ | แจ้งเตือน · push token |
| `alerts:view` | ✓ | ✓ | ✓ | ✓ | | แจ้งเตือน · room `alerts` |
| `alerts:manage` | ✓ | ✓ | ✓ | | | รับทราบ / ปิด alert |
| `audit:view` | ✓ | ✕ | | | | ประวัติการใช้งาน |
| `settings:manage` | ✓ | ✕ | | | | ตั้งค่าระบบ |

- ✕ = **permission สงวนของ `ADMIN`** (DL51 · เหลือ 3 ตัวตาม DL53): `audit:view`, `settings:manage`, `roles:manage`
- **ตัดตาม DL53** (ยังไม่มีโค้ด — ไม่ต้องสงวน code): `sessions:read`, `teams:read`, `teams:manage`, `devices:manage`, `devices:sync`, `integration:view`, `integration:manage`
- **ไม่มี permission ปิด/reopen ใบงาน** — สถานะใบงานตาม check-in/check-out ของ Booking **[Confirmed — Q1, Q2, Q9]**
- **ไม่มี permission link / void ใบงาน หรือ classify session** — ใบงานมาจาก Booking เท่านั้น และ session ผูกกับใบงานโดย matching อัตโนมัติ (DL33) · OPERATOR = monitor (แผนที่, ภาพสดหลายจอ, talk), ดูย้อนหลัง/export หลักฐาน, รับทราบ alert · ไม่มีงานจัดการทีม (ทีมมาจาก Booking — DL53)
- **role `TEAM_LEADER` (DL47)** — หัวหน้าทีมภาคสนาม ใช้ **แอปมือถือเท่านั้น** (live กล้องของตัวเอง + รายละเอียดใบงาน — §5.4) · ทุก permission ประเมินด้วย data scope **`team`** · **ไม่มี web UI** — login web แล้วเห็นหน้า "ใช้งานผ่านแอปมือถือ" (ไม่มีเมนู) · check-in/check-out ยังทำใน Booking app · role ใส่ผ่าน data migration · บัญชีต้องผูกพนักงาน (`Employees.UserId` — ตรวจใน service)
- ชื่อ role ไม่เปลี่ยน (DL48): "แอดมินฝ่ายความปลอดภัย" ใน requirement = `COMPANY_ADMIN` (DL55 — `ADMIN` เป็นบัญชี super admin ของฝั่ง dev ไม่ใช่บทบาทของลูกค้า) · "ผู้จัดการแผนก/ฝ่าย" = `OPERATOR` (scope `all` — ไม่มีแผนก DL53) · `VIEWER` คงไว้
- **role `COMPANY_ADMIN` (DL51)** — ผู้ดูแลบริษัท (web, scope `all`) = ชุดของ `OPERATOR` + `org:manage` + `users:read` / `users:manage` · **ไม่ bypass** permission · ต่างจาก `ADMIN` แค่ audit, settings, แก้ matrix สิทธิ์ และบัญชี `ADMIN` (DL53) · ✕ = **permission สงวนของ `ADMIN`** (`audit:view`, `settings:manage`, `roles:manage`) — ให้ role ที่ไม่ใช่ `ADMIN` ไม่ได้ (`PUT /roles/:id/permissions` ⇒ 400 `PERMISSION_RESERVED_FOR_ADMIN` · matrix ล็อกช่องตาม `reservedPermissions` จาก `GET /roles`) · จัดการบัญชีทุก role ยกเว้น `ADMIN` — บัญชี `ADMIN` ถูกซ่อน (⇒ 404) และกำหนด role `ADMIN` ไม่ได้ (⇒ 403 `ADMIN_ACCOUNT_PROTECTED` · §5.2 · DL55) · ดู matrix ได้อย่างเดียวผ่าน `users:read`
- `POST /integration/booking/jobs` **ไม่ใช้ permission ของผู้ใช้** — ตรวจด้วย `BookingInboundAuthGuard` (HMAC / api-key ของ Smart Booking) แทน (DL46)
- การผูกกล้องกับทีม/งาน (รวมกล้องสำรอง) **มาจาก Booking เท่านั้น** (`DeviceRefs` ในใบงานที่ Smart Booking POST มา) **[Confirmed — Q4, Q20]** — ไม่มี permission ผูกกล้องในระบบนี้
- `audit:view` = `ADMIN` เท่านั้น **[Confirmed — Q19 · ยืนยันอีกครั้งโดย DL51: `COMPANY_ADMIN` ดู log ไม่ได้]**
- ADMIN bypass permission/scope (กติกาเดิม) แต่ยังผ่าน audit · role อื่นทุกตัว (รวม `COMPANY_ADMIN`) ใช้ permission ตามตาราง
- Permission/role ใหม่ใส่ผ่าน **data migration** เท่านั้น (ไม่พึ่ง seed)
- Toggle สิทธิ์สตรีมต่อ role ผ่าน `/streams/role-access` (port `RoleStreamAccessPanel`)
