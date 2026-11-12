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
| 400 | validation / ค่าไม่ถูกต้องตามกติกาธุรกิจ (เช่น ตั้ง Temporary assignment ให้กล้องที่ Retired) · `VALIDATION_FAILED` เมื่อ body ที่ Smart Booking POST มาขาด field บังคับ (DL46) |
| 401 / 403 | ไม่ได้ login / ไม่มี permission · **`INBOUND_AUTH_FAILED` (401)** = ลายเซ็น HMAC / api-key / IP ของ Smart Booking ไม่ผ่านที่ `POST /integration/booking/jobs` (DL46) |
| **404** | ไม่พบ **หรืออยู่นอก data scope** (ไม่ยืนยันว่ามี record — กติกาเดิม) |
| 409 | สถานะหรือข้อมูลขัดกัน (เช่น `DEPARTMENT_IN_USE` — ลบแผนกที่ยังมีข้อมูลอ้างอิง) · ใบงานไม่มี action เปลี่ยนสถานะ เพราะสถานะตาม Booking เท่านั้น (DL33) · **`INTEGRATION_READ_API_DISABLED`** = เรียก refresh รายใบ / full reconcile ขณะไม่มี read API (`BOOKING_PROVIDER_DRIVER=none` — DL46) |
| 412 | `If-Match` ไม่ตรง `RowVersion` |
| 413 / 415 | body ใหญ่เกิน (inbound จาก Smart Booking ≤ 256 KB) / `Content-Type` ไม่ใช่ `application/json` (DL46) |
| 429 | rate limit / เกินโควตาสตรีม (มี `Retry-After`) |
| 503 | ระบบภายนอกไม่พร้อม (`BOOKING_UNAVAILABLE` — read API ของ Smart Booking, `VENDOR_UNAVAILABLE`) · `SERVICE_UNAVAILABLE` = ฐานข้อมูลของเราไม่พร้อมตอนรับ POST จาก Smart Booking (ให้ Booking retry — DL46) |

---

## 5.2 Endpoint Catalog

> คอลัมน์ Permission = ต้องมีทุกตัวที่ระบุ · ทุก endpoint ใช้ data scope ตาม role — `all` / `department` / `team` (Part 2 §2.8 · `team` สำหรับ `TEAM_LEADER` — DL47) · ✱ = port จาก reference

### Auth & Account ✱

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/auth/config` | Public | flags SSO/password |
| POST | `/auth/login` | Public | `{ username, password }` · rate limit |
| POST | `/auth/azure` | Public | `{ idToken }` |
| POST | `/auth/refresh` | Public | cookie (web) หรือ body (mobile) |
| POST | `/auth/logout` | Public | ใช้ refresh token |
| GET | `/auth/me` | login | user + role + permissions + department · web เห็น role `TEAM_LEADER` ⇒ เปิดหน้า "ใช้งานผ่านแอปมือถือ" (DL47) |
| POST | `/auth/change-password` | login | |
| GET / PATCH / DELETE | `/auth/devices[/:id]` | login | ทะเบียนเครื่องของตัวเอง (`deviceName`, `pushEnabled`) — **ไม่มี PIN** |

### Users, Roles, Org, Teams

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/users` | `users:read` / `users:manage` |
| GET / PATCH / DELETE | `/users/:id` | `users:read` / `users:manage` |
| PATCH | `/users/:id/access` | `users:manage` ✱ ระงับ/คืนสิทธิ์ (ตัด session ทันที) |
| GET | `/roles`, `/roles/:id/permissions` | `users:read` |
| PUT | `/roles/:id/permissions` | `roles:manage` |
| GET / POST / PATCH / DELETE | `/departments[/:id]` | `org:read` / `org:manage` · body มี `bookingDepartmentRef` สำหรับ map แผนกจาก Booking (DL38) |
| GET / POST / PATCH / DELETE | `/employees[/:id]` | `org:read` / `org:manage` |
| GET / POST | `/teams` | `teams:read` / `teams:manage` |
| GET / PATCH / DELETE | `/teams/:id` | `teams:read` / `teams:manage` |
| GET | `/teams/:id/members?activeOnly=` | `teams:read` |
| POST | `/teams/:id/members` | `teams:manage` `{ employeeId, role, validFrom? }` |
| POST | `/teams/:id/members/:memberId/end` | `teams:manage` `{ validTo?, note }` |
| POST | `/teams/:id/leader` | `teams:manage` `{ employeeId, effectiveAt? }` ปิดหัวหน้าเดิม + เปิดคนใหม่ใน transaction เดียว |

