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
| 409 | สถานะไม่อนุญาต (`WORK_ORDER_NOT_OPEN`, `TEAM_HAS_OPEN_UNLINKED_WORK_ORDER`, `WORK_ORDER_FOLLOWS_BOOKING` — ใบที่ผูก Booking เปลี่ยนสถานะได้จาก Booking เท่านั้น) |
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
| GET / POST / PATCH / DELETE | `/departments[/:id]` | `org:read` / `org:manage` |
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

### Tracking & Sessions

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/tracking/positions` | `tracking:view` ✱ | snapshot ทุกอุปกรณ์ใน scope |
| GET | `/tracking/devices/:id/history?from&to` | `tracking:history` ✱ | polyline segments + stops (ไม่มี road-match) · ช่วง ≤ 24 ชม. |
| GET | `/tracking-sessions` | `sessions:read` | filter `open=true`, `deviceId`, `teamId`, `workOrderId`, `matchState`, `from`, `to` |
| GET | `/tracking-sessions/:id` | `sessions:read` | + recordings + match attempts |
| POST | `/tracking-sessions/:id/attach` | `work-orders:link` | `{ workOrderId }` หรือ `{ bookingJobId, teamId? }` — ย้าย/ผูก session (รวม session ที่อยู่ใน WO อื่น) · `teamId` **บังคับ** เมื่อ session เป็น `NoTeam` (บันทึกลง session และใช้เป็น `WorkOrders.TeamId` ถ้าต้องสร้าง WO ใหม่) · session ที่ยังเปิดอยู่ = ย้ายทั้ง session ไม่ split |
| POST | `/tracking-sessions/:id/classify` | `sessions:classify` | `{ classification, note }` (ชาร์จ/ทดสอบ/ฝึก) |

### Work Orders

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/work-orders` | `work-orders:read` | filter `status`, `linkStatus`, `teamId`, `needsReview`, `from`, `to`, `q` (เลข WO / เลข Booking / ชื่อทีม) |
| GET | `/work-orders/review-queue` | `work-orders:read` | WO ที่ **Open** และ `LinkStatus ∈ {Pending, Suggested, Ambiguous, Unlinked}` + ทุก WO ที่ `NeedsReview` (ตรงกับ `IX_WO_ReviewQueue`) · เรียงตาม `reviewSince` · คืน `slaDueAt` (= reviewSince + 36 ชม.) |
| GET | `/work-orders/:id` | `work-orders:read` | detail + booking + team + summary |
| GET | `/work-orders/:id/sessions` | `work-orders:read` | |
| GET | `/work-orders/:id/events` | `work-orders:read` | timeline |
| GET | `/work-orders/:id/match-attempts` | `work-orders:read` | |
| GET | `/work-orders/:id/booking-candidates` | `work-orders:link` | คำนวณสดจาก projection |
| POST | `/work-orders/:id/link` | `work-orders:link` | `{ bookingJobId, reason? }` + `If-Match` · อาจได้ผลเป็น merge |
| POST | `/work-orders/:id/unlink` | `work-orders:link` | `{ reason }` + `If-Match` |
| POST | `/work-orders/:id/void` | `work-orders:void` | `{ reason, classification }` + `If-Match` · **เฉพาะใบที่ไม่ผูก Booking** (ใบที่ผูกแล้ว ⇒ 409 `WORK_ORDER_FOLLOWS_BOOKING` ให้ยกเลิกฝั่ง Booking) |
| PATCH | `/work-orders/:id` | `work-orders:edit-note` | `{ note }` + `If-Match` (แก้ได้แค่หมายเหตุ) |
| POST | `/work-orders/:id/review/clear` | `work-orders:link` | ล้าง `NeedsReview` `{ note }` |

### Booking & Integration

