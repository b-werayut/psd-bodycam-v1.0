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

### ความหมายของ status code

| Code | ใช้เมื่อ |
|---|---|
| 400 | validation / ค่าไม่ถูกต้องตามกติกาธุรกิจ (เช่น ตั้ง Temporary assignment ให้กล้องที่ Retired) |
| 401 / 403 | ไม่ได้ login / ไม่มี permission |
| **404** | ไม่พบ **หรืออยู่นอก data scope** (ไม่ยืนยันว่ามี record — กติกาเดิม) |
| 409 | สถานะหรือข้อมูลขัดกัน (เช่น `DEPARTMENT_IN_USE` — ลบแผนกที่ยังมีข้อมูลอ้างอิง) · ใบงานไม่มี action เปลี่ยนสถานะ เพราะสถานะตาม Booking เท่านั้น (DL33) |
| 412 | `If-Match` ไม่ตรง `RowVersion` |
| 429 | rate limit / เกินโควตาสตรีม (มี `Retry-After`) |
| 503 | ระบบภายนอกไม่พร้อม (`BOOKING_UNAVAILABLE`, `VENDOR_UNAVAILABLE`) |

---

## 5.2 Endpoint Catalog

> คอลัมน์ Permission = ต้องมีทุกตัวที่ระบุ · ทุก endpoint ใช้ data scope ตาม role (Part 2 §2.8) · ✱ = port จาก reference

### Auth & Account ✱

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/auth/config` | Public | flags SSO/password |
| POST | `/auth/login` | Public | `{ username, password }` · rate limit |
| POST | `/auth/azure` | Public | `{ idToken }` |
| POST | `/auth/refresh` | Public | cookie (web) หรือ body (mobile) |
| POST | `/auth/logout` | Public | ใช้ refresh token |
| GET | `/auth/me` | login | user + permissions + department |
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
| GET | `/work-orders` | `work-orders:read` | filter `status`, `teamId`, `needsReview`, `from`, `to`, `q` (เลข WO / เลข Booking / ชื่อทีม) |
| GET | `/work-orders/by-booking/:externalJobId` | `work-orders:read` | deep link จาก Booking app (DL31) → `{ id }` · ไม่พบ / นอก scope = 404 |
| GET | `/work-orders/:id` | `work-orders:read` | detail + booking + team + summary |
| GET | `/work-orders/:id/sessions` | `work-orders:read` | ใช้เลือกกล้อง + ช่วงเวลาในหน้า หลักฐาน (DL36) |
| GET | `/work-orders/:id/events` | `work-orders:read` | timeline |
| GET | `/work-orders/:id/match-attempts` | `work-orders:read` | |
| PATCH | `/work-orders/:id` | `work-orders:edit-note` | `{ note }` + `If-Match` (แก้ได้แค่หมายเหตุ) |

ใบงานสร้างและอัปเดตจาก Booking sync เท่านั้น (1:1 กับ `BookingJobs`) — ไม่มี endpoint link / unlink / void / review queue (DL33) · `needsReview` + `reviewReasons` เป็นป้ายข้อมูลเท่านั้น

### Booking & Integration

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/booking-jobs` | `booking:read` | projection · filter `from`, `to`, `teamId`, `status`, `q` |
| GET | `/booking-jobs/:id` | `booking:read` | + ใบงานของงานนี้ + `raw` (เฉพาะ `integration:view`) |
| POST | `/booking-jobs/:id/refresh` | `booking:refresh` | `fetchJob` สด (timeout 5s · 503 ถ้าไม่ได้) |
| GET | `/integration/status` | `integration:view` | breaker, lag, counts |
| GET | `/integration/inbox?status` · `/integration/call-logs` | `integration:view` | |
| POST | `/integration/inbox/:id/retry` | `integration:manage` | |
| POST | `/integration/booking/sync` | `integration:manage` | `{ mode: 'incremental' \| 'full', from?, to? }` → 202 |
| GET | `/integration/mapping-issues` | `integration:view` | ref ที่ map ไม่ได้ |

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
      "booking": { "id": "8801", "externalJobNo": "BK-2611-0193", "plannedStartAt": "2026-11-03T02:00:00.000Z" },
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

`availableActions` คำนวณที่ server (pattern จาก `/my-jobs` ของ reference) — client ไม่เดากติกาเอง · **ไม่มีปุ่มปิด/reopen/link/void** เพราะใบงานและสถานะมาจาก Booking เท่านั้น (DL33 · `closedAt` = เวลา check-out)
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
    "driver": "http",
    "breaker": "closed",
    "lastSuccessAt": "2026-11-03T03:08:00.000Z",
    "lagSeconds": 125,
    "isStale": false,
    "consecutiveFailures": 0,
    "inbox": { "pending": 0, "failed": 1, "dead": 0 },
    "mappingIssues": 2,
    "lastFullSyncAt": "2026-11-02T19:00:04.000Z"
  }
}
```

### GET `/api/work-orders/by-booking/c1f0a9e2` — deep link จาก Booking app (DL31)

Booking app ลิงก์มาที่ `https://{host}/work-orders/by-booking/{externalJobId}` · SPA เรียก endpoint นี้แล้ว redirect ไป `/work-orders/:id`