### Devices & Assignments

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/devices` | `devices:read` | filter `status`, `kind`, `teamId`, `online`, `q` · รวม state ปัจจุบัน + ทีมปัจจุบัน |
| POST / PATCH / DELETE | `/devices[/:id]` | `devices:manage` | |
| GET | `/devices/:id` | `devices:read` | master + state + ทีม + session ล่าสุด |
| POST | `/devices/sync-vendor` | `devices:sync` ✱ | `{ dryRun }` |
| GET | `/devices/:id/status-history?from&to` | `devices:read` | `DeviceStatusHistory` |
| GET | `/devices/:id/assignments` | `devices:read` | ประวัติผูกทีม (projection จาก Booking — read-only) |
| PATCH | `/devices/:id/streaming-access` | `devices:manage` ✱ | `{ enabled }` ตัด session ที่เปิดอยู่ |
| GET / POST / PATCH / DELETE | `/depots[/:id]` | `devices:read` / `devices:manage` | ฐาน/จุดชาร์จ `{ code, name, departmentId?, lat, lng, radiusM }` (Q15) |

**สถานะกล้องบนหน้าจอ (DL35):** สถานะ platform (online / offline) ใน `GET /devices` และ `GET /devices/:id` — `api` ดึงจาก DSS ผ่าน DSS middleware ตอน request · หน้า device list, device detail และก่อนเปิด live เรียกตอนเปิดหน้า · ไม่มี push `device:status` ทาง Socket.IO (`DeviceState` ยังอัปเดตโดย GpsPoll และใช้ภายใน session engine)
- **cache (DL45)**: ผลจาก DSS เก็บใน Redis key `device-status:{deviceId}` อายุ `status.display-cache-seconds` (10s) ใช้ร่วมทุก api pod · ถาม DSS เฉพาะกล้องที่ไม่มีใน cache · Redis ล่ม ⇒ ถาม DSS ตรง (fail-open)
- ทุกอุปกรณ์ใน response มี `platformStatusFetchedAt` = เวลาที่ได้สถานะจาก DSS (ค่าจาก cache เก่าได้ ≤ 10s) ให้หน้าจอแสดงว่าอัปเดตเมื่อไร

### Tracking & Sessions

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/tracking/positions` | `tracking:view` ✱ | snapshot ทุกอุปกรณ์ใน scope |
| GET | `/tracking/devices/:id/history?from&to` | `tracking:history` ✱ | polyline segments + stops (ไม่มี road-match) · ช่วง ≤ 24 ชม. |
| GET | `/tracking-sessions` | `sessions:read` | filter `open=true`, `deviceId`, `teamId`, `workOrderId`, `matchState`, `from`, `to` |
| GET | `/tracking-sessions/:id` | `sessions:read` | + recordings + match attempts |

Session อ่านอย่างเดียว — ผูกกับใบงานโดย matching อัตโนมัติเท่านั้น · session ที่ยังไม่มีใบงาน (`AwaitingMatch` / `NoTeam`) รอข้อมูล Booking และดูภาพได้จาก `/streams/recordings?deviceId` · ไม่มี attach / classify ด้วยมือ (DL33)