| Method | Path | Permission | หมายเหตุ |
|---|---|---|---|
| GET | `/booking-jobs` | `booking:read` | projection · filter `from`, `to`, `teamId`, `status`, `linked`, `q` |
| GET | `/booking-jobs/:id` | `booking:read` | + WO ที่ link + `raw` (เฉพาะ `integration:view`) |
| POST | `/booking-jobs/:id/refresh` | `booking:refresh` | `fetchJob` สด (timeout 5s · 503 ถ้าไม่ได้) |
| GET | `/integration/status` | `integration:view` | breaker, lag, counts |
| GET | `/integration/inbox?status` · `/integration/outbox?status` · `/integration/call-logs` | `integration:view` | |
| POST | `/integration/inbox/:id/retry` · `/integration/outbox/:id/retry` | `integration:manage` | |
| POST | `/integration/booking/sync` | `integration:manage` | `{ mode: 'incremental' \| 'full', from?, to? }` → 202 |
| GET | `/integration/mapping-issues` | `integration:view` | ref ที่ map ไม่ได้ |
| POST | `/integration/booking/webhooks` | Public + HMAC | **[Assumption]** → 202 |
| POST | `/integration/webhooks/device-location` · `/device-status` | Public + HMAC ✱ | จาก vendor กล้อง |

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

### GET `/api/work-orders?status=1&linkStatus=3,4,5&page=1&pageSize=20`

```json
{
  "data": [
    {
      "id": "1042",
      "workOrderNo": "WO-202611-00042",
      "title": "ใบงานอัตโนมัติ TEAM-07 BWC-0031",
      "status": 1,
      "linkStatus": 3,
      "linkConfidence": 2,
      "needsReview": false,
      "team": { "id": "7", "code": "TEAM-07", "name": "ทีมติดตั้ง 7" },
      "leader": { "id": "315", "name": "สมชาย ใจดี" },
      "booking": null,
      "suggestedBooking": { "id": "8801", "externalJobNo": "BK-2611-0193", "plannedStartAt": "2026-11-03T02:00:00.000Z" },
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
  "linkStatus": 2,
  "linkSource": 1,
  "linkConfidence": 1,
  "linkedAt": "2026-11-03T00:46:30.000Z",
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
  "availableActions": ["unlink", "editNote", "exportEvidence"],
  "rowVersion": 4
}
```

`availableActions` คำนวณที่ server (pattern จาก `/my-jobs` ของ reference) — client ไม่เดากติกาเอง · **ไม่มีปุ่มปิด/reopen** เพราะสถานะตาม Booking check-in/check-out (`closedAt` = เวลา check-out)

### POST `/api/work-orders/1042/link`

```http
POST /api/work-orders/1042/link
If-Match: 3
Content-Type: application/json

{ "bookingJobId": "8801", "reason": "ยืนยันจากหัวหน้าทีมทางโทรศัพท์" }
```

```json
{ "id": "1042", "linkStatus": 2, "linkSource": 2, "result": "linked", "rowVersion": 4 }
```

กรณีงานนั้นมี WO อยู่แล้ว: `{ "id": "1042", "status": 5, "result": "merged", "mergedIntoWorkOrderId": "1037" }`

### POST `/api/work-orders/1042/void` — error ตัวอย่าง

```json
{
  "statusCode": 409,
  "code": "WORK_ORDER_FOLLOWS_BOOKING",
  "message": "ใบงานนี้ผูกกับ Booking แล้ว สถานะเปลี่ยนได้จากระบบ Booking เท่านั้น",
  "details": { "bookingJobNo": "BK-2611-0193" },
  "correlationId": "7c1d2f0e5b6a4a1f"
}
```

### GET `/api/tracking-sessions?open=true`

```json
{
  "data": [
    {
      "id": "55120",
      "device": { "id": "31", "code": "BWC-0031", "name": "กล้องทีม 7" },
      "team": { "id": "7", "code": "TEAM-07" },
      "workOrder": { "id": "1042", "workOrderNo": "WO-202611-00042", "linkStatus": 2 },
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
    "outbox": { "pending": 0, "failed": 0, "dead": 0, "writebackEnabled": false },
    "mappingIssues": 2,
    "lastFullSyncAt": "2026-11-02T19:00:04.000Z"
  }
}
```

### Booking webhook ขาเข้า [Assumption]

```http
POST /api/integration/booking/webhooks
X-Booking-Timestamp: 1793667600
X-Booking-Signature: sha256=4f0c…
Content-Type: application/json

{ "eventId": "evt_01JC…", "type": "job.updated", "jobId": "c1f0a9e2", "occurredAt": "2026-11-03T03:00:00Z" }
```

ตอบ `202 { "accepted": true }` เสมอเมื่อ signature ผ่าน (รวมกรณีซ้ำ) · signature ไม่ผ่าน = 401 · body เกิน 256 KB = 413

---

## 5.4 Mobile API (Operator — monitoring และตรวจสอบหลักฐาน)

