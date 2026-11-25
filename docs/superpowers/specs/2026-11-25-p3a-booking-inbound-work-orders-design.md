# P3a รับใบงานจาก Booking (mock) + หน้า ใบงาน คู่กล้องจริง — design

> อัปเดตตาม DL80: ไม่มี Employees แล้ว ใช้ Users.BookingEmployeeRef และ TeamMembers.UserId; fixture ผู้ใช้สร้างผ่าน createTestUsers แทนการสร้างพนักงาน

วันที่ 2026-11-25 · ขนาดงาน: โปรเจกต์ · อ้างอิง: Part 8 §P3a, Part 7, Part 4 §4.4, Part 5 §5.2–5.3, Part 3 §3.6, Part 2 §2.4

## 1. เป้าหมายและเหตุผล

ผู้ใช้อยาก **เห็นใบงานคู่กับกล้องจริงบนจอ** ก่อนที่ Smart Booking จะส่ง spec มา:
- ใบงานมาจาก `booking-simulator` ที่ POST เข้า endpoint จริงของเรา (contract v1 ของเรา — ทุกอย่างเกี่ยวกับ Booking ยังเป็น **[Assumption]**)
- กล้อง / สถานะ / GPS มาจาก DSS จริง (dev ตั้ง `DSS_DRIVER=dss` · กล้องจริงตอนนี้ 1 ตัว `1000027`)
- เปิดหน้า ใบงาน แล้วเห็นใบงานจำลอง พร้อมกล้องของงานและสถานะ ออนไลน์ / ออฟไลน์ จาก DSS

**ทำ**
- P3a ตาม roadmap ยกเว้น read API (ดู §2): inbound endpoint + guard, inbox, คิว `booking-inbox`, mapper `v1`, projection `BookingJobs`, upsert `WorkOrders` 1:1, ทีม / หัวหน้าทีมจาก ref, `booking-simulator`
- ส่วนของ P2 ที่ต้องใช้ให้เห็นบนจอ: `GET /work-orders`, `GET /work-orders/:id`, `GET /work-orders/:id/events`, หน้า `/work-orders` และ `/work-orders/:id` แบบอ่านอย่างเดียว, push `workorder:changed`

**ไม่ทำ (ย้ายไป phase อื่น)**
- read API ขาออก (`BookingProvider` http / mock), circuit breaker, `POST /booking-jobs/:id/refresh`, sync `DeviceAssignments` ⇒ **P3c** (ยังไม่รู้ว่า Booking มี read API)
- matching / คิว `matching` / `MatchAttempts`, alert 10 / 11 / 12 / 17, `POST /integration/inbox/:id/retry`, settings `booking.*` ⇒ **P3b** (ตามที่ roadmap แบ่งไว้ + settings ไม่มีผู้ใช้จนถึง alert)
- session engine, `TrackingSessions`, badge `NeedsReview` 36 ชม. / `SafetyTimeout` 7 วัน, `PATCH` หมายเหตุ, ปุ่ม ดูสด / ดูย้อนหลัง, filter ทีม / ช่วงเวลา, deep link `by-booking` ⇒ **P2 / P4 / P3c**
- retention ลบ inbox / call logs 30 วัน ⇒ **P6**

**ห้ามเกิด**
- ใบงานซ้ำต่อ 1 งานของ Booking, เลขใบงานซ้ำ, ทีมซ้ำต่อ `teamRef`
- POST ที่ตอบ 202 แล้วหาย (ข้อมูลดิบต้องอยู่ใน `IntegrationInbox` ก่อนตอบเสมอ)
- api เขียน `BookingJobs` / `WorkOrders` เอง (เป็นงานของ worker `integration` เท่านั้น — Part 2 §2.4)
- ข้อความบนจอบอกที่มาว่า Booking (DL64 — ยกเว้นป้ายเลขอ้างอิง "เลข Booking")
- เส้นทาง Booking กระทบ GPS / สถานะกล้อง (เส้นทางแยกกัน)

## 2. Approaches