### Work Orders

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/work-orders` | `work-orders:read` | filter `status`, `teamId`, `needsReview`, `from`, `to`, `q` (เลข WO / เลข Booking / เลข DO / เลข SH / ชื่อทีม — DL46) |
| GET | `/work-orders/by-booking/:externalJobId` | `work-orders:read` | deep link จาก Booking app (Part 7 §7.9 — ผู้ใช้ web เท่านั้น) → `{ id }` · ไม่พบ / นอก scope = 404 |
| GET | `/work-orders/:id` | `work-orders:read` | detail + booking + team + summary |
| GET | `/work-orders/:id/sessions` | `work-orders:read` | ใช้เลือกกล้อง + ช่วงเวลาในหน้า หลักฐาน (DL36) |
| GET | `/work-orders/:id/events` | `work-orders:read` | timeline |
| GET | `/work-orders/:id/match-attempts` | `work-orders:read` | |
| PATCH | `/work-orders/:id` | `work-orders:edit-note` | `{ note }` + `If-Match` (แก้ได้แค่หมายเหตุ) |

ใบงานสร้างและอัปเดตจากข้อมูลที่ Smart Booking POST เข้ามาเท่านั้น (ผ่าน inbox processor · 1:1 กับ `BookingJobs` · DL46) — ไม่มี endpoint link / unlink / void / review queue (DL33) · `needsReview` + `reviewReasons` เป็นป้ายข้อมูลเท่านั้น

### Booking & Integration

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| POST | `/integration/booking/jobs` | Booking (HMAC) — `@Public()` + `BookingInboundAuthGuard` (ไม่ใช้ JWT / user permission) | **รับใบงานที่ Smart Booking POST เข้ามา** (DL46) · upsert ทั้ง snapshot ผ่าน `IntegrationInbox` (`Channel = 1 Push`) · 202 accepted / 200 duplicate · rate-limit group `booking-inbound` (600 req/min) · body ≤ 256 KB · `@Audit` ลง `IntegrationCallLogs` (`Direction = 2 Inbound`) · contract ดู §5.3 |
| GET | `/booking-jobs` | `booking:read` | projection · filter `from`, `to`, `teamId`, `status`, `q` (เลข Booking / เลข DO / เลข SH — DL46) |
| GET | `/booking-jobs/:id` | `booking:read` | + ใบงานของงานนี้ + `doNo` / `shNo` + `raw` (เฉพาะ `integration:view`) |
| POST | `/booking-jobs/:id/refresh` | `booking:refresh` | `fetchJob` สดจาก read API (timeout 5s · 503 `BOOKING_UNAVAILABLE` ถ้าไม่ได้) · **ใช้ได้เฉพาะเมื่อมี read API** (`BOOKING_PROVIDER_DRIVER ≠ none`) ไม่งั้น 409 `INTEGRATION_READ_API_DISABLED` และไม่อยู่ใน `availableActions` (DL46) |
| GET | `/integration/status` | `integration:view` | POST ล่าสุด (`lastReceivedAt`), จำนวน inbound ตามผล, inbox backlog, breaker ของ read API (เฉพาะเมื่อเปิดใช้) |
| GET | `/integration/inbox?status&channel` · `/integration/call-logs` | `integration:view` | call logs มีทั้ง inbound (POST จาก Smart Booking) และ outbound (read API) |
| POST | `/integration/inbox/:id/retry` | `integration:manage` | |
| POST | `/integration/booking/sync` | `integration:manage` | `{ mode: 'full', from?, to? }` → 202 · full reconcile ผ่าน read API (`fetchWindow`) · `BOOKING_PROVIDER_DRIVER=none` ⇒ 409 `INTEGRATION_READ_API_DISABLED` · ไม่มี mode `incremental` แล้ว (DL46) |
| GET | `/integration/mapping-issues` | `integration:view` | ref ที่ map ไม่ได้ |

read API ของ Smart Booking (`fetchJob` / `fetchWindow`) มีหรือไม่ = **[Assumption]** — ถ้าไม่มี ใบงานที่ POST หายจะกลับมาได้เมื่อ Smart Booking ส่งซ้ำเท่านั้น (Part 7)

### Media ✱

| Method | Path | Permission |
|---|---|---|
| POST | `/streams/live` `{ deviceCode }` | `streaming:view-live` |
| POST | `/streams/playback` `{ deviceCode, startAt, endAt }` (≤ 24 ชม.) | `playback:view` |
| GET | `/streams/:token/playlist.m3u8`, `/streams/:token/segment` | Public (sealed token) |
| POST | `/streams/:token/stop` · GET `/streams/sessions` | `streaming:view-live` |
| GET | `/streams/recordings?deviceId&from&to` · `?workOrderId=` | `playback:view` |
| GET / PATCH | `/streams/role-access` | `roles:manage` |
| GET | `/evidence-exports/policy` · POST `/evidence-exports` · GET `/evidence-exports/:id` | `evidence:export` |
| POST | `/evidence-exports/:id/download-ticket` · GET `/evidence-exports/download?ticket=` | `evidence:download` / Public (ticket) |
| POST | `/talk/sessions` `{ streamSessionToken }` · WS `/api/talk/ws?ticket=` | `streaming:talk` |

`POST /evidence-exports` ใช้ job เดิมเมื่อ device + channel + start/end ตรงกันพอดีและ job ยัง `Queued` / `Processing` / `Ready` ที่ยังไม่หมดอายุ — ไม่งั้นสร้าง job ใหม่ (port `evidence-export-rules.ts` · ใช้จากหน้า หลักฐาน และ `/recordings` — DL36)

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
      "booking": { "id": "8801", "externalJobNo": "BK-2611-0193", "doNo": "DO-6911-0042", "shNo": "SH-6911-0107", "plannedStartAt": "2026-11-03T02:00:00.000Z" },
      "openedAt": "2026-11-03T00:41:12.000Z",
      "lastActivityAt": "2026-11-03T03:10:00.000Z",
      "openSessionCount": 1,
      "deviceCodes": ["BWC-0031"],
      "rowVersion": 3
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

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
  "department": { "id": "3", "name": "งานติดตั้ง" },
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

`doNo` / `shNo` = เลข DO / SH จาก Smart Booking — มีในข้อมูลใบงาน **[Confirmed]** · ความหมาย (น่าจะเป็น Delivery Order / Shipment) **[Assumption]** · ใช้แสดงและค้นหาเท่านั้น ไม่ใช้จับคู่ session (DL46) · `lastSyncedAt` = เวลาที่ได้รับข้อมูลใบงานนี้ล่าสุด

### GET `/api/tracking-sessions?open=true`

```json
{
  "data": [
    {
      "id": "55120",
      "device": { "id": "31", "code": "BWC-0031", "name": "กล้องทีม 7" },
      "team": { "id": "7", "code": "TEAM-07" },
      "workOrder": { "id": "1042", "workOrderNo": "WO-202611-00042" },
      "startedAt": "2026-11-03T02:31:40.000Z",
      "startInferred": 1,
      "matchState": 1,
      "deviceState": { "platformState": "online", "lastObservedAt": "2026-11-03T03:10:02.000Z", "lastFixAt": null }
    }
  ],
  "page": 1, "pageSize": 50, "total": 1
}
```

`platformState` ใน view model = `"online" | "offline" | "unknown"` (unknown คำนวณที่ server จาก `LastObservedAt`)

### GET `/api/integration/status`

```json
{
  "booking": {
    "inbound": {
      "authMode": "hmac",
      "lastReceivedAt": "2026-11-12T03:08:00.000Z",
      "last24h": { "accepted": 182, "duplicate": 6, "invalid": 1, "unauthorized": 0 }
    },
    "isStale": false,
    "inbox": { "pending": 0, "failed": 1, "dead": 0, "oldestBacklogAt": null },
    "mappingIssues": 2,
    "readApi": {
      "driver": "http",
      "breaker": "closed",
      "consecutiveFailures": 0,
      "lastSuccessAt": "2026-11-12T02:40:00.000Z",
      "lastFullSyncAt": "2026-11-11T19:00:04.000Z"
    }
  }
}
```

- `inbound.lastReceivedAt` = POST ล่าสุดที่ผ่าน auth (`IntegrationSyncState.LastReceivedAt`) · `last24h` นับจาก `IntegrationCallLogs` (inbound) แยกตามผล accepted / duplicate / invalid (400) / unauthorized (401) (DL46)
- `inbox.oldestBacklogAt` = `ReceivedAt` ของแถว `IntegrationInbox` ที่ยัง `Pending` / `Failed` ที่เก่าที่สุด · `isStale` = แถวนั้นเก่ากว่า `booking.stale-after-minutes` (15) = backlog ของ inbox processor (DL46)
- `readApi` = `null` เมื่อ `BOOKING_PROVIDER_DRIVER=none` · breaker / retry ใช้กับ read API ขาออกเท่านั้น

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
    "departmentRef": "D-OPS-01",
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

ต้อง login + data scope ตามปกติ · ไม่พบใบงานหรือนอก scope = 404 · ใช้กับผู้ใช้ web (`ADMIN` / `OPERATOR` / `VIEWER`) เท่านั้น — `TEAM_LEADER` ไม่มี web UI (เปิดแล้วเห็นหน้า "ใช้งานผ่านแอปมือถือ" — DL47) · ข้อมูลใบงานเข้ามาทาง `POST /integration/booking/jobs` (DL46)

---

## 5.4 Mobile API (หัวหน้าทีม — live กล้องของตัวเอง + รายละเอียดใบงาน)

ผู้ใช้แอป = **หัวหน้าทีมภาคสนาม role `TEAM_LEADER` เท่านั้น** (requirement ฉบับ 2026-11-12 §4 · DL47 แทน DL4 / DL16) · ขอบเขต = **live กล้องของตัวเอง + รายละเอียดใบงานจาก Smart Booking** · ไม่มี playback, GPS (แผนที่ / ประวัติ), monitoring สถานะกล้อง, talk, alert, user management — ทั้งหมดอยู่บน web (requirement §4.3 · GPS history และ talk ยังเป็น Must บน web — DL48) · check-in / check-out ยังทำใน Booking app

- port จาก `docs/MOBILE-API-CONTRACT.md` ของ reference เฉพาะ login/SSO/refresh body-mode, ทะเบียนเครื่อง, push token — **ตัด PIN, my-jobs (approval/delegation), attachments, sites** · `/mobile/jobs` เขียนใหม่ อ่านอย่างเดียว
- **Login**: Entra SSO (`/auth/azure`) หรือ username/password (`/auth/login`) — ใช้ได้ทั้งสองแบบ: มีบัญชี Entra ⇒ SSO · ไม่มี ⇒ username/password แบบ reference (lockout ตาม Settings `auth.*`, refresh token แบบ body) **[Confirmed — DL49]** · `ADMIN` สร้างบัญชีใน User Management และผูกกับพนักงาน (`Employees.UserId`)
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

- `availableActions` อยู่ระดับกล้อง · `viewLive` = กล้องอยู่ใน scope `team` + เปิดสิทธิ์ดูภาพ (`/devices/:id/streaming-access`) + ผู้ใช้มี `streaming:view-live` · ไม่แสดงสถานะ online/offline ในแอป (monitoring สถานะกล้องอยู่บน web — requirement §4.3) · กล้อง offline ⇒ `/streams/live` ตอบ error ตามปกติและแอปแสดงข้อความ
- **Push (FCM)**: "ใบงานใหม่ของทีม" เมื่อมีใบงานของทีมถูกสร้าง (หลัง commit ของ inbox processor) · deep link `bodycam://jobs/{workOrderId}` → หน้ารายละเอียดใบงาน · **ไม่ push alert เข้ามือถือแล้ว** (ผู้ใช้ web เห็น alert ที่กระดิ่งบน web) · `session:revoked` ⇒ logout
- แอปมือถือพัฒนาโดยทีมเราเอง (DL49) — endpoint ข้างบนเป็นขอบเขตเริ่มต้น ทีมเพิ่ม / ลดฟังก์ชันได้ โดยเพิ่ม endpoint ใต้ `/api/mobile/*` + permission ของ `TEAM_LEADER` ผ่าน data migration · ทุก endpoint ใหม่ยังต้องมี `@RequirePermission` + `@Audit` + scope `team`