ผู้ใช้แอป = ฝั่งตรวจสอบใบงาน/หลักฐานและ monitoring (`OPERATOR`, `ADMIN`, `VIEWER`) — **ไม่ใช่พนักงานภาคสนาม** **[Confirmed — Q18]** · port แนวทางจาก `docs/MOBILE-API-CONTRACT.md` ของ reference เฉพาะ login/SSO/refresh body-mode, ทะเบียนเครื่อง, push token, notifications — **ตัด PIN, my-jobs, approval, delegation, attachments, sites**

แอปเรียก **API ชุดเดียวกับ web** (permission + scope เดียวกัน): `/work-orders*`, `/tracking/*`, `/tracking-sessions*`, `/streams/*`, `/evidence-exports*`, `/alerts*`, `/notifications*` · เพิ่มเฉพาะ:

| Method | Path | Permission | Response หลัก |
|---|---|---|---|
| GET | `/mobile/overview` | `dashboard:view` | สรุปหน้าแรก: กล้อง online/ดับระหว่างงาน · ใบงานเปิดอยู่ · คิวตรวจสอบ · alert ล่าสุด · สถานะ Booking sync |
| GET / PATCH / DELETE | `/auth/devices[/:id]` | login | ทะเบียนเครื่อง (`deviceName`, `pushEnabled`) — ไม่มี PIN |
| POST / GET / DELETE | `/notifications/push-tokens[/:token]` | `notifications:read` | FCM token |

`GET /mobile/overview` ตัวอย่าง:

