# P3a รับใบงาน (mock) + หน้า ใบงาน คู่กล้องจริง — Implementation Plan

> อัปเดตตาม DL80: ไม่มี Employees แล้ว ใช้ Users.BookingEmployeeRef และ TeamMembers.UserId; fixture ผู้ใช้สร้างผ่าน createTestUsers แทนการสร้างพนักงาน

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ใบงานจาก `booking-simulator` ไหลผ่าน endpoint จริง → inbox → worker `integration` → `BookingJobs` + `WorkOrders` แล้วแสดงในหน้า ใบงาน พร้อมกล้องของงานและสถานะจาก DSS จริง

**Architecture:** api รับ POST (guard HMAC / api-key) เขียนแค่ `IntegrationInbox` + `IntegrationSyncState` + `IntegrationCallLogs` แล้ว enqueue BullMQ `booking-inbox` · worker role `integration` ประมวลผลใน transaction เดียว (projection + ทีม / หัวหน้า + `WorkOrders` + `WorkOrderEvents`) แล้ว emit `workorder:changed` หลัง commit · retry sweep อ่าน DB ตรงทุก 5 นาที · api อ่านใบงาน + resolve `DeviceRefs` → `Devices` + สถานะจาก `DeviceStatusDisplayService`

**Tech Stack:** NestJS 10 + Drizzle (postgres-js) + BullMQ 5.81.5 / ioredis 5.11.1 + Vitest · React 18 + TanStack Query + react-router

**Spec:** `docs/superpowers/specs/2026-11-25-p3a-booking-inbound-work-orders-design.md`

## Global Constraints

- ชื่อตาราง / คอลัมน์ / enum ตาม Part 4 §4.4 (PascalCase, quoted) · ใช้ helper ใน `server/src/db/columns.ts` (`pkId`, `fk`, `ref`, `tstz`, `createdAt`, `updatedAt`)
- dependency ใหม่ pin exact: `bullmq@5.81.5`, `ioredis@5.11.1` (5.81.6 ออกไม่ถึง 2 สัปดาห์)
- api **ห้าม**เขียน `BookingJobs` / `WorkOrders` / `Teams` / `TeamMembers` — เป็นงานของ worker `integration` เท่านั้น
- emit realtime **หลัง commit** เท่านั้น
- ข้อความบนจอไม่บอกที่มาว่า Booking (DL64) — ยกเว้นป้าย "เลข Booking" / "รหัสอ้างอิง Booking" และคำใบ้ค้นหา "เลขใบงาน / Booking / DO / SH"
- เอกสารใต้ `docs/` เป็นภาษาไทย · UI th / en ผ่าน i18n
- ทุก fact เกี่ยวกับ Booking ในเอกสารติด **[Assumption]** / **[Confirmed]**
- **ห้าม `git add` / commit / stash / reset** — ผู้ใช้ commit เอง · จบงานเสนอข้อความ commit
- integration test ใช้ DSS simulator เสมอ (`int-setup.ts`) · test env เพิ่ม `BOOKING_INBOUND_RATE_LIMIT_PER_MIN=100000` และ `BOOKING_INBOUND_SECRETS=test-secret-1,test-secret-2` ใน `int-setup.ts`

## Review Focus

1. ข้อความหลายฉบับของงานเดียวกันถูกประมวลผลพร้อมกัน (concurrency 4 + sweep) ⇒ ยังได้ใบงาน 1 ใบ และสถานะเป็นของ version ใหม่สุด — Task 7
2. เวลาข้ามเดือนตามเวลาไทย (`2026-11-30T17:30:00Z` = 1 ธ.ค. ในไทย) ⇒ เลขใบงานขึ้น `WO-202612-…` — Task 5
3. `deviceRefs` มีช่องว่างหน้า/หลังหรือตัวพิมพ์ต่างจากรหัสกล้อง (`' 1000027 '`, `'bwc-0009'`) ⇒ ยังจับคู่กล้องได้ — Task 6
4. `X-Booking-Timestamp` ส่งเป็นมิลลิวินาทีแทนวินาที ⇒ 401 ไม่ crash — Task 2
5. worker ตายระหว่างประมวลผล (inbox ค้าง `Pending`) ⇒ sweep เก็บได้หลัง 1 นาที และไม่เกิดใบงานซ้ำ — Task 8

---

### Task 1: ตาราง P3a + migration

**Files:**
- Modify: `server/src/db/schema.ts` (เพิ่ม 7 ตาราง, `Teams.Code` 64, FK ของ `Alerts.WorkOrderId` / `BookingJobId`)
- Create: `server/drizzle/0012_p3a_booking.sql` (+ snapshot / journal จาก `npm run db:generate -- --name=p3a_booking` — เลขต่อจาก `0011_standard_role_codes`)
- Test: `server/src/db/p3a-schema.int-test.ts`

**Interfaces:**
- Produces: tables `IntegrationInbox`, `IntegrationSyncState`, `IntegrationCallLogs`, `BookingJobs`, `WorkOrders`, `WorkOrderCounters`, `WorkOrderEvents` (คอลัมน์ / index / constraint ตาม Part 4 §4.4 · `DeviceRefs` = `varchar(64).array()` + index GIN, `MappingIssues` / `ReviewReasons` = `smallint().array()`)
- `CK_WO_Closed` = `("Status" in (2,3)) = ("ClosedAt" is not null)` · `WorkOrders.Status` default 6 · `LastActivityAt` nullable