---

## 5.5 WebSocket (Socket.IO namespace `/realtime`)

- Auth: `handshake.auth.token` = access token (ตรวจใน `server.use` middleware — port) · หมดอายุ ⇒ client reconnect ด้วย token ใหม่
- Rooms (ตัด company): `org` (ทุกคนที่ login) · `user:{id}` · `dept:{id}` (+ ทุกแผนกบรรพบุรุษ) · `dept:*` (scope all) · `dept:{id}:tracking` / `dept:*:tracking` (ต้องมี `tracking:view`) · `dept:{id}:alerts` (ต้องมี `alerts:view`) · **`team:{id}`** (DL47 — `TEAM_LEADER` ของทีมนั้น join · คำนวณทีมตอน connect)
- `TEAM_LEADER` join เฉพาะ `org`, `user:{id}`, `team:{id}` — ไม่ join `dept:*` จึงไม่ได้ `gps:batch` / `session:*` / `alert:new` (DL47)
- Worker emit ผ่าน `@socket.io/redis-emitter` (key `socket.io`, namespace `/realtime` ต้องตรงกันทั้งสองฝั่ง — กับดักเดิม)
- **emit หลัง commit เท่านั้น**

| Event | Room | Payload | ใช้ที่ |
|---|---|---|---|
| `gps:batch` ✱ | tracking rooms | `{ points: [{ deviceId, lat, lng, speedKph, heading, recordedAt, isValidFix }] }` | แผนที่ (throttle flush 1s ที่ client) |
| `session:opened` | tracking rooms | `{ sessionId, deviceId, teamId, workOrderId, startedAt }` | Active sessions, dashboard |
| `session:closed` | tracking rooms | `{ sessionId, deviceId, workOrderId, endedAt, endReason }` | |
| `workorder:changed` | `dept:{id}` + `team:{teamId}` ของใบงาน (DL47) | `{ workOrderId, status, needsReview, rowVersion, change: 'created'\|'statusChanged'\|'sessionAttached'\|... }` | WO list/detail (invalidate query) · แอปหัวหน้าทีม (งานของฉัน / รายละเอียดใบงาน) |
| `alert:new` ✱ | alert rooms / `user:{id}` | `{ alertId, alertType, severity, title, message, workOrderId?, deviceId? }` | toast, bell |
| `stream:status` ✱ | `user:{id}` | `{ sessionToken, status, endReason }` | player |
| `integration:status` | `org` (ทุกคน — payload ไม่มีข้อมูลอ่อนไหว) | `{ source: 'BOOKING', isStale, lastReceivedAt }` (DL46) · admin ดูรายละเอียด inbound / inbox backlog / breaker read API จาก `/integration/status` | banner "Booking data stale" ทุกหน้าที่แสดงข้อมูล Booking |
| `session:revoked` ✱ | `user:{id}` | `{ scope: 'account' \| 'device', reason }` | logout ทันที |