```json
{
  "devices": { "online": 42, "offline": 11, "unknown": 3, "offlineDuringJob": 1 },
  "workOrders": { "open": 18, "reviewQueue": 4, "noCheckout": 1 },
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
| `device:status` ✱ | tracking rooms | `{ deviceId, platformState, stateSince, source }` | แผนที่, รายการอุปกรณ์ |
| `session:opened` | tracking rooms | `{ sessionId, deviceId, teamId, workOrderId, startedAt }` | Active sessions, dashboard |
| `session:closed` | tracking rooms | `{ sessionId, deviceId, workOrderId, endedAt, endReason }` | |
| `workorder:changed` | `dept:{id}` | `{ workOrderId, status, linkStatus, needsReview, rowVersion, change: 'created'\|'linked'\|'closed'\|... }` | WO list/detail (invalidate query), mobile |
| `alert:new` ✱ | alert rooms / `user:{id}` | `{ alertId, alertType, severity, title, message, workOrderId?, deviceId? }` | toast, bell |
| `stream:status` ✱ | `user:{id}` | `{ sessionToken, status, endReason }` | player |
| `integration:status` | `org` (ทุกคน — payload ไม่มีข้อมูลอ่อนไหว) | `{ source: 'BOOKING', isStale, lastSuccessAt }` · admin ดูรายละเอียด breaker/lag จาก `/integration/status` | banner "Booking data stale" ทุกหน้าที่แสดงข้อมูล Booking |
| `session:revoked` ✱ | `user:{id}` | `{ scope: 'account' \| 'device', reason }` | logout ทันที |

Client: queue + flush, REST snapshot เมื่อ reconnect (pattern `useLivePositions` / `liveMerge` ของ reference) · `workorder:changed` → `queryClient.invalidateQueries(['work-orders'])` (debounce 800ms)

---

## 5.6 Alert Types

ตั้งเลขใหม่ (ฐานข้อมูลใหม่ ไม่ต้องสืบทอดเลขที่ retired ของ reference)

| # | Code | Severity | ผู้รับ | เงื่อนไข |
|---|---|---|---|---|
| 1 | `CAMERA_ACTIVE_UNLINKED` | Info | Operator ของแผนก | WO ใหม่ที่ `Unlinked` |
| 2 | `BOOKING_MATCH_SUGGESTED` | Info | Operator | WO `Suggested` |
| 3 | `BOOKING_MATCH_AMBIGUOUS` | Warning | Operator | WO `Ambiguous` |
| 4 | `CAMERA_ACTIVE_NO_TEAM` | Warning | Admin + Operator | กล้องเปิดใช้แต่ Booking ยังไม่ผูกกล้องนี้กับทีม/งาน (เข้าใบรวมของกล้อง) |
| 5 | `DEVICE_OFFLINE_DURING_JOB` | Warning | Operator | WO linked Open, Booking ช่วงงานยังไม่จบ, กล้อง offline ≥ `alert.offline-during-job-minutes` (10) |
| 6 | `WORK_ORDER_AUTO_CLOSED` | Info | Operator | ปิดด้วย SafetyTimeout (ผูก Booking แต่ไม่มี check-out ครบ 7 วัน) หรือ NoBookingData (ใบรวมไม่มีข้อมูล Booking ครบ 240 นาที) |
| 7 | `WORK_ORDER_CANCELLED_WITH_EVIDENCE` | Warning | Operator + Admin | Booking ยกเลิกแต่มี recording |
| 8 | `BOOKING_JOB_CHANGED_AFTER_CLOSE` | Info | Operator | |
| 9 | `RECORDING_OUTSIDE_WORK` | Warning | Operator | session ที่ไม่มี WO linked มี recording ≥ 10 นาที |
| 10 | `BOOKING_SYNC_STALE` | Warning / Critical | Admin | lag > 15 / > 60 นาที |
| 11 | `INTEGRATION_DEAD_LETTER` | Warning | Admin | inbox/outbox `Dead` |
| 12 | `BOOKING_MAPPING_ISSUES` | Info | Admin | รายวัน |
| 13 | `DEVICE_VENDOR_MISSING` | Warning | Admin | device sync ไม่พบเครื่องใน DSS |
| 14 | `WORK_ORDER_NO_CHECKOUT` | Warning | Operator | ใบงานผูก Booking แล้วไม่มี check-out เกิน 36 ชม. นับจาก `OpenedAt` (`workorder.stale-open-hours`) |
| 15 | `WORK_ORDER_AUTO_VOIDED` | Info | Operator | ใบรวมถูก void อัตโนมัติเพราะไม่มี recording (สงสัยกล้องชาร์จ) — ตรวจย้อนได้ |
| 16 | `REVIEW_QUEUE_OVERDUE` | Warning | Operator + Admin | ใบงานอยู่ในคิวตรวจสอบเกิน 36 ชม. (`review.sla-hours`) — ครั้งเดียวต่อใบ |

ทุก alert มี `DedupeKey` (เช่น `5:wo:1042`) กันซ้ำขณะยัง New/Acknowledged · ไม่มีการ "re-nag"

---

## 5.7 Permission Catalog

| Permission | ADMIN | OPERATOR | VIEWER |
|---|:-:|:-:|:-:|
| `dashboard:view` | ✓ | ✓ | ✓ |
| `tracking:view` | ✓ | ✓ | ✓ |
| `tracking:history` | ✓ | ✓ | ✓ |
| `sessions:read` | ✓ | ✓ | ✓ |
| `sessions:classify` | ✓ | ✓ | |
| `work-orders:read` | ✓ | ✓ | ✓ |
| `work-orders:link` | ✓ | ✓ | |
| `work-orders:void` | ✓ | | |
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

- **ไม่มี permission ปิด/reopen ใบงาน** — สถานะใบงานที่ผูก Booking ตาม check-in/check-out ของ Booking **[Confirmed — Q1, Q2, Q9]** · void = `ADMIN` เฉพาะใบที่ไม่ผูก Booking
- **ไม่มี role `TEAM_LEADER`** — หัวหน้าทีม check-in/check-out ใน Booking app · แอปมือถือของระบบนี้สำหรับ Operator/Admin/Viewer **[Confirmed — Q18]** · ทีมและหัวหน้าทีมยังเก็บเป็นข้อมูล (`Teams`, `TeamMembers`) เพื่อใช้จับคู่กับ Booking
- การผูกกล้องกับทีม/งาน (รวมกล้องสำรอง) **มาจาก Booking เท่านั้น** (`DeviceRefs`, Booking sync) **[Confirmed — Q4, Q20]** — ไม่มี permission ผูกกล้องในระบบนี้
- `audit:view` = `ADMIN` เท่านั้น **[Confirmed — Q19]**
- ADMIN bypass permission/scope (กติกาเดิม) แต่ยังผ่าน audit
- Permission/role ใหม่ใส่ผ่าน **data migration** เท่านั้น (ไม่พึ่ง seed)
- Toggle สิทธิ์สตรีมต่อ role ผ่าน `/streams/role-access` (port `RoleStreamAccessPanel`)