- [ ] **Step 1: test ที่ fail** — `p3a-schema.int-test.ts` (ใช้ `bootHttpContext` + `ctx.sql`):
  - `'a Planned work order has no ClosedAt; Closed / Cancelled need one'`: insert `BookingJobs` + `WorkOrders` Status 6 ClosedAt null ⇒ ผ่าน · Status 2 ClosedAt null ⇒ throw ชื่อ `CK_WO_Closed` · Status 6 ClosedAt มีค่า ⇒ throw
  - `'one work order per booking job; one inbox row per event'`: `WorkOrders` ซ้ำ `BookingJobId` ⇒ `UQ_WO_BookingJob` · `IntegrationInbox` ซ้ำ `(Source, ExternalEventId)` ⇒ `UQ_Inbox_Event` · `BookingJobs` ซ้ำ `(SourceSystem, ExternalJobId)` ⇒ `UQ_BookingJobs_External`
  - `'Teams.Code takes a 64-character team ref'`: insert Code ยาว 64 ⇒ ผ่าน
  - `'DeviceRefs is a text array searchable with &&'`: insert `ARRAY['1000027']` แล้ว `where "DeviceRefs" && ARRAY['1000027']::varchar[]` ⇒ 1 แถว
- [ ] **Step 2: รันให้ fail** — `cd server; npx vitest run --config vitest.integration.config.ts src/db/p3a-schema.int-test.ts` ⇒ FAIL (ไม่มีตาราง)
- [ ] **Step 3: เพิ่มตารางใน `schema.ts` → `npm run db:generate -- --name=p3a_booking` → ตรวจ SQL ที่ได้ (ชื่อ constraint / index ตรง Part 4) → `npm run db:migrate` และ `npm run db:prepare:test`**
- [ ] **Step 4: รันให้ผ่าน** + `npx vitest run --config vitest.integration.config.ts src/db` ⇒ PASS (รวม drift guard / reference-data เดิม)

---

### Task 2: สัญญาขาเข้า v1 (ฟังก์ชันล้วน)

**Files:**
- Create: `server/src/modules/booking-integration/inbound/booking-inbound.config.ts`, `inbound-auth.ts`, `inbound-body.ts`
- Test: `…/inbound/booking-inbound.config.test.ts`, `inbound-auth.test.ts`, `inbound-body.test.ts`

**Interfaces:**
- Produces:
  - `type BookingInboundConfig = { auth: 'hmac' | 'api-key'; secrets: string[]; allowedCidrs: string[]; mapper: 'v1' }`
  - `readBookingInboundConfig(env: Record<string, string | undefined>): BookingInboundConfig` — `BOOKING_INBOUND_AUTH` (ค่าเริ่มต้น `hmac`), `BOOKING_INBOUND_SECRETS` (comma, trim, ≤ 2 ตัว), `BOOKING_INBOUND_ALLOWED_CIDRS`, `BOOKING_INBOUND_MAPPER` (ค่าเริ่มต้น `v1`) · ค่าผิด ⇒ throw `Error` ที่เอ่ยชื่อ env
  - `signBody(secret: string, timestamp: string, rawBody: Buffer | string): string` ⇒ `sha256=<hex>`
  - `type InboundAuthInput = { headers: Record<string, string | undefined>; rawBody: Buffer; ip: string; nowMs: number }`
  - `checkInboundAuth(input: InboundAuthInput, cfg: BookingInboundConfig): { ok: true } | { ok: false; reason: 'not-configured' | 'cidr' | 'timestamp' | 'signature' | 'api-key' }` — ลำดับ: secrets ว่าง ⇒ `not-configured` → CIDR (`net.BlockList`) → timestamp (วินาที, |now − ts| ≤ 300) → hmac / api-key เทียบ `crypto.timingSafeEqual` กับทุก secret
  - `type InboundEnvelopeV1 = { eventId?: string; eventType?: string; occurredAt?: string; job: InboundJobV1 }` · `InboundJobV1` ตาม Part 7 §7.4 (ทุกฟิลด์ optional ยกเว้น `jobId`, `status`)
  - `validateInboundBody(body: unknown): { ok: true; value: InboundEnvelopeV1 } | { ok: false; details: { field: string; issue: string }[] }` — กติกา + ความยาวตาม spec §4.3 (ข้อความอิสระ `title` / `site.name` / `site.address` ตัดให้พอดี ไม่ fail) · ฟิลด์ที่ไม่รู้จักผ่าน
  - `externalEventIdOf(env: InboundEnvelopeV1): string` — `eventId` ?? `${jobId}:${version}` ?? `${jobId}:${new Date(updatedAt).toISOString()}`