| แบบ | สรุป | ข้อดี / ข้อเสีย |
|---|---|---|
| ก. ตาม blueprint ครบ | BullMQ + read API + breaker + driver mock | ครบตาม Part 8 · ใหญ่สุด · read API อาจต้องรื้อเมื่อได้ spec จริง |
| **ข. ตาม blueprint ไม่มี read API (เลือก — Q54)** | BullMQ `booking-inbox` + retry sweep · read API / breaker ไป P3c · เพิ่ม API + หน้า ใบงาน อ่านอย่างเดียว | เส้นทางจริงครบจาก endpoint ถึงจอ · ไม่ทำของที่ยังไม่รู้ว่าได้ใช้ · ต้องเพิ่ม dependency `bullmq` + `ioredis` (ต้องใช้อยู่แล้วใน P3b / P4) |
| ค. ไม่ใช้ BullMQ | worker วนอ่าน inbox ทุก 2 วินาที | ไม่มี dependency ใหม่ · ต่างจาก blueprint และต้องติดตั้ง BullMQ ใน P3b อยู่ดี |

## 3. ที่ผู้ใช้ตัดสินแล้ว

- ใบงาน mock ผ่าน simulator · กล้อง / GPS ใช้ DSS จริง (Q54)
- รอบนี้ทำหน้า ใบงาน ด้วย เพื่อเห็นใบงานคู่กล้องจริงบนจอ (Q54)
- แบบ ข (Q54)
- หัวหน้าทีมเปลี่ยนตามใบงาน **เฉพาะตอนเข้างาน** (check-in แล้ว ยังไม่ check-out) — ใบล่วงหน้า / ปิดแล้ว / ยกเลิก ไม่เปลี่ยน (Q55 · แก้ DL53 ที่ให้เปลี่ยนทุกข้อความ)

## 4. Design — server

### 4.1 Dependency + การเชื่อม Redis ของคิว

- เพิ่ม `bullmq` + `ioredis` (เวอร์ชันล่าสุดที่ออกมาแล้วอย่างน้อย 2 สัปดาห์) · `common/queue/`: `QueueModule` สร้าง connection `ioredis` จาก `REDIS_URL` (`maxRetriesPerRequest: null` ตามที่ BullMQ ต้องการ) + prefix ชื่อคิวด้วยชื่อ database แบบ `cacheKey()` (dev / test ใช้ Redis ตัวเดียวกันไม่ชนกัน)
- api ใช้แค่ `Queue.add` · worker role `integration` เปิด `Worker` · Redis ล่ม ⇒ api ยังตอบ 202 (inbox เก็บแล้ว) และ sweep เก็บทีหลัง

### 4.2 ตาราง (migration ใหม่ `0012_p3a_booking` + custom SQL ถ้าต้องใช้) — ชื่อตาม Part 4 §4.4

สร้าง: `IntegrationInbox`, `IntegrationSyncState`, `IntegrationCallLogs`, `BookingJobs`, `WorkOrders`, `WorkOrderCounters`, `WorkOrderEvents` (คอลัมน์ / index / constraint ตาม §4.4 ทุกตัว) และ:
- เพิ่ม FK `Alerts.WorkOrderId` → `WorkOrders`, `Alerts.BookingJobId` → `BookingJobs` (Part 4 บอกให้เพิ่มใน phase ที่สร้างตาราง)
- `Teams.Code` varchar(30) ⇒ **varchar(64)** (เพราะ Code = `teamRef` ยาวได้ 64 — แก้ Part 4)
- **`CK_WO_Closed`** = `("Status" IN (2,3)) = ("ClosedAt" IS NOT NULL)` — Planned / Open ไม่มี `ClosedAt`, Closed / Cancelled ต้องมี (ของเดิม `Status = 1 OR ClosedAt IS NOT NULL` ใส่ Planned ไม่ได้ — แก้ Part 4)
- ไม่สร้าง `DeviceAssignments`, `MatchAttempts`, `TrackingSessions` (ยังไม่มีผู้ใช้)

### 4.3 Inbound endpoint `POST /api/integration/booking/jobs` (process `api`)