Client: queue + flush, REST snapshot เมื่อ reconnect (pattern `useLivePositions` / `liveMerge` ของ reference) · `workorder:changed` → `queryClient.invalidateQueries(['work-orders'])` (debounce 800ms)

ไม่มี event `device:status` — สถานะ online/offline ไม่ push ขึ้นหน้าจอ หน้าจอดึงตอนเปิด (DL35 · §5.2 Devices & Assignments)

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
| 11 | `INTEGRATION_DEAD_LETTER` | Warning | Admin | inbox `Dead` |
| 12 | `BOOKING_MAPPING_ISSUES` | Info | Admin | รายวัน |
| 13 | `DEVICE_VENDOR_MISSING` | Warning | Admin | device sync ไม่พบเครื่องใน DSS |
| 14 | `WORK_ORDER_NO_CHECKOUT` | Warning | Operator | ใบงานไม่มี check-out เกิน 36 ชม. นับจาก `OpenedAt` (`workorder.stale-open-hours`) |
| 15 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `WORK_ORDER_AUTO_VOIDED` (auto-void ใบที่ไม่มี recording) |
| 16 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `REVIEW_QUEUE_OVERDUE` (SLA คิวตรวจสอบ) |
| 17 | `BOOKING_INBOUND_SILENT` | Warning | Admin | ไม่ได้รับ POST จาก Smart Booking (ที่ผ่าน auth) นาน `booking.inbound-silence-alert-hours` (24 ชม. · 0 = ปิด) — อาจเป็นปัญหาฝั่งผู้ส่งที่เรามองไม่เห็น (DL46) |