- [ ] **Step 1: test ที่ fail**
  - config: `'defaults to hmac + v1'` · `'more than 2 secrets throws naming BOOKING_INBOUND_SECRETS'` · `'unknown mapper throws naming BOOKING_INBOUND_MAPPER'`
  - auth (`nowMs` = `Date.parse('2026-11-25T03:00:00Z')`, ts = `'1795575600'`): `'a correct signature with the second secret passes'` · `'a body changed by one byte fails as signature'` · `'301 s old fails as timestamp; 300 s passes'` · `'a timestamp in milliseconds fails as timestamp'` (`'1795575600000'`) · `'api-key mode compares X-Api-Key'` · `'an ip outside BOOKING_INBOUND_ALLOWED_CIDRS fails as cidr'` (`10.0.0.0/8` vs `192.168.1.5`) · `'no secrets configured fails as not-configured'`
  - body: `'jobId, status and version or updatedAt are required'` ⇒ details มี `{ field: 'job.jobId' }`, `{ field: 'job.version' }` · `'unknown fields are kept'` (`job.extra = 1` ⇒ ok และ `value.job.extra === 1`) · `'doNo longer than 50 is rejected; title longer than 300 is cut to 300'` · `'deviceRefs must be strings of at most 64, 50 items at most'` · `'a date without offset is rejected'` (`'2026-11-25T10:00:00'`) · `'site.lat out of range is rejected'`
  - eventId: `'eventId wins; then jobId:version; then jobId:updatedAt normalised'` (`'2026-11-25T10:00:00+07:00'` ⇒ `'J1:2026-11-25T03:00:00.000Z'`)
- [ ] **Step 2: รันให้ fail** — `cd server; npx vitest run src/modules/booking-integration/inbound`
- [ ] **Step 3: implement ตาม Interfaces** (validate ด้วยโค้ดตรง ๆ หรือ class-validator + `plainToInstance` แบบไม่ whitelist — เลือกแบบที่คืน `details` ตามรูปข้างบนได้)
- [ ] **Step 4: รันให้ผ่าน**

---

### Task 3: คิว BullMQ (common)

**Files:**
- Modify: `server/package.json` (+ lock) — `npm install --save-exact bullmq@5.81.5 ioredis@5.11.1`
- Create: `server/src/common/queue/queue.constants.ts`, `queue.module.ts`
- Test: `server/src/common/queue/queue.constants.test.ts`, `server/src/common/queue/queue.int-test.ts`

**Interfaces:**
- Produces:
  - `BOOKING_INBOX = 'booking-inbox'` · `type BookingInboxJob = { inboxId: string }`
  - `queuePrefix(env?: NodeJS.ProcessEnv): string` ⇒ `bq-${databaseName}` (ชื่อ database จาก `DATABASE_URL` แบบเดียวกับ `cacheKey()` · ไม่มี ⇒ `bq-default`)
  - `queueConnection(url: string, role: 'producer' | 'worker'): IORedis` — `maxRetriesPerRequest: null` · producer ใส่ `enableOfflineQueue: false` (Redis ล่ม ⇒ `add` fail ทันที)
  - `BOOKING_INBOX_QUEUE = Symbol('BOOKING_INBOX_QUEUE')` → `Queue<BookingInboxJob> | null` (ไม่มี `REDIS_URL` ⇒ null) จาก `@Global() QueueModule` ปิด connection ตอน shutdown

- [ ] **Step 1: test ที่ fail** — unit `'queuePrefix uses the database name'` (`postgres://u:p@h:5432/bwc_test` ⇒ `bq-bwc_test`) · int `'a job added to booking-inbox reaches a worker with the same prefix'` (Redis จริง, `Worker` ชั่วคราว, `eventually` ได้ `{ inboxId: '1' }`)
- [ ] **Step 2: รันให้ fail** — `npx vitest run src/common/queue` · `npx vitest run --config vitest.integration.config.ts src/common/queue`
- [ ] **Step 3: ติดตั้ง + implement** (`AppModule` import `QueueModule`)
- [ ] **Step 4: รันให้ผ่าน**

---

### Task 4: Inbound endpoint (process `api`)

**Files:**
- Create: `server/src/modules/booking-integration/inbound/booking-inbound.guard.ts`, `booking-inbound.controller.ts`, `booking-inbox.service.ts`, `inbound-call-log.service.ts`, `inbound-call-log.interceptor.ts`, `server/src/modules/booking-integration/booking-integration.module.ts`
- Modify: `server/src/common/rate-limit/rate-limit-specs.ts` (`'booking-inbound'`, env `BOOKING_INBOUND_RATE_LIMIT_PER_MIN`, ค่าเริ่มต้น 600), `server/src/common/errors/error-codes.ts` (415 ⇒ `UNSUPPORTED_MEDIA_TYPE`), `server/src/common/config/prod-readiness.ts` (`checkBookingInbound`: ไม่มี secret ⇒ warn "endpoint รับใบงานปิดอยู่ (ตอบ 401 ทุกคำขอ)"), `server/src/app.module.ts`, `server/src/test/int-setup.ts`
- Test: `…/inbound/booking-inbound.int-test.ts`, `…/inbound/booking-inbound.controller.test.ts`, `prod-readiness.test.ts`