- `@Public()` · `@RateLimit('booking-inbound')` (600/นาที/IP · env `BOOKING_INBOUND_RATE_LIMIT_PER_MIN`) · `BookingInboundAuthGuard` ระดับ route
- ลำดับจริง: rate limit (global guard) → guard ของ route — ต่างจาก Part 7 ที่เขียน auth ก่อน rate limit · ยอมรับ เพราะผลต่อ Booking เหมือนกัน (แก้ Part 7)
- **Guard**: `Content-Type` ต้องเป็น `application/json` (415 `UNSUPPORTED_MEDIA_TYPE`) → body ดิบ ≤ 256 KB (413 `PAYLOAD_TOO_LARGE`) → CIDR (`BOOKING_INBOUND_ALLOWED_CIDRS` ถ้าตั้ง) → `X-Booking-Timestamp` ห่างเวลา server ≤ 300 วินาที → `BOOKING_INBOUND_AUTH=hmac` (ค่าเริ่มต้น): `X-Booking-Signature: sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) เทียบแบบ constant-time กับทุก secret ใน `BOOKING_INBOUND_SECRETS` (คั่น comma, ≤ 2) · `api-key`: `X-Api-Key` เทียบ constant-time · ผิดข้อไหนก็ 401 `INBOUND_AUTH_FAILED` ข้อความเดียวกัน · ไม่ log secret / signature / body เต็ม
- ไม่ได้ตั้ง `BOOKING_INBOUND_SECRETS` ⇒ endpoint ตอบ 401 เสมอ (ปิดโดยปริยาย) และ `prod:check` แจ้งเตือน · ค่าใดสั้นกว่า 32 ตัวหรือยังมี `CHANGE_ME` ⇒ `prod:check` fail
- **DTO**: controller รับ body เป็น `unknown` แล้ว validate เองด้วย class-validator แบบไม่ตัด / ไม่ปฏิเสธฟิลด์ที่ไม่รู้จัก (global `ValidationPipe` ใช้ `forbidNonWhitelisted` — ใช้กับ route นี้ไม่ได้) · บังคับ: `job.jobId` (string ≤ 100), `job.status` (string ≤ 50), มี `job.version` (integer ≥ 0) หรือ `job.updatedAt` (ISO-8601 มี offset) อย่างน้อยหนึ่ง · ผิด ⇒ 400 `VALIDATION_FAILED` + `details: [{ field, issue }]`
- **ฟิลด์ที่รู้จักแต่ไม่บังคับ — ตรวจเข้ม (ผู้ออกแบบ)**: ถ้าส่งมา ต้องถูกชนิดและไม่เกินความยาวคอลัมน์ ไม่งั้น 400 — `eventId` ≤ 200, `eventType` ≤ 50, `jobNo` / `doNo` / `shNo` ≤ 50, `teamRef` / `leaderRef` / ทุกตัวใน `deviceRefs` ≤ 64 (string[] ≤ 50 ตัว), วันที่ทุกช่องอ่านได้ (ISO-8601 มี offset), `scheduledDate` = `YYYY-MM-DD`, `site.lat` −90..90 / `site.lng` −180..180 เป็นตัวเลข · ข้อความอิสระ `title` (300), `site.name` (300), `site.address` (1000) **ตัดให้พอดี ไม่ปฏิเสธ** · เหตุผล: ค่าที่ api รับแล้ว worker เก็บไม่ได้ จะทำให้ inbox ค้าง `Dead` เงียบ ๆ และส่งซ้ำก็ได้แค่ `duplicate` — ปฏิเสธตั้งแต่ทางเข้าให้ Booking เห็นเอง และ JSON Schema ที่ให้ Booking (Part 7 §7.13) ระบุขอบเขตเดียวกัน
- **`ExternalEventId`** = `eventId` ?? `${jobId}:${version}` ?? `${jobId}:${updatedAt เป็น ISO UTC มิลลิวินาที}` (ปรับรูปแบบก่อน เพื่อให้เวลาเดียวกันที่เขียนต่างรูปได้ id เดียวกัน)
- **Transaction เดียว**: `INSERT IntegrationInbox` (`Source='BOOKING'`, `Channel=1`, `Status=1 Pending`, `Payload` = body ทั้งก้อน) `ON CONFLICT ("Source","ExternalEventId") DO NOTHING RETURNING "Id"` + upsert `IntegrationSyncState('BOOKING','jobs').LastReceivedAt = now()` (ทั้ง accepted และ duplicate — คือ Booking ยังส่งมา)
- หลัง commit: accepted ⇒ `booking-inbox.add({ inboxId }, { jobId: 'inbox:'+id })` (พังก็ log แล้วตอบ 202 ต่อ) ⇒ 202 `{ status: 'accepted', externalJobId, correlationId }` · ซ้ำ ⇒ 200 `{ status: 'duplicate', externalJobId, correlationId }` · DB ล่ม ⇒ 503 `SERVICE_UNAVAILABLE`
- **`IntegrationCallLogs`** (`Direction=2`, `Operation='inbound.job'`, `HttpStatus`, `LatencyMs`, `CorrelationId`, `Outcome` 1 Success (200/202) หรือ 2 HttpError (4xx/5xx), `RequestExcerpt` = body ตัดที่ 4 KB หลังลบ header ลับ): เขียนทั้ง 2xx / 400 / 401 / 413 / 415 / 503 — guard เขียนเองตอนปฏิเสธ (401 ไม่ผ่าน interceptor), ที่เหลือเขียนโดย interceptor ของ route · ไม่ใช้ `@Audit` (`AuditLogs` เป็นของการกระทำของผู้ใช้) — แก้ Part 7 / Part 8 ที่เขียนว่า `@Audit`
- 429 จาก rate limit ไม่ลง call log (เกิดก่อนถึง route)

### 4.4 ประมวลผล inbox (worker role `integration`)

- `BookingInboxProcessor` = BullMQ `Worker('booking-inbox', concurrency 4)` → `processInbox(inboxId)`
- `processInbox`: transaction · `SELECT … FROM "IntegrationInbox" WHERE "Id"=$1 AND "Status" IN (1,3) FOR UPDATE SKIP LOCKED` (ไม่เจอ = มีคนทำอยู่ / ทำแล้ว ⇒ จบ) → mapper `v1` → projection + WO upsert + ทีม (§4.5–4.7) → inbox `Status=2 Processed` หรือ `4 Ignored` (ข้อมูลเก่ากว่า) + `ProcessedAt` · ผิดพลาด ⇒ rollback แล้ว transaction ใหม่ตั้ง `Status=3 Failed`, `Attempts+1`, `LastError` · ครบ **10** ครั้ง ⇒ `5 Dead` (ตาม Part 7 / Part 2 §2.6 ข้อที่เจาะจงคิวนี้ — ไม่ใช่ 5 ครั้งของกติกาทั่วไป)
- **retry sweep** ใน worker เดียวกัน: loop ทุก 5 นาที + ตอน start (lease ด้วย `RedisLockService` แบบงานอื่น · Redis ล่มก็ยังวิ่ง ใช้ `FOR UPDATE SKIP LOCKED` กันซ้ำ) หยิบ `Pending` ที่เก่ากว่า 1 นาที + `Failed` ตามลำดับ `ReceivedAt` ทีละ ≤ 200 แถว แล้ว `processInbox` ตรง (ไม่ผ่านคิว — ใช้ได้แม้ Redis ล่ม)
- ไม่มีการเรียก Booking ขาออก (read API ไป P3c)

### 4.5 Mapper `v1` + projection `BookingJobs`

- `BookingInboundMapper` (token `BOOKING_INBOUND_MAPPER`, env `BOOKING_INBOUND_MAPPER=v1` — ค่าอื่นตอนนี้ ⇒ boot ไม่ขึ้นพร้อมข้อความ) → `BookingJobSnapshot` (ฟิลด์ตาม Part 7 §7.5)
- status map คงที่ใน code (Part 7 §7.6): `NEW`/`SCHEDULED`→1, `CONFIRMED`/`ASSIGNED`→2, `IN_PROGRESS`/`ON_SITE`→3, `DONE`/`COMPLETED`/`CLOSED`→4, `CANCELLED`/`REJECTED`→5, อื่น→9 + `MappingIssues` 3 (เทียบแบบไม่สนตัวพิมพ์) · setting `booking.status-map` ยังไม่ทำ (รอ spec — P3c)
- upsert ตาม Part 7 §7.7: `ON CONFLICT ("SourceSystem","ExternalJobId") DO UPDATE … WHERE` ข้อมูลใหม่ไม่เก่ากว่า: มี `updatedAt` ทั้งคู่และต่างกัน ⇒ เทียบ `ExternalUpdatedAt` · `updatedAt` เท่ากัน หรือฝั่งใดไม่มี ⇒ เทียบ `version` เป็นตัวเลข (`ExternalVersion` เก็บเป็น string ตาม Part 4 · version เท่ากันยังผ่าน) · ไม่ผ่าน ⇒ inbox `Ignored` ไม่แตะอะไรต่อ (รวมทีม / หัวหน้า)
- `PayloadHash` = sha256 ของ `job` ที่เรียง key · `DeviceRefs` เก็บตามที่ส่งมา (ตัดซ้ำ) · `MappingIssues` คำนวณใหม่ทุกครั้ง: 2 `leaderRef` ไม่ตรงผู้ใช้, 3 status ไม่รู้จัก, 5 `deviceRef` ไม่ตรงกล้อง (`Devices.DeviceCode` / `VendorDeviceId` / `SerialNo`, ไม่นับที่ลบแล้ว) · ปัญหา mapping ไม่ทำให้ข้อความ fail

### 4.6 ทีม / หัวหน้าทีม (transaction เดียวกัน — DL53 [Assumption])

- `teamRef` ใหม่ ⇒ `INSERT Teams (Code=Name=BookingTeamRef=teamRef) ON CONFLICT` (unique `UQ_Teams_BookingRef`) — ส่งซ้ำไม่เกิดทีมซ้ำ · ไม่มี `teamRef` ⇒ `TeamId` null
- **เปลี่ยนหัวหน้าทีมเฉพาะตอนเข้างาน (Q55)**: ทำเมื่อหลังข้อความนี้งานอยู่ในสถานะเข้างาน — มี `checkInAt` และยังไม่ check-out (ใบงาน `Open`) · ใบงานล่วงหน้า (Planned), ปิดแล้ว, ยกเลิก **ไม่เปลี่ยนหัวหน้าของทีม** (แต่ `BookingJobs.LeaderUserId` / `WorkOrders.LeaderUserId` ของใบนั้นยังตั้งตาม `leaderRef` เสมอ — หัวหน้าเห็นงานของตัวเองก่อน check-in ได้ใน P5)
- เข้างานแล้ว และ `leaderRef` ตรง `Users.BookingEmployeeRef` และยังไม่ใช่หัวหน้าที่ active ของทีมนั้น ⇒ ปิดแถว Leader เดิมของทีม (`ValidTo=now()`), ปิด membership active อื่นของผู้ใช้คนนั้น, เปิดแถว Leader ใหม่ (`AssignedBy` null) — ล็อกแถวทีมก่อน (`SELECT … FOR UPDATE` บน `Teams`) กัน 2 ข้อความแข่งกัน · `leaderRef` ไม่ตรงผู้ใช้ (ทุกสถานะ) ⇒ `LeaderUserId` null + `MappingIssues` 2

### 4.7 Upsert `WorkOrders` (writer ของ module `work-orders` — ข้อยกเว้นเดียวที่ booking-integration เรียกได้)

- 1:1 ด้วย `UQ_WO_BookingJob` · ใบใหม่ได้เลขจาก `WorkOrderCounters` (`INSERT … ON CONFLICT DO UPDATE SET "LastValue"="LastValue"+1 RETURNING`) รูปแบบ `WO-YYYYMM-NNNNN` (เดือนตามเวลาไทยของเวลาที่สร้าง)
- `Title` = `job.title` ?? `job.jobNo` ?? `externalJobId` (คอลัมน์ NOT NULL แต่ Booking ไม่บังคับส่ง)
- สถานะตามเวลา check-in / check-out (Part 3 §3.6 + Part 7):
  - ยกเลิก (canonical 5) ⇒ ใบที่ยังไม่ปิด → `Cancelled`, `ClosedAt=now()` · ใบที่ `Closed` อยู่แล้ว → สถานะเดิม + `NeedsReview` เหตุผล 1 `BookingChangedAfterClose`
  - มี `checkOutAt` และ (`checkInAt` ไม่มี หรือ ≤ `checkOutAt`) หรือ canonical 4 ⇒ `Closed`, `CloseReason=1 BookingCheckout`, `ClosedAt` = `checkOutAt` ?? now()
  - มี `checkInAt` และ (ไม่มี `checkOutAt` หรือ `checkInAt` > `checkOutAt`) ⇒ `Open`, `OpenedAt=checkInAt`, `ClosedAt=null`, `CloseReason=null` (รวม reopen หลังปิด)
  - ไม่มีทั้งคู่ ⇒ `Planned` (canonical 3 แต่ไม่มี check-in ก็ยัง Planned — สถานะใบงานตามเวลา check-in เท่านั้น)
  - ใบ `Cancelled` แล้วได้ check-in ใหม่ ⇒ Open (Booking เปลี่ยนใจ)
- ใบที่ `Closed` แล้วข้อมูลทีม / หัวหน้า / เวลาแผน / `DeviceRefs` เปลี่ยน (และไม่ใช่การ reopen) ⇒ `NeedsReview` + เหตุผล 1 · `CancelledWithEvidence` (2) ต้องรู้ว่ามีวิดีโอ ⇒ P2
- `TeamId`, `LeaderUserId`, `Title` ตามข้อมูลล่าสุด · `RowVersion+1` และ `UpdatedAt=now()` เมื่อมีอะไรเปลี่ยน · **`LastActivityAt` ไม่แตะ** (Part 4: เวลากิจกรรมของ session — P2 เป็นผู้เขียน · P3a ปล่อย null)
- `WorkOrderEvents` ใน transaction เดียวกัน: ใบใหม่ `1 Created` · สถานะเปลี่ยน `2 StatusChanged` (`FromStatus`/`ToStatus`, `Reason`) · `Source=2 Booking`, `BookingJobId`
- **หลัง commit**: emit `workorder:changed` `{ workOrderId, status, needsReview, rowVersion, change: 'created' | 'statusChanged' | 'updated' }` เข้า room `tracking` + `team:{teamId}` ผ่าน `RealtimeGateway.bus` (Redis emitter ใน worker)
- **ไม่ enqueue `matching.rematch`** — ยังไม่มีผู้รับ (P3b) งานจะค้างใน Redis เปล่า ๆ · P3b เพิ่มตอนทำ matcher (แก้ Part 8 / Part 7)

### 4.8 API ใบงาน (process `api` · `@RequirePermission('work-orders:read')` + `@Audit` ตามกติกาเดิมของ GET)

- `GET /work-orders?status=&q=&page=&pageSize=` — `status` = 6 / 1 / 2 / 3 (ไม่ส่ง = ทุกสถานะ) · `q` ค้นเลข WO / `ExternalJobNo` / `ExternalJobId` / `DoNo` / `ShNo` / ชื่อทีม (ILIKE) · เรียง `Planned` และ `Open` ก่อน แล้วตามเวลาล่าสุด (`COALESCE(OpenedAt, PlannedStartAt, CreatedAt) DESC`, `Id DESC`) · pageSize ≤ 100 · envelope `{ data, page, pageSize, total }`
- แถวตาม Part 5 §5.3: `id, workOrderNo, title, status, needsReview, team, leader, booking { id, externalJobNo, doNo, shNo, plannedStartAt, plannedEndAt, siteName }, workWindow, openedAt, closedAt, lastActivityAt (null จนถึง P2), cameras[], rowVersion`
- `cameras[]` = `DeviceRefs` ของงาน (ลำดับตามที่ส่งมา) → `{ deviceRef, deviceId | null, deviceCode | null, name | null, platformState: 'online'|'offline'|'unknown', platformStatusFetchedAt, fromSession: false }` · สถานะจาก `DeviceStatusDisplayService.statuses()` ครั้งเดียวต่อหน้า (cache Redis 10 วินาที — DL45, fail-open) · ref ที่ไม่ตรงกล้อง ⇒ `deviceId: null`, `platformState: 'unknown'` · `fromSession: true` มาใน P2
- `workWindow` ตาม Part 5: `from` = `BookingCheckInAt` (null ⇒ `workWindow=null`), `to` = `BookingCheckOutAt` ?? `ClosedAt` ?? null
- `GET /work-orders/:id` — แถวเดียวกัน + `closeReason, reviewReasons, note, availableActions: []` + `booking` · ไม่เจอ ⇒ 404 · `summary` (session) และ `isStale` ยังไม่ส่ง (P2 / P3b)
- **`booking` ของ detail ตามสิทธิ์ `booking:read`** (Part 5 §5.7): มีสิทธิ์ ⇒ ทั้งก้อน `{ id, sourceSystem, externalJobId, externalJobNo, doNo, shNo, status, rawStatus, plannedStartAt, plannedEndAt, scheduledDate, checkInAt, checkOutAt, deviceRefs, site { name, address, lat, lng }, lastSyncedAt, detail: true }` · ไม่มี ⇒ เท่าที่แถวในรายการมี (`{ id, externalJobNo, doNo, shNo, plannedStartAt, plannedEndAt, siteName, detail: false }`) · แถวในรายการใช้แค่ `work-orders:read` ตามตัวอย่าง Part 5 · client แสดง panel "ข้อมูลงาน" เต็มเมื่อ `detail: true`
- `GET /work-orders/:id/events` — timeline เรียง `OccurredAt` (ไม่ paging — ใบงานหนึ่งมี event ไม่มาก)
- scope: role web ทุกตัวเป็น `all` · `TEAM_LEADER` ไม่มี `work-orders:read` บน web (มือถือ P5)

### 4.9 `booking-simulator`

- `npm run booking:simulate -- <scenario> [--job <id>] [--camera <code>] [--team <ref>] [--leader <ref>] [--url <base>] [--count <n>]`
- อ่าน secret ตัวแรกของ `BOOKING_INBOUND_SECRETS` จาก `server/.env` · ค่าเริ่มต้น url `http://localhost:3000` · เซ็นเหมือน Booking จริง · พิมพ์ HTTP status + body ทุกครั้ง
- scenarios: `new` (Planned), `checkin`, `checkout`, `cancel`, `duplicate` (ส่งซ้ำ eventId เดิม), `out-of-order` (version 3 แล้ว 2), `bad-signature`, `burst` (`--count` งาน, ค่าเริ่มต้น 200), **`demo`** (3 งาน: รอเริ่มวันนี้, กำลังทำ check-in 1 ชม. ก่อน, ปิดแล้วเมื่อวาน — ทุกงานใช้ `--camera` ค่าเริ่มต้น `1000027`, ทีม `TEAM-DEMO`, หัวหน้า `BK-EMP-0002` ของ dev seed)
- `--job` ไม่ส่ง ⇒ สุ่ม id ใหม่ · `version` เพิ่มเองตามลำดับ scenario ของงานเดียวกัน (ต่อ `checkin` / `checkout` บนงานที่มีอยู่ ต้องส่ง `--job`)