alert ส่งให้ผู้ใช้ web เท่านั้น (กระดิ่ง + toast) — ไม่ push เข้าแอปหัวหน้าทีม (DL47)

ทุก alert มี `DedupeKey` (เช่น `5:wo:1042`) กันซ้ำขณะยัง New/Acknowledged · ไม่มีการ "re-nag"

---

## 5.7 Permission Catalog

| Permission | ADMIN | OPERATOR | VIEWER | TEAM_LEADER (scope `team` · มือถือ) |
|---|:-:|:-:|:-:|:-:|
| `dashboard:view` | ✓ | ✓ | ✓ | |
| `tracking:view` | ✓ | ✓ | ✓ | |
| `tracking:history` | ✓ | ✓ | ✓ | |
| `sessions:read` | ✓ | ✓ | ✓ | |
| `work-orders:read` | ✓ | ✓ | ✓ | ✓ |
| `work-orders:edit-note` | ✓ | ✓ | | |
| `booking:read` | ✓ | ✓ | ✓ | ✓ |
| `booking:refresh` | ✓ | ✓ | | |
| `integration:view` | ✓ | | | |
| `integration:manage` | ✓ | | | |
| `devices:read` | ✓ | ✓ | ✓ | ✓ |
| `devices:manage` / `devices:sync` (รวม depots) | ✓ | | | |
| `teams:read` | ✓ | ✓ | ✓ | |
| `teams:manage` | ✓ | ✓ | | |
| `org:read` | ✓ | ✓ | ✓ | |
| `org:manage` | ✓ | | | |
| `users:read` / `users:manage` | ✓ | | | |
| `roles:manage` | ✓ | | | |
| `streaming:view-live` | ✓ | ✓ | | ✓ |
| `streaming:live-wall` | ✓ | ✓ | | |
| `streaming:talk` | ✓ | ✓ | | |
| `playback:view` | ✓ | ✓ | | |
| `evidence:export` / `evidence:download` | ✓ | ✓ | | |
| `notifications:read` | ✓ | ✓ | ✓ | ✓ |
| `alerts:view` | ✓ | ✓ | ✓ | |
| `alerts:manage` | ✓ | ✓ | | |
| `audit:view` | ✓ | | | |
| `settings:manage` | ✓ | | | |