**Interfaces:**
- Consumes: Task 2 ทั้งหมด · Task 3 `BOOKING_INBOX_QUEUE`
- Produces:
  - `POST /api/integration/booking/jobs` — `@Public() @RateLimit('booking-inbound') @UseGuards(BookingInboundAuthGuard) @UseInterceptors(InboundCallLogInterceptor)` · body รับเป็น `unknown` (route นี้ข้าม global `ValidationPipe` ด้วยการไม่มี DTO class)
  - `BookingInboxService.receive(envelope: InboundEnvelopeV1, payload: unknown): Promise<{ status: 'accepted' | 'duplicate'; inboxId: bigint | null; externalJobId: string }>` — transaction: insert inbox `ON CONFLICT DO NOTHING RETURNING` + upsert `IntegrationSyncState('BOOKING','jobs').LastReceivedAt` · หลัง commit accepted ⇒ `queue?.add(BOOKING_INBOX, { inboxId }, { jobId: 'inbox-'+id, removeOnComplete: 1000, removeOnFail: 1000 })` ภายใน `try/catch` + timeout 1 วินาที (พัง = log warn เท่านั้น)
  - `InboundCallLogService.record(entry: { httpStatus: number; latencyMs: number; correlationId: string | null; errorMessage?: string; requestExcerpt?: string }): Promise<void>` — `Outcome` 1 ถ้า < 400 ไม่งั้น 2 · ไม่ throw
  - guard: 415 (`application/json` เท่านั้น) → 413 (`rawBody.length > 262_144`) → `checkInboundAuth` ⇒ 401 `INBOUND_AUTH_FAILED` ข้อความ "ยืนยันตัวตนไม่ผ่าน" · ปฏิเสธเมื่อไหร่บันทึก call log เอง
  - controller: invalid body ⇒ 400 `VALIDATION_FAILED` + `details` · accepted ⇒ 202 `{ status, externalJobId, correlationId }` · duplicate ⇒ 200 · `receive` throw ⇒ 503 `SERVICE_UNAVAILABLE`

- [ ] **Step 1: test ที่ fail** — int (`signBody` เซ็นเหมือน simulator):
  - `'a signed new job ⇒ 202 accepted, one Pending inbox row, LastReceivedAt set, one booking-inbox job'`
  - `'the same eventId again ⇒ 200 duplicate, still one row'`
  - `'bad signature / timestamp 301 s old / missing headers ⇒ 401 INBOUND_AUTH_FAILED, no inbox row, a call log with HttpStatus 401 and Direction 2'`
  - `'missing job.status ⇒ 400 VALIDATION_FAILED with details, call log 400'`
  - `'text/plain ⇒ 415; a 300 KB body ⇒ 413'`
  - `'a job is still accepted when the queue is unavailable'` (override provider `BOOKING_INBOX_QUEUE` ด้วย `{ add: () => Promise.reject(new Error('down')) }` ⇒ 202 + แถว Pending)
  - `'call logs never contain the signature header or the secret'` (ค้น `RequestExcerpt` ไม่มี `sha256=` / `test-secret`)
  - unit controller: `'receive throwing ⇒ 503 SERVICE_UNAVAILABLE'`
  - prod-readiness: `'no BOOKING_INBOUND_SECRETS ⇒ warn'`
- [ ] **Step 2: รันให้ fail**
- [ ] **Step 3: implement ตาม Interfaces**
- [ ] **Step 4: รันให้ผ่าน** + `npm run lint; npm run typecheck`

---

### Task 5: Mapper v1 + กติกาใบงาน (ฟังก์ชันล้วน)

**Files:**
- Create: `server/src/modules/booking-integration/mapper/mapper-v1.ts`, `payload-hash.ts` · `server/src/modules/work-orders/work-order-rules.ts`
- Test: `…/mapper/mapper-v1.test.ts`, `…/work-orders/work-order-rules.test.ts`

**Interfaces:**
- Consumes: Task 2 `InboundEnvelopeV1`
- Produces:
  - `type CanonicalBookingStatus = 1 | 2 | 3 | 4 | 5 | 9` · `canonicalStatus(raw: string): CanonicalBookingStatus` (ไม่สนตัวพิมพ์ / ช่องว่าง)
  - `type BookingJobSnapshot = { externalJobId; externalJobNo: string | null; doNo; shNo; externalVersion: string | null; externalUpdatedAt: Date | null; status: CanonicalBookingStatus; rawStatus: string; title: string | null; teamRef: string | null; leaderRef: string | null; scheduledDate: string | null; plannedStartAt: Date | null; plannedEndAt: Date | null; checkInAt: Date | null; checkOutAt: Date | null; deviceRefs: string[] (trim + ตัดซ้ำ); siteName; siteAddress; siteLat: number | null; siteLng: number | null; raw: unknown; payloadHash: string }`
  - `mapV1(env: InboundEnvelopeV1): BookingJobSnapshot` · `payloadHash(job: unknown): string` (sha256 ของ JSON ที่เรียง key)
  - `type WoStatus = 1 | 2 | 3 | 6` · `type JobFacts = { status: CanonicalBookingStatus; checkInAt: Date | null; checkOutAt: Date | null }`
  - `isCheckedIn(job: JobFacts): boolean` — `checkInAt` และ (ไม่มี `checkOutAt` หรือ `checkInAt > checkOutAt`)
  - `decideWorkOrderStatus(current: { status: WoStatus; closedAt: Date | null } | null, job: JobFacts, now: Date): { status: WoStatus; closeReason: 1 | null; openedAt: Date | null; closedAt: Date | null; flagChangedAfterClose: boolean }` — ตาราง spec §4.7
  - `workOrderPeriod(at: Date): string` (YYYYMM เวลาไทย) · `formatWorkOrderNo(period: string, value: number): string` ⇒ `WO-202611-00042`
  - `workOrderTitle(s: BookingJobSnapshot): string` — `title ?? externalJobNo ?? externalJobId`