## 5. Design — client

```
ใบงาน
[ค้นหา: เลขใบงาน / Booking / DO / SH ____________]
[ทั้งหมด] [รอเริ่ม] [กำลังดำเนินการ] [ปิดแล้ว] [ยกเลิก]
┌──────────────────┬──────────────────────────────┬───────────────┬──────────────────────┬──────────────┐
│ ใบงาน             │ รายการ                        │ ผู้ปฏิบัติงาน     │ กล้องของใบงาน          │ สถานะ          │
│ WO-202611-00001  │ ติดตั้งกล้อง อาคาร B           │ TEAM-DEMO     │ ● 1000027 ออนไลน์     │ กำลังดำเนินการ │
│ DO-… · SH-…      │ ปฏิบัติงานจริง 09:12 – ตอนนี้     │ หัวหน้า: …      │ ○ BWC-9 ไม่พบในระบบ   │              │
│                  │ อาคาร B                      │               │                      │              │
└──────────────────┴──────────────────────────────┴───────────────┴──────────────────────┴──────────────┘
                                                                        อัปเดตสถานะกล้อง 10:31:05
```
- **`/work-orders`**: แท็บสถานะ (เก็บใน URL `?status=`), ช่องค้นหา (URL `?q=`, ยิงเมื่อหยุดพิมพ์ 300 ms), ตาราง + paging, คลิกแถว ⇒ `/work-orders/:id` · คอลัมน์ "รายการ": ชื่องาน + "ปฏิบัติงานจริง" จาก `workWindow` หรือ "รอเริ่ม" + เวลาแผน + สถานที่ · "กล้องของใบงาน": จุดสีตาม DL74 (`deviceStateTone`) + รหัส + สถานะ · ไม่มีปุ่ม ดูสด / ดูย้อนหลัง (P4) · `VIEWER` เห็นเหมือนกัน
- **`/work-orders/:id`**: หัว (เลข, สถานะ, ป้ายต้องตรวจสอบ + เหตุผล) · panel "ข้อมูลงาน" (เลข Booking, DO / SH, สถานะงาน raw, เวลาแผน, check-in / check-out, สถานที่, ทีม / หัวหน้า, ได้รับข้อมูลล่าสุดเมื่อ) · panel "กล้องของใบงาน" (เหมือนในตาราง) · ลำดับเหตุการณ์ (`events`) · ไม่มี session / แผนที่ / วิดีโอ (P2 / P4)
- realtime: `workorder:changed` ⇒ invalidate `['work-orders']` (debounce 800 ms — Part 5) · สถานะกล้องไม่ push (DL35) — ได้ใหม่เมื่อ refetch
- ข้อความ th / en ผ่าน i18n · สถานะใบงาน: Planned "รอเริ่ม", Open "กำลังดำเนินการ", Closed "ปิดแล้ว", Cancelled "ยกเลิก" (DL64 — ไม่เอ่ยที่มา)
- route ใหม่ใน `router.tsx` (`work-orders`, `work-orders/:id` มีใน `ROUTE_ACCESS` และเมนูอยู่แล้ว)