```json
{ "id": "1042" }
```

ต้อง login + data scope ตามปกติ · ไม่พบใบงานหรือนอก scope = 404 · ระบบไม่รับ webhook จาก Booking (pull อย่างเดียว — Part 7 §7.2)

---

## 5.4 Mobile API (Operator — monitoring และตรวจสอบหลักฐาน)

ผู้ใช้แอป = ฝั่งตรวจสอบใบงาน/หลักฐานและ monitoring (`OPERATOR`, `ADMIN`, `VIEWER`) — **ไม่ใช่พนักงานภาคสนาม** **[Confirmed — Q18]** · port แนวทางจาก `docs/MOBILE-API-CONTRACT.md` ของ reference เฉพาะ login/SSO/refresh body-mode, ทะเบียนเครื่อง, push token, notifications — **ตัด PIN, my-jobs, approval, delegation, attachments, sites**

แอปเรียก **API ชุดเดียวกับ web** (permission + scope เดียวกัน): `/work-orders*`, `/tracking/*`, `/tracking-sessions*`, `/streams/*`, `/evidence-exports*`, `/alerts*`, `/notifications*` · เพิ่มเฉพาะ:

| Method | Path | Permission | Response หลัก |
|---|---|---|---|
| GET | `/mobile/overview` | `dashboard:view` | สรุปหน้าแรก (ดึงตอนเปิดหน้า): กล้อง online/ดับระหว่างงาน · ใบงานเปิดอยู่ / ไม่มี check-out · alert ล่าสุด · สถานะ Booking sync |
| GET / PATCH / DELETE | `/auth/devices[/:id]` | login | ทะเบียนเครื่อง (`deviceName`, `pushEnabled`) — ไม่มี PIN |
| POST / GET / DELETE | `/notifications/push-tokens[/:token]` | `notifications:read` | FCM token |

`GET /mobile/overview` ตัวอย่าง:

```json
{
  "devices": { "online": 42, "offline": 11, "unknown": 3, "offlineDuringJob": 1 },
  "workOrders": { "open": 18, "noCheckout": 1 },
  "booking": { "isStale": false, "lastSuccessAt": "2026-11-04T03:08:00.000Z" },
  "latestAlerts": [
    { "alertId": "9012", "alertType": 5, "severity": 2, "title": "กล้อง BWC-0031 ดับระหว่างงาน", "workOrderId": "1042" }
  ]
}
```

Push ที่ส่งเข้ามือถือ: alert ตาม §5.6 ของผู้ใช้ใน scope · deep link `bodycam://work-orders/{id}` · `session:revoked` ⇒ logout

---

## 5.5 WebSocket (Socket.IO namespace `/realtime`)

- Auth: `handshake.auth.token` = access token (ตรวจใน `server.use` middleware — port) · หมดอายุ ⇒ client reconnect ด้วย token ใหม่
- Rooms (ตัด company): `org` (ทุกคนที่ login) · `user:{id}` · `dept:{id}` (+ ทุกแผนกบรรพบุรุษ) · `dept:*` (scope all) · `dept:{id}:tracking` / `dept:*:tracking` (ต้องมี `tracking:view`) · `dept:{id}:alerts` (ต้องมี `alerts:view`)
- Worker emit ผ่าน `@socket.io/redis-emitter` (key `socket.io`, namespace `/realtime` ต้องตรงกันทั้งสองฝั่ง — กับดักเดิม)
- **emit หลัง commit เท่านั้น**