- [ ] **Step 1: test ที่ fail**
  - mapper: `'status map: IN_PROGRESS ⇒ 3, done ⇒ 4, REJECTED ⇒ 5, WEIRD ⇒ 9'` · `'deviceRefs are trimmed and de-duplicated'` (`[' 1000027 ', '1000027']` ⇒ `['1000027']`) · `'the same job with keys in another order has the same payloadHash'`
  - rules (ตารางทุกแถว, `now = 2026-11-25T03:00Z`):
    - `'new, no check-in ⇒ Planned'` · `'IN_PROGRESS without check-in stays Planned'`
    - `'check-in ⇒ Open, openedAt = checkInAt'`
    - `'check-out ⇒ Closed BookingCheckout, closedAt = checkOutAt'` · `'Completed without checkOutAt ⇒ Closed at now'`
    - `'check-in after check-out on a Closed order ⇒ Open again, closedAt null'`
    - `'cancel on Planned / Open ⇒ Cancelled, closedAt = now'` · `'cancel on Closed ⇒ stays Closed, flagChangedAfterClose'`
    - `'check-in on a Cancelled order ⇒ Open'`
  - number: `'Bangkok month: 2026-11-30T17:30:00Z ⇒ 202612'` · `'WO-202611-00042'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน**

---

### Task 6: projection `BookingJobs` + ทีม / หัวหน้า + writer ใบงาน

**Files:**
- Create: `server/src/modules/devices/device-refs.ts`, `server/src/modules/booking-integration/projection/booking-projection.service.ts`, `…/projection/booking-teams.ts`, `server/src/modules/work-orders/work-order-writer.service.ts`, `server/src/modules/work-orders/work-orders-writer.module.ts`
- Test: `server/src/modules/devices/device-refs.int-test.ts`, `…/projection/booking-projection.int-test.ts`, `…/work-orders/work-order-writer.int-test.ts`

**Interfaces:**
- Consumes: Task 1 ตาราง · Task 5 ทั้งหมด
- Produces:
  - `resolveDeviceRefs(db: DrizzleExecutor, refs: string[]): Promise<Map<string, { id: bigint; deviceCode: string; name: string | null; vendorDeviceId: string }>>` — key = ref ตามที่ส่งมา · จับคู่ `lower(trim(ref))` กับ `lower(DeviceCode)` / `lower(VendorDeviceId)` / `lower(SerialNo)` ของกล้องที่ไม่ถูกลบ
  - `upsertTeamByRef(tx: DrizzleTx, teamRef: string): Promise<bigint>` · `moveLeader(tx: DrizzleTx, teamId: bigint, userId: bigint): Promise<boolean>` (ล็อก `Teams` แถวนั้น `.for('update')`, ไม่มีอะไรเปลี่ยน ⇒ false)
  - `BookingProjectionService.apply(tx: DrizzleTx, s: BookingJobSnapshot): Promise<{ kind: 'ignored' } | { kind: 'applied'; bookingJobId: bigint; teamId: bigint | null; leaderUserId: bigint | null }>` — upsert + version guard (spec §4.5) · `MappingIssues` 2 / 3 / 5 · ทีมทุกครั้งที่มี `teamRef` · `moveLeader` **เฉพาะ `isCheckedIn`** (Q55)
  - `WorkOrderWriter.upsertFromBooking(tx: DrizzleTx, input: { bookingJobId: bigint; title: string; teamId: bigint | null; leaderUserId: bigint | null; job: JobFacts & { plannedStartAt: Date | null; plannedEndAt: Date | null; deviceRefs: string[] }; now: Date }): Promise<WorkOrderChange | null>`
  - `type WorkOrderChange = { workOrderId: bigint; status: WoStatus; needsReview: boolean; rowVersion: number; teamId: bigint | null; change: 'created' | 'statusChanged' | 'updated' }` (ไม่มีอะไรเปลี่ยน ⇒ null) · เขียน `WorkOrderEvents` (1 Created / 2 StatusChanged, `Source=2`) · `NeedsReview` + reason 1 เมื่อ `flagChangedAfterClose` หรือใบ Closed แล้วทีม / หัวหน้า / เวลาแผน / `DeviceRefs` เปลี่ยน · ไม่แตะ `LastActivityAt`
  - `WorkOrdersWriterModule` export `WorkOrderWriter` (booking-integration import ได้ตัวนี้ตัวเดียว)

- [ ] **Step 1: test ที่ fail**
  - device-refs: `'matches code, vendor id or serial, ignoring case and spaces; deleted cameras never match'`
  - projection: `'a new job inserts BookingJobs with DoNo/ShNo/DeviceRefs and PayloadHash'` · `'an older version is ignored and changes nothing (team, leader included)'` · `'updatedAt wins over version when both exist'` · `'a new teamRef creates one team; sending again creates none'` · `'checked-in job with a new leaderRef closes the old leader and opens the new one'` · `'a Planned, Closed or Cancelled job with another leaderRef leaves the team leader alone but sets LeaderUserId on the job'` · `'unknown leaderRef ⇒ MappingIssues 2; unknown status ⇒ 3; unknown camera ⇒ 5'`
  - writer: `'creates WO-YYYYMM-00001 then 00002 in the same Bangkok month'` · `'20 jobs upserted concurrently get 20 distinct numbers'` · `'status change writes a StatusChanged event with From/To'` · `'nothing changed ⇒ null and RowVersion unchanged'` · `'team change after Closed ⇒ NeedsReview with reason 1'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน**

---

### Task 7: ประมวลผล inbox (worker role `integration`)

**Files:**
- Create: `server/src/modules/booking-integration/processing/booking-inbox.processor.ts`, `booking-inbox.worker.ts`, `server/src/modules/work-orders/work-order-events.ts`, `server/src/modules/booking-integration/integration-worker.module.ts`
- Modify: `server/src/worker.module.ts` (+ `worker.module.test.ts`)
- Test: `…/processing/booking-inbox.processor.int-test.ts`