## 6. การทดสอบ

- unit: guard (ลายเซ็นถูก / ผิด, เวลาเกิน ±300 s, secret ตัวที่ 2, api-key, CIDR), DTO (ฟิลด์ที่ไม่รู้จักผ่าน, ขาด version+updatedAt ⇒ 400), `ExternalEventId`, status map, ตัดสินสถานะใบงาน (ตาราง §4.7 ครบทุกแถว), รูปแบบเลขใบงาน, `workWindow`
- integration (`bwc_test`, Redis จริง, DSS simulator): POST 202 → worker ประมวลผล → `BookingJobs` + `WorkOrders` 1 ใบ · ซ้ำ ⇒ 200 ไม่มีแถวใหม่ · สลับลำดับ ⇒ Ignored · 401 / 400 / 413 / 415 + มี call log · Redis ล่มหลัง insert ⇒ 202 แล้ว sweep เก็บได้ · DB ล่ม ⇒ 503 · ทีมใหม่ 1 ทีม · เปลี่ยนหัวหน้าเมื่อเข้างานไม่ละเมิด constraint · ใบล่วงหน้า / ปิดแล้ว / ยกเลิก ที่หัวหน้าต่างไป ไม่เปลี่ยนหัวหน้าของทีม · leaderRef ไม่ตรง ⇒ MappingIssues 2 · เลขใบงานไม่ซ้ำเมื่อ upsert พร้อมกัน 20 งาน · check-in / check-out / ยกเลิก / reopen · `GET /work-orders` + `cameras[]` + `workWindow` + filter + ค้นหา · `workorder:changed` หลัง commit · ข้อความ Failed 10 ครั้ง ⇒ Dead
- client: ตาราง / แท็บ / ค้นหา / กล้อง / หน้า detail / invalidate เมื่อได้ `workorder:changed`
- ทดสอบบนเครื่อง dev: `DSS_DRIVER=dss` + `booking:simulate demo` ⇒ หน้า ใบงาน แสดง 3 ใบ กล้อง `1000027` พร้อมสถานะจริง
- p95 ของ 202 < 200 ms — วัดด้วย `burst` บนเครื่อง dev แล้วบันทึกผล