| Event | Room | Payload | ใช้ที่ |
|---|---|---|---|
| `gps:batch` ✱ | tracking rooms | `{ points: [{ deviceId, lat, lng, speedKph, heading, recordedAt, isValidFix }] }` | แผนที่ (throttle flush 1s ที่ client) |
| `session:opened` | tracking rooms | `{ sessionId, deviceId, teamId, workOrderId, startedAt }` | Active sessions, dashboard |
| `session:closed` | tracking rooms | `{ sessionId, deviceId, workOrderId, endedAt, endReason }` | |
| `workorder:changed` | `dept:{id}` | `{ workOrderId, status, needsReview, rowVersion, change: 'created'\|'statusChanged'\|'sessionAttached'\|... }` | WO list/detail (invalidate query), mobile |
| `alert:new` ✱ | alert rooms / `user:{id}` | `{ alertId, alertType, severity, title, message, workOrderId?, deviceId? }` | toast, bell |
| `stream:status` ✱ | `user:{id}` | `{ sessionToken, status, endReason }` | player |
| `integration:status` | `org` (ทุกคน — payload ไม่มีข้อมูลอ่อนไหว) | `{ source: 'BOOKING', isStale, lastSuccessAt }` · admin ดูรายละเอียด breaker/lag จาก `/integration/status` | banner "Booking data stale" ทุกหน้าที่แสดงข้อมูล Booking |
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
| 10 | `BOOKING_SYNC_STALE` | Warning / Critical | Admin | lag > 15 / > 60 นาที |
| 11 | `INTEGRATION_DEAD_LETTER` | Warning | Admin | inbox `Dead` |
| 12 | `BOOKING_MAPPING_ISSUES` | Info | Admin | รายวัน |
| 13 | `DEVICE_VENDOR_MISSING` | Warning | Admin | device sync ไม่พบเครื่องใน DSS |
| 14 | `WORK_ORDER_NO_CHECKOUT` | Warning | Operator | ใบงานไม่มี check-out เกิน 36 ชม. นับจาก `OpenedAt` (`workorder.stale-open-hours`) |
| 15 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `WORK_ORDER_AUTO_VOIDED` (auto-void ใบที่ไม่มี recording) |
| 16 | *(สงวน — เลิกใช้ DL33)* | | | เดิม `REVIEW_QUEUE_OVERDUE` (SLA คิวตรวจสอบ) |

ทุก alert มี `DedupeKey` (เช่น `5:wo:1042`) กันซ้ำขณะยัง New/Acknowledged · ไม่มีการ "re-nag"

---

## 5.7 Permission Catalog

| Permission | ADMIN | OPERATOR | VIEWER |
|---|:-:|:-:|:-:|
| `dashboard:view` | ✓ | ✓ | ✓ |
| `tracking:view` | ✓ | ✓ | ✓ |
| `tracking:history` | ✓ | ✓ | ✓ |
| `sessions:read` | ✓ | ✓ | ✓ |
| `work-orders:read` | ✓ | ✓ | ✓ |
| `work-orders:edit-note` | ✓ | ✓ | |
| `booking:read` | ✓ | ✓ | ✓ |
| `booking:refresh` | ✓ | ✓ | |
| `integration:view` | ✓ | | |
| `integration:manage` | ✓ | | |
| `devices:read` | ✓ | ✓ | ✓ |
| `devices:manage` / `devices:sync` (รวม depots) | ✓ | | |
| `teams:read` | ✓ | ✓ | ✓ |
| `teams:manage` | ✓ | ✓ | |
| `org:read` | ✓ | ✓ | ✓ |
| `org:manage` | ✓ | | |
| `users:read` / `users:manage` | ✓ | | |
| `roles:manage` | ✓ | | |
| `streaming:view-live` | ✓ | ✓ | |
| `streaming:live-wall` | ✓ | ✓ | |
| `streaming:talk` | ✓ | ✓ | |
| `playback:view` | ✓ | ✓ | |
| `evidence:export` / `evidence:download` | ✓ | ✓ | |
| `notifications:read` | ✓ | ✓ | ✓ |
| `alerts:view` | ✓ | ✓ | ✓ |
| `alerts:manage` | ✓ | ✓ | |
| `audit:view` | ✓ | | |
| `settings:manage` | ✓ | | |

- **ไม่มี permission ปิด/reopen ใบงาน** — สถานะใบงานตาม check-in/check-out ของ Booking **[Confirmed — Q1, Q2, Q9]**
- **ไม่มี permission link / void ใบงาน หรือ classify session** — ใบงานมาจาก Booking เท่านั้น และ session ผูกกับใบงานโดย matching อัตโนมัติ (DL33) · OPERATOR = monitor (แผนที่, live, live wall, talk), ดูย้อนหลัง/export หลักฐาน, จัดการทีม, รับทราบ alert
- **ไม่มี role `TEAM_LEADER`** — หัวหน้าทีม check-in/check-out ใน Booking app · แอปมือถือของระบบนี้สำหรับ Operator/Admin/Viewer **[Confirmed — Q18]** · ทีมและหัวหน้าทีมยังเก็บเป็นข้อมูล (`Teams`, `TeamMembers`) เพื่อใช้จับคู่กับ Booking
- การผูกกล้องกับทีม/งาน (รวมกล้องสำรอง) **มาจาก Booking เท่านั้น** (`DeviceRefs`, Booking sync) **[Confirmed — Q4, Q20]** — ไม่มี permission ผูกกล้องในระบบนี้
- `audit:view` = `ADMIN` เท่านั้น **[Confirmed — Q19]**
- ADMIN bypass permission/scope (กติกาเดิม) แต่ยังผ่าน audit
- Permission/role ใหม่ใส่ผ่าน **data migration** เท่านั้น (ไม่พึ่ง seed)
- Toggle สิทธิ์สตรีมต่อ role ผ่าน `/streams/role-access` (port `RoleStreamAccessPanel`)