**Interfaces:**
- Consumes: Task 3 `BOOKING_INBOX`, `queueConnection`, `queuePrefix` · Task 5 `mapV1`, `workOrderTitle` · Task 6 ทั้งหมด
- Produces:
  - `BookingInboxProcessor.process(inboxId: bigint, now?: Date): Promise<'processed' | 'ignored' | 'failed' | 'dead' | 'skipped'>` — ล็อกแถว inbox `.for('update', { skipLocked: true })` เฉพาะ `Status in (1,3)` · ผิดพลาด ⇒ transaction ใหม่ `Attempts+1`, `LastError`, ครบ 10 ⇒ `Dead` · emit หลัง commit
  - `emitWorkOrderChanged(realtime: RealtimeGateway, c: WorkOrderChange): void` — `bus?.to(TRACKING_ROOM)` + `bus?.to('team:' + c.teamId)` ถ้ามีทีม · payload `{ workOrderId: string, status, needsReview, rowVersion, change }`
  - `BookingInboxWorker` (OnApplicationBootstrap / OnApplicationShutdown) — BullMQ `Worker(BOOKING_INBOX, …, { concurrency: 4, prefix: queuePrefix() })` เรียก `process(BigInt(job.data.inboxId))` · ไม่มี `REDIS_URL` ⇒ ไม่เริ่ม
  - `IntegrationWorkerModule` · `WorkerModule.forRoles` import เมื่อ roles มี `'integration'`

- [ ] **Step 1: test ที่ fail** (insert inbox ตรงด้วย payload จาก helper + `recordingGateway()`):
  - `'a Pending row ⇒ processed: one BookingJobs, one Planned WO, Created event, workorder:changed after commit'`
  - `'check-in then check-out rows ⇒ Open then Closed BookingCheckout'`
  - `'an older version row ⇒ ignored, WO unchanged'`
  - `'two versions of the same job processed at once ⇒ one WO with the newer status'` (Review Focus 1 · `Promise.all` สอง processor)
  - `'a row that throws ten times ⇒ Dead with LastError'` (payload ที่ทำให้ mapper throw)
  - `'a row already Processed ⇒ skipped'`
  - worker.module.test: `'integration role imports IntegrationWorkerModule'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน**

---

### Task 8: Retry sweep

**Files:**
- Create: `server/src/modules/booking-integration/processing/inbox-retry.job.ts`
- Modify: `…/integration-worker.module.ts`
- Test: `…/processing/inbox-retry.int-test.ts`

**Interfaces:**
- Consumes: Task 7 `BookingInboxProcessor.process`
- Produces: `InboxRetryJob` (รูปแบบ `DeviceSyncJob`: ตอน start + ทุก 5 นาที, `unref`, หยุดตอน shutdown) · `runOnce(now: Date): Promise<number>` — `Pending` ที่ `ReceivedAt < now − 1 นาที` + `Failed` เรียง `ReceivedAt` ≤ 200 แถว ⇒ `process` ทีละแถว · คืนจำนวนแถวที่หยิบ · ไม่ใช้ BullMQ (ทำงานแม้ Redis ล่ม) · lease `RedisLockService.withLock('booking:inbox-retry', 300, …)` และถ้า Redis ล่ม (`withLock` คืน null เพราะ Redis ไม่ตอบ) ให้รันต่อโดยไม่มี lease — กันซ้ำด้วย `SKIP LOCKED` ของ processor

- [ ] **Step 1: test ที่ fail** — `'a Pending row older than 1 minute is processed; a newer one is left'` · `'Failed rows are retried'` · `'a row left Pending by a dead worker produces exactly one WO after the sweep'` (Review Focus 5: process ค้างด้วย transaction ที่ rollback แล้วรัน sweep 2 รอบ)
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน**

---

### Task 9: API อ่านใบงาน

**Files:**
- Create: `server/src/modules/work-orders/work-orders.controller.ts`, `work-orders.service.ts`, `work-order.view.ts`, `dto/query-work-orders.dto.ts`, `work-orders.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `…/work-orders/work-order.view.test.ts`, `…/work-orders/work-orders.int-test.ts`

**Interfaces:**
- Consumes: Task 6 `resolveDeviceRefs` · `DeviceStatusDisplayService.statuses()`
- Produces:
  - `GET /api/work-orders` (`QueryWorkOrdersDto extends PageQueryDto` + `status?: 1 | 2 | 3 | 6`) · `GET /api/work-orders/:id` · `GET /api/work-orders/:id/events` — ทั้งหมด `@RequirePermission('work-orders:read')` · ไม่มี `@Audit` (ตาม `GET /devices` — อ่านรายการทั่วไปไม่ใช่การกระทำที่ต้องลง audit)
  - `workWindowOf(checkInAt: Date | null, checkOutAt: Date | null, closedAt: Date | null): { from: string; to: string | null } | null`
  - `type WorkOrderCamera = { deviceRef: string; deviceId: string | null; deviceCode: string | null; name: string | null; platformState: 'online' | 'offline' | 'unknown'; platformStatusFetchedAt: string | null; fromSession: false }`
  - row / detail / events ตาม spec §4.8 (`booking.detail: true | false` ตาม `booking:read`, SUPER_ADMIN ได้เสมอ) · เรียง `case when Status in (6,1) then 0 else 1 end`, `COALESCE(OpenedAt, PlannedStartAt, CreatedAt) DESC`, `Id DESC` · เรียก `statuses()` ครั้งเดียวต่อคำขอด้วยกล้องที่ resolve ได้ทั้งหน้า