- **ไม่มี permission ปิด/reopen ใบงาน** — สถานะใบงานตาม check-in/check-out ของ Booking **[Confirmed — Q1, Q2, Q9]**
- **ไม่มี permission link / void ใบงาน หรือ classify session** — ใบงานมาจาก Booking เท่านั้น และ session ผูกกับใบงานโดย matching อัตโนมัติ (DL33) · OPERATOR = monitor (แผนที่, live, live wall, talk), ดูย้อนหลัง/export หลักฐาน, จัดการทีม, รับทราบ alert
- **role `TEAM_LEADER` (DL47)** — หัวหน้าทีมภาคสนาม ใช้ **แอปมือถือเท่านั้น** (live กล้องของตัวเอง + รายละเอียดใบงาน — §5.4) · ทุก permission ประเมินด้วย data scope **`team`** · **ไม่มี web UI** — login web แล้วเห็นหน้า "ใช้งานผ่านแอปมือถือ" (ไม่มีเมนู) · check-in/check-out ยังทำใน Booking app · role ใส่ผ่าน data migration · บัญชีต้องผูกพนักงาน (`Employees.UserId` — ตรวจใน service)
- ชื่อ role ไม่เปลี่ยน (DL48): "แอดมินฝ่ายความปลอดภัย" ใน requirement = `ADMIN` · "ผู้จัดการแผนก/ฝ่าย" = `OPERATOR` (scope department) · `VIEWER` คงไว้
- `POST /integration/booking/jobs` **ไม่ใช้ permission ของผู้ใช้** — ตรวจด้วย `BookingInboundAuthGuard` (HMAC / api-key ของ Smart Booking) แทน (DL46)
- การผูกกล้องกับทีม/งาน (รวมกล้องสำรอง) **มาจาก Booking เท่านั้น** (`DeviceRefs` ในใบงานที่ Smart Booking POST มา) **[Confirmed — Q4, Q20]** — ไม่มี permission ผูกกล้องในระบบนี้
- `audit:view` = `ADMIN` เท่านั้น **[Confirmed — Q19]**
- ADMIN bypass permission/scope (กติกาเดิม) แต่ยังผ่าน audit
- Permission/role ใหม่ใส่ผ่าน **data migration** เท่านั้น (ไม่พึ่ง seed)
- Toggle สิทธิ์สตรีมต่อ role ผ่าน `/streams/role-access` (port `RoleStreamAccessPanel`)