## 7. เอกสารที่ต้องแก้

- Part 4: `CK_WO_Closed`, `Teams.Code` 64 · Part 5: ตัวอย่าง `openedAt` = check-in, error `UNSUPPORTED_MEDIA_TYPE` · Part 7: ลำดับ rate limit / auth, call log ไม่ใช่ `@Audit`, ไม่ enqueue matching ใน P3a · Part 8: ขอบเขต P3a ใหม่ (read API → P3c, settings / alert → P3b, API + หน้า ใบงาน อ่านอย่างเดียวย้ายจาก P2) · Part 9: DL84 (Q54) + DL85 (Q55 — แก้ DL53 เรื่องเปลี่ยนหัวหน้า; แก้ Part 2 / Part 3 / Part 7 ที่เขียนกติกาเดิม) · `server/.env.example` + `.env.production.example`: `BOOKING_INBOUND_*` เปลี่ยนป้ายเป็น `[ใช้แล้ว]`, `BOOKING_INBOUND_RATE_LIMIT_PER_MIN`, `BOOKING_PROVIDER_DRIVER` ยังไม่ใช้ · runbook: วิธีรัน simulator · `CLAUDE.md`: สถานะ P3a

## 8. ปล่อยให้ผู้ทำตัดสินเอง

- โครงไฟล์ภายใน module `booking-integration` / `work-orders`, ชื่อ helper
- รูปแบบ log, ข้อความ error ภาษาไทยของแต่ละช่อง
- การจัดวางตารางเมื่อจอแคบ (ตาม `client/DESIGN.md`)