- [ ] **Step 1: test ที่ fail**
  - view: `'workWindow: no check-in ⇒ null; open ⇒ to null; closed ⇒ checkOutAt; cancelled ⇒ closedAt'`
  - int (ข้อมูลผ่าน `BookingInboxProcessor` จาก Task 7, `resetDevices` + กล้อง simulator `SIM-0001`):
    - `'lists Planned and Open first with workWindow, booking summary and cameras with platformState'`
    - `'status=6 filters; q finds by WO no, DO, SH, booking job no and team name'`
    - `'an unknown deviceRef shows deviceId null and unknown state'`
    - `'detail: full booking with booking:read, summary only without it'` (role ทดสอบที่ไม่มี `booking:read`)
    - `'events in time order'` · `'unknown id ⇒ 404'` · `'needs work-orders:read ⇒ 403'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน**

---

### Task 10: `booking-simulator`

**Files:**
- Create: `server/src/modules/booking-integration/simulator/scenarios.ts`, `server/scripts/booking-simulate.ts`
- Modify: `server/package.json` (`"booking:simulate": "ts-node scripts/booking-simulate.ts"`), `docs/runbooks/local-dev.md` (หัวข้อใหม่ "ใบงานจำลอง")
- Test: `…/simulator/scenarios.test.ts`

**Interfaces:**
- Consumes: Task 2 `signBody`, `externalEventIdOf`
- Produces:
  - `type SimOptions = { jobId?: string; camera: string; team: string; leader: string; count: number }` (ค่าเริ่มต้น camera `1000027`, team `TEAM-DEMO`, leader `BK-EMP-0002`, count 200)
  - `buildScenario(name: 'new' | 'checkin' | 'checkout' | 'cancel' | 'duplicate' | 'out-of-order' | 'bad-signature' | 'burst' | 'demo', opts: SimOptions, now: Date): { envelope: InboundEnvelopeV1; corruptSignature?: boolean }[]`
  - CLI `npm run booking:simulate -- <scenario> [--job] [--camera] [--team] [--leader] [--url] [--count]` — อ่าน `.env`, secret ตัวแรก, POST ทีละรายการตามลำดับ, พิมพ์ status + body

- [ ] **Step 1: test ที่ fail** — `'demo builds 3 jobs: Planned today, Open checked in an hour ago, Closed yesterday, all on camera 1000027 with leader BK-EMP-0002'` · `'out-of-order sends version 3 before version 2 of one job'` · `'duplicate sends the same eventId twice'` · `'checkin without --job throws a message asking for --job'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน** + รันจริงบนเครื่อง dev: api + worker เปิดอยู่ ⇒ `npm run booking:simulate -- demo` พิมพ์ 202 สามครั้ง

---

### Task 11: Client — หน้า ใบงาน (รายการ)

**Files:**
- Create: `client/src/features/work-orders/workOrders.api.ts`, `workOrderView.ts`, `useWorkOrderLiveRefresh.ts`, `WorkOrdersPage.tsx`, `client/src/i18n/locales/th/workOrders.ts`, `client/src/i18n/locales/en/workOrders.ts`
- Modify: `client/src/i18n/locales/{th,en}/index.ts`, `client/src/i18n/locales/parity.test.ts` (เพิ่ม prefix `workOrders`), `client/src/app/router.tsx` (`guardedLazy('work-orders', …)`)
- Test: `…/work-orders/workOrderView.test.ts`, `WorkOrdersPage.test.tsx`, `useWorkOrderLiveRefresh.test.tsx`

**Interfaces:**
- Consumes: API ของ Task 9
- Produces:
  - types `WorkOrderRow`, `WorkOrderDetail`, `WorkOrderEvent`, `WorkOrderCamera` ตรงกับ server · `workOrdersApi.list(params: { status?: 1 | 2 | 3 | 6; q?: string; page: number; pageSize: number })`, `.detail(id)`, `.events(id)`
  - `workOrderStatusView(status): { labelKey: TranslationKey; tone: StatusTone }` — 6 "รอเริ่ม" info, 1 "กำลังดำเนินการ" success, 2 "ปิดแล้ว" neutral, 3 "ยกเลิก" destructive
  - `workWindowText(row, language): { key: TranslationKey; params }` — มี `workWindow` ⇒ "ปฏิบัติงานจริง {from} – {to | ตอนนี้}" · ไม่มี ⇒ "รอเริ่ม · แผน {plannedStartAt}" · ไม่มีแผน ⇒ "รอเริ่ม"
  - `useWorkOrderLiveRefresh(): void` — `subscribe('workorder:changed')` debounce 800 ms ⇒ `invalidateQueries({ queryKey: ['work-orders'] })`
  - หน้า: แท็บ `?status=` (ทั้งหมด / รอเริ่ม / กำลังดำเนินการ / ปิดแล้ว / ยกเลิก) · ค้นหา `?q=` debounce 300 ms · `DataTableFrame` + `DataPagination` (pageSize 20) · คอลัมน์ตาม spec §5 · กล้อง: `StatusBadge tone={deviceStateTone(state)}` + รหัส + สถานะ / "ไม่พบในระบบ" · คลิกแถว ⇒ `/work-orders/:id` · `AsyncState` loading / error / empty / filtered-empty
  - i18n ทุกข้อความใน `workOrders.*` (th / en) — ไม่มีคำว่า Booking นอกจาก "เลข Booking" และคำใบ้ค้นหา "เลขใบงาน / Booking / DO / SH"

- [ ] **Step 1: test ที่ fail** — view: `'status labels and tones'` · `'work window: checked in, open ⇒ to now; planned ⇒ plan time'` · page (mock `workOrdersApi`): `'renders rows with WO no, DO/SH, window text, team, cameras with state'` · `'the Planned tab sets ?status=6 and refetches'` · `'typing a search sets ?q= after a pause'` · `'clicking a row goes to /work-orders/:id'` · `'an unknown camera shows ไม่พบในระบบ'` · hook: `'two workorder:changed within 800 ms invalidate once'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน** + `npm run typecheck; npm run lint`

---

### Task 12: Client — หน้า รายละเอียดใบงาน

**Files:**
- Create: `client/src/features/work-orders/WorkOrderDetailPage.tsx`
- Modify: `client/src/app/router.tsx` (`guardedLazy('work-orders/:id', …)`), i18n `workOrders.ts` (th / en)
- Test: `…/work-orders/WorkOrderDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 11 `workOrdersApi`, `workOrderStatusView`, `useWorkOrderLiveRefresh`
- Produces: หน้า `/work-orders/:id` (`useParams`) — หัว (เลข, สถานะ, ป้าย "ต้องตรวจสอบ" + เหตุผล) · panel "ข้อมูลงาน" เต็มเมื่อ `booking.detail` (เลข Booking, DO / SH, สถานะงาน raw, แผนเวลา, check-in / check-out, สถานที่, ทีม / หัวหน้า, ได้รับข้อมูลล่าสุดเมื่อ) ไม่งั้นแสดงส่วนสรุป · panel "กล้องของใบงาน" · ลำดับเหตุการณ์ (`events`: สร้างใบงาน / เปลี่ยนสถานะ จาก → เป็น) · ปุ่มกลับไป `/work-orders` · 404 ⇒ `AsyncState` "ไม่พบใบงาน"

- [ ] **Step 1: test ที่ fail** — `'shows header, the full job panel and cameras'` · `'without booking.detail only the summary is shown'` · `'timeline lists created and status changes in order'` · `'404 shows ไม่พบใบงาน'`
- [ ] **Step 2: รันให้ fail** · **Step 3: implement** · **Step 4: รันให้ผ่าน** + `cd client; npm test; npm run typecheck; npm run lint`

---

### Task 13: เอกสาร + ตรวจทั้งระบบ + ทดสอบกับกล้องจริง

**Files:**
- Modify: `docs/blueprint/04-database-design.md` (`CK_WO_Closed`, `Teams.Code` 64), `05-api-design.md` (ตัวอย่าง `openedAt` = check-in, 415 `UNSUPPORTED_MEDIA_TYPE`, `booking.detail`), `07-integration-strategy.md` (ลำดับ rate limit / auth, call log แทน `@Audit`, ไม่ enqueue matching ใน P3a, กติกาหัวหน้าเฉพาะตอนเข้างาน), `02-system-architecture.md` + `03-business-workflows.md` (กติกาหัวหน้า Q55), `08-implementation-roadmap.md` (ขอบเขต P3a ใหม่ + ย้ายรายการไป P3b / P3c + หน้า ใบงาน อ่านอย่างเดียวย้ายเข้ามา), `09-risks-open-questions.md` (DL84 Q54, DL85 Q55), `server/.env.example`, `server/.env.production.example` (`BOOKING_INBOUND_*` ⇒ `[ใช้แล้ว]`, `BOOKING_INBOUND_RATE_LIMIT_PER_MIN`, `BOOKING_PROVIDER_DRIVER` ⇒ `[P3c]`), `CLAUDE.md` (สถานะ P3a — เสนอข้อความให้ผู้ใช้ก่อนแก้)

- [ ] **Step 1: แก้เอกสารตามรายการ** (ทุก fact ของ Booking ติด [Assumption] / [Confirmed])
- [ ] **Step 2: server** — `cd server; npm run ci` ⇒ ผ่านทั้งหมด
- [ ] **Step 3: client** — `cd client; npm test; npm run typecheck; npm run lint; npm run build` ⇒ ผ่าน
- [ ] **Step 4: เครื่อง dev กับ DSS จริง** — `server/.env` ตั้ง `BOOKING_INBOUND_SECRETS` · เปิด api + worker (`DSS_DRIVER=dss`) + client · `npm run booking:simulate -- demo` ⇒ หน้า `/work-orders` มี 3 ใบ (รอเริ่ม / กำลังดำเนินการ / ปิดแล้ว) กล้อง `1000027` สถานะตรงกับ `GET /api/devices` · ใบใหม่ขึ้นเองโดยไม่ refresh (`workorder:changed`) · screenshot
- [ ] **Step 5: วัด p95** — `npm run booking:simulate -- burst --count 200` แล้วอ่าน `LatencyMs` จาก `IntegrationCallLogs` (percentile 95) < 200 ms · บันทึกผลใน Part 8 acceptance
- [ ] **Step 6: เสนอข้อความ commit** (ไม่ commit เอง)
