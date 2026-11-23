# P1 Devices & Real-time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กล้องจาก DSS เข้าตาราง `Devices` อัตโนมัติ · worker poll ตำแหน่ง + สถานะทุก 15 วินาทีลง `DeviceState` / `GpsLocations` · หน้า แผนที่ติดตาม เห็นตำแหน่งสดผ่าน `gps:batch` และหน้า ประวัติเส้นทาง ดูเส้นทางย้อนหลังได้ — บนเครื่อง dev ทั้งกับ simulator 100 กล้องและ DSS จริงผ่าน VPN

**Architecture:** worker role `tracking` รัน 3 job ด้วย timer + Redis lock (`DeviceSync` ตอน start + รายชั่วโมง, `GpsPoll` วนต่อเนื่อง, `PartitionMaintenance` ตอน start + รายวัน) ผ่าน `DssClient` ตัวเดียว (driver `dss` | `mock`) · สถานะสำหรับ "หน้าจอ" มาจาก DSS device list แบบ bulk + Redis cache (DL45) แยกจาก `DeviceState` ที่ GpsPoll เขียนให้ session engine (DL32) · realtime ใช้ `RealtimeGateway.bus` จาก P0 (api = Socket.IO server, worker = Redis emitter) · client ใช้ Leaflet + markercluster

**Tech Stack:** ของเดิม (NestJS 10, drizzle 0.45 + postgres, Redis, Socket.IO, Vite + React 18, TanStack Query, zustand) · client เพิ่ม `leaflet@1.9.4`, `react-leaflet@4.2.1`, `leaflet.markercluster@1.5.3` (+ dev `@types/leaflet`, `@types/leaflet.markercluster`) — ตาม Part 6 §stack

**Spec:** `docs/blueprint/08-implementation-roadmap.md` §P1 · Part 2 (worker roles, failure isolation) · Part 3 §observation / §3.11 settings · Part 4 (Devices, DeviceState, DeviceStatusHistory, GpsLocations, Teams, TeamMembers, Depots, Alerts, retention) · Part 5 (`/devices`, `/tracking/*`, Socket.IO, alert 13) · Part 6 (`/tracking`, `/tracking/history`) · DL11, DL32, DL35, DL45, DL48, DL53, DL56, DL63 · reference `C:\Git\Internal-BodyCam` (อ่านอย่างเดียว): `server/src/common/dss/*`, `modules/tracking/*`, `modules/scheduler/gps-poll.service.ts`, `modules/devices/device-sync.plan.ts`, `modules/tracking/route-builder.ts`, client `features/tracking/*`

## การตัดสินใจของแผนนี้ (ช่องว่างใน blueprint — บันทึกเป็น DL ใหม่ใน Task 14)

1. **ตาราง `Alerts` สร้างใน P1** (ตามคอลัมน์ Part 4) เพื่อเขียน alert 13 · `WorkOrderId` / `TrackingSessionId` / `BookingJobId` เป็น bigint ไม่มี FK จนกว่า phase ที่สร้างตารางนั้นจะเติม · `Notifications` และหน้า แจ้งเตือน เลื่อนไป phase ของ alert (P2) · alert 13 ส่ง `alert:new` เข้า `user:{id}` ของ `ADMIN` ทุกคน
2. **`DeviceState` 1 แถวต่อกล้อง สร้างโดย `DeviceSync`** ใน transaction เดียวกับการ insert `Devices` · observation ใช้ UPDATE อย่างเดียว
3. **simulator (DL56) = driver `DSS_DRIVER=mock`**: device list `SIM-0001`… (`DSS_MOCK_DEVICES`, ค่าเริ่มต้น 100) + `/location` จำลองที่เคลื่อนที่รอบกรุงเทพ · dev ใช้ DSS จริงผ่าน VPN ได้ด้วย `DSS_DRIVER=dss` (DL63)
4. **สถานะบนหน้าจอ (DL45)** = DSS device list (`GET /api/v1/devices` ครั้งเดียวได้ทุกเครื่อง) → cache Redis `device-status:{deviceId}` · cache miss เรียก list ครั้งเดียวแล้วเติมทุก key · DSS ใช้ไม่ได้ ⇒ ถอยไปคำนวณจาก `DeviceState` (`platformStatusFetchedAt: null`) · `DeviceState` ยังเขียนจาก `/location` เท่านั้น (DL32)
5. **รอบ poll ไม่ซ้อนกัน**: `loop()` รอรอบก่อนจบแล้วค่อยนับ interval · รอบนานกว่า interval (R3: ~65 วินาที/100 กล้อง) ⇒ log warn ไม่ข้ามกล้อง · ไม่มี cap จำนวนกล้อง (ต่างจาก reference)
6. **`DeviceCode` = DSS `deviceCode`** (ตัดที่ 30 ตัว · ซ้ำ ⇒ skip `deviceCodeTaken`) · `Kind` = 1 Primary · `Status` = 1 · สร้างเฉพาะชนิดที่เป็น bodycam (`MPT` / body cam) — ตัด regex dashcam ของ reference
7. **`DeviceStatusHistory` เก็บ 3 เดือน** (ตาราง retention Part 4 · แก้ข้อความ 12 เดือนที่ขัดกัน) · การลบ / `DROP PARTITION` ยังอยู่ P6 — P1 ทำเฉพาะสร้าง partition ล่วงหน้า (ทั้ง `GpsLocations` และ `AuditLogs` ที่ P0 สร้างไว้แค่ 3 เดือน)
8. **ทีมปัจจุบันของกล้อง** (`currentTeam`, filter `teamId`) รอ `DeviceAssignments` ของ P3a · P1 ส่ง `currentTeam: null`
9. **สีสถานะกล้อง**: online `success` · offline `neutral` · unknown `warning` (`StatusTone` ไม่มีค่า `unknown` — แก้ Part 6 §status→tone)
10. **ชื่อ env ของ DSS** (blueprint ไม่ได้กำหนด): `DSS_DRIVER`, `DSS_BASE_URL`, `DSS_API_KEY`, `DSS_TIMEOUT_MS`, `DSS_MOCK_DEVICES`, `GPS_POLL_ENABLED`, `GPS_POLL_CONCURRENCY` · auth = JWT HS256 ที่เซ็นใหม่ทุกคำขอด้วย `DSS_API_KEY` (= `API_SECRET_KEY` ของ middleware, `iss` `bwc-nest`, `aud` `psd-bwc-dss-services`, อายุ 60 วินาที) ตาม reference `common/dss/dss-auth.ts`

## Global Constraints

- `C:\Git\Internal-BodyCam` อ่านอย่างเดียว · ห้ามแก้ repo บน Azure · **ทำบน `main` ห้าม commit** — ขั้น Commit = เสนอ message ให้ผู้ใช้ commit เอง
- ชื่อตาราง / คอลัมน์ / enum ตาม Part 4 ตรงตัว: `Devices.Kind` 1 Primary · 2 Spare · `Devices.Status` 1 Active · 2 Inactive · 3 Maintenance · 4 Retired · `DeviceState.PlatformState` 1 Online · 2 Offline (UNKNOWN ไม่เก็บ) · Source 2 DssLocation · 5 Manual (1, 3, 4 สงวน ห้ามใช้) · Alerts Severity 1 Info · 2 Warning · 3 Critical · Status 1 New · 2 Acknowledged · 3 Resolved · 4 Dismissed · alert 13 `DEVICE_VENDOR_MISSING`
- **ห้ามเขียน null ลงสถานะเมื่อ DSS หลุด / worker restart** (DL11) · `StateSince` เปลี่ยนเฉพาะเมื่อสถานะเปลี่ยน · เวลาสถานะใช้ DB `now()`
- `tracking` / `device-status` ห้ามเรียกระบบภายนอกอื่นนอกจาก DSS · emit realtime **หลัง commit** เท่านั้น · lock order `DeviceState` ตาม `DeviceId` จากน้อยไปมาก · ห้าม `.limit()` โดยไม่มี `ORDER BY`
- เพิ่ม setting = `SETTING_DEFAULTS` + `SETTING_BOUNDS` + data migration (ไม่พึ่ง seed) · ทุก endpoint มี `@RequirePermission` (route-guard-coverage test ต้องผ่าน) · write มี `@Audit`
- ช่วง dev แก้ / reset DB ได้ (DL50) · migration ใหม่ต่อท้าย `0004`
- client: ข้อความผ่าน i18n th/en (parity test) · ใช้ design system เดิม (`client/DESIGN.md`) · ข้อความบนจอไม่บอกที่มาของข้อมูลว่า Booking (DL64)
- ทุก task จบด้วย `npm run ci` (server) หรือ `npm test && npm run typecheck && npm run lint` (client) ผ่าน

## Review Focus

1. **รอบ `/location` นานกว่า interval** (DSS ช้า ~0.6 วินาที/กล้อง) ⇒ ไม่มีรอบซ้อน ไม่มีกล้องถูกข้าม รอบถัดไปเริ่มหลังรอบก่อนจบ + log warn (Task 6: test)
2. **DSS ตอบ HTTP 200 แต่ `code` ≠ 1000 / `code` 5000 / พิกัด (0,0) / JSON เพี้ยน / timeout** ⇒ ไม่ล่ม · สถานะเป็น null (ไม่เดา) · ไม่มีจุด GPS ที่ (0,0) ลงตาราง · กล้องอื่นในรอบเดียวกันไม่กระทบ (Task 2, Task 6: test)
3. **worker restart / DSS หายแล้วกลับมา** ⇒ `StateSince` ของกล้องที่สถานะเดิมไม่เปลี่ยน · ไม่มีแถว `DeviceStatusHistory` ใหม่ · `LastObservedAt` เดินต่อ (Task 4: test)
4. **นาฬิกากล้องเพี้ยน** ⇒ จุดที่เวลาเกินอนาคต 2 นาทีถูกตัด · จุดที่เก่ากว่า `LastFixAt` ถูกตัด · ส่งจุดซ้ำซ้ำได้ผลเดิม (Task 5: test)
5. **DSS device list ส่งมาไม่ครบหน้า (`totalCount` > จำนวนแถว)** ⇒ ไม่ตั้ง `VendorMissingSince` และไม่ยิง alert 13 ให้กล้องที่แค่ไม่อยู่ในหน้าแรก (Task 3: test)

---

### Task 1: Schema P1 + migrations + settings

**Files:**
- Modify: `server/src/db/schema.ts` (Devices, DeviceState, DeviceStatusHistory, Teams, TeamMembers, Depots, Alerts), `server/src/db/schema.partitioned.ts` (GpsLocations), `server/src/common/settings/setting-spec.ts`, `server/src/modules/settings/settings-admin.service.ts` (pair rule), `server/src/db/dev-seed.ts` (mock depots), `server/src/db/reference-data.int-test.ts`
- Create: `server/drizzle/0005_p1_devices.sql` (`npm run db:generate -- --name=p1_devices`), `server/drizzle/0006_p1_tracking_custom.sql` (`npm run db:generate -- --custom --name=p1_tracking_custom`)
- Test: `server/src/db/p1-schema.int-test.ts`, `setting-spec.test.ts` (เพิ่ม), `dev-seed.int-test.ts` (เพิ่ม)

**Interfaces:**
- Produces: drizzle tables `Devices`, `DeviceState`, `DeviceStatusHistory`, `Teams`, `TeamMembers`, `Depots`, `Alerts` (คอลัมน์ / constraint ตาม Part 4 ตรงตัว: `UQ_Devices_Code` partial, `UQ_Devices_VendorId` ไม่กรอง IsDeleted, `IX_DeviceState_PlatformState`, history IX `(DeviceId, ObservedAt DESC)`, `UQ_Teams_Code`, `UQ_Teams_BookingRef`, `CK_TeamMembers_Window`, `UQ_TeamMembers_ActiveLeader`, `UQ_TeamMembers_ActiveEmployee`, IX `(TeamId, ValidFrom DESC)`, `UQ_Depots_Code`, `CK_Depots_Radius` 20–2000, `UQ_Alerts_OpenDedupe (DedupeKey) WHERE Status IN (1,2)`, IX `(Status, Severity, OccurredAt DESC)`) · `GpsLocations` typed table ใน `schema.partitioned.ts` (`IsValidFix` NN default true · ไม่มี Id)
- `0006` (custom): `GpsLocations` partitioned ตาม SQL ตัวอย่าง Part 4 (+ `_default` + `DO $$` สร้างเดือนปัจจุบัน +2 เดือน แบบ AuditLogs + BRIN `IX_GpsLocations_RecordedAt_brin`) · `EX_TeamMembers_LeaderNoOverlap` · Settings rows (`ON CONFLICT DO NOTHING`, ValueType 2, Category `tracking`, คำอธิบายไทย)
- Settings: `gps.poll-interval-seconds` 15 [5, 300] · `status.unknown-after-seconds` 120 [30, 3600] · `status.display-cache-seconds` 10 [0, 60] · `depot.fix-max-age-minutes` 30 [5, 240] · `tracking.stop-min-minutes` 5 [1, 120] · `tracking.stop-radius-meters` 50 [10, 500] · pair rule `SETTING_PAIR_RULES`: `status.unknown-after-seconds` ≥ 2 × `gps.poll-interval-seconds` ⇒ PATCH ที่ทำให้ผิด = 400 `SETTING_OUT_OF_RANGE`
- dev seed: `Depots` 2 จุด mock (`DEPOT-01` สำนักงาน 13.7563, 100.5018 radius 150 · `DEPOT-02` 13.80, 100.55 radius 150) — upsert ตาม `Code`

- [ ] **Step 1: เขียน test ที่ fail** — `p1-schema.int-test.ts`: insert `Devices` ซ้ำ `VendorDeviceId` แม้แถวเดิม `IsDeleted` ⇒ error unique · `DeviceCode` ซ้ำหลัง soft delete ได้ · TeamMembers leader 2 คนช่วงเวลาทับในทีมเดียว ⇒ error exclusion · `ValidTo <= ValidFrom` ⇒ error check · Depots radius 10 ⇒ error check · Alerts `DedupeKey` ซ้ำขณะ Status 1 ⇒ error, Status 3 แล้วซ้ำได้ · `GpsLocations` เป็น partitioned มี `_default` + เดือนปัจจุบัน +2 · insert จุดเดิมซ้ำ `ON CONFLICT DO NOTHING` ได้ 0 แถว · reference-data: 6 settings ใหม่มีค่าตามข้างบน · setting-spec: pair rule ผิด ⇒ `{ ok: false }`
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/db` — Expected: FAIL
- [ ] **Step 3: Implement** schema + generate `0005` + เขียน `0006` + settings spec/pair rule + seed depots
- [ ] **Step 4: Run** `npm run db:migrate && npm run db:prepare:test && npm run ci` — Expected: PASS · drift guard ตอน boot รายงาน 7 migration
- [ ] **Step 5: Commit** (เสนอ) `feat(server): P1 schema — devices, device state, GPS partitions, teams, depots, alerts`

### Task 2: DSS client (auth, `/location`, device list, simulator)

**Files:**
- Create: `server/src/common/dss/dss-auth.ts`, `dss-fetch-error.ts`, `dss-config.ts`, `dss-client.ts` (interface + token), `dss-http.client.ts`, `dss-mock.client.ts`, `dss.module.ts` · `server/src/common/geo/haversine.ts`
- Modify: `server/src/common/config/prod-readiness.ts` (DSS checks), `server/.env.example` (หมวด 8 DSS เป็นชื่อจริง), `server/src/test/dss-token.ts` (helper ตรวจ Bearer)
- Test: port `dss-auth.test.ts`, `dss-fetch-error.test.ts`, `dss-location.provider.test.ts` → `dss-http.client.test.ts` (local `node:http` server), port `dss-device-inventory.provider.test.ts` → รวมใน `dss-http.client.test.ts`, `dss-mock.client.test.ts`, `haversine.test.ts`, `prod-readiness.test.ts` (เพิ่ม)

**Interfaces:**
- Produces:
  - `DSS_CLIENT` token · `interface DssClient { fetchReading(vendorDeviceId: string): Promise<VendorDeviceReading>; listDevices(): Promise<VendorInventory> }`
  - `VendorDeviceReading = { vendorDeviceId: string; online: boolean | null; location: { lat: number; lng: number; recordedAt: Date | null; speedKph: number | null } | null }`
  - `VendorDevice = { vendorDeviceId: string; deviceName: string | null; vendorType: string | null; model: string | null; serialNo: string | null; online: boolean | null }` · `VendorInventory = { devices: VendorDevice[]; complete: boolean; fetchedAt: Date }`
  - `readDssConfig(env): { driver: 'dss' | 'mock'; baseUrl: string | null; apiKey: string | null; timeoutMs: number; mockDevices: number }` (`DSS_DRIVER` ค่าเริ่มต้น `mock` · `DSS_TIMEOUT_MS` 10000 [1000, 60000] · `DSS_MOCK_DEVICES` 100 [1, 1000]) · driver `dss` แต่ไม่มี `DSS_BASE_URL` / `DSS_API_KEY` ⇒ throw ตอน boot พร้อมชื่อ env
  - http: `POST {DSS_BASE_URL}/api/v1/location` body `{"deviceCode": id}` · `GET {DSS_BASE_URL}/api/v1/devices` · header `Authorization: Bearer <JWT>` (claims ตามการตัดสินใจข้อ 10) · ไม่ retry · `DSS_SUCCESS_CODE = 1000`, `DSS_DEVICE_OFFLINE_CODE = 5000`
  - parse ตาม reference: `lat = gpsY`, `lng = gpsX` · (0,0) / นอกช่วง / ไม่ใช่ตัวเลข ⇒ location null · `online` = code 1000 ⇒ `status === 1` · 5000 ⇒ false · อื่น ⇒ null · `updateTime` > 1e12 = ms ไม่งั้น seconds · device list รับทั้ง `data: { totalCount, pageData }` และ array · `complete = totalCount === null || totalCount <= rows.length`
  - mock: `listDevices` ⇒ `SIM-0001`…`SIM-{N}` (`vendorType 'MPT'`, `model 'DH-MPT230'`, complete true) · `fetchReading` ⇒ วงกลม ~110 m รอบจุดของแต่ละเครื่อง (สูตร reference: `BASE 13.7563, 100.5018`, `offset = hashToUnit(id)`, รอบละ 10 นาที) · ทุก 10 เครื่องที่ index หาร 10 ลงตัว ⇒ `online: false, location: null` · index หาร 7 ลงตัว ⇒ online แต่ location null (ในอาคาร)
  - prod-readiness: production + `DSS_DRIVER` ≠ `dss` ⇒ fail · ไม่มี `DSS_BASE_URL` / `DSS_API_KEY` ⇒ fail · `DSS_API_KEY` < 32 ตัว ⇒ warn

- [ ] **Step 1: Port / เขียน test ที่ fail** (ตามรายการ test ของ reference ที่ระบุใน Files + mock: 100 เครื่อง, เครื่องที่ 10 offline, ตำแหน่งเปลี่ยนตามเวลา)
- [ ] **Step 2: Run** `npx vitest run src/common/dss src/common/geo src/common/config` — Expected: FAIL
- [ ] **Step 3: Implement** ตาม Interfaces (port reference `common/dss/*`, parser จาก `dss-location.provider.ts` / `dss-device-inventory.provider.ts`)
- [ ] **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): DSS client with JWT auth and a 100-camera simulator`

### Task 3: DeviceSync job + alert 13

**Files:**
- Create: `server/src/modules/devices/device-sync.plan.ts`, `device-sync.service.ts`, `device-sync.job.ts`, `devices.module.ts` · `server/src/modules/alerts/alert-types.ts`, `alert-writer.service.ts`, `alerts.module.ts`
- Test: port `device-sync.plan.test.ts` (ตัดกรณี dashcam / company), `device-sync.int-test.ts`, `alert-writer.int-test.ts`

**Interfaces:**
- Consumes: `DSS_CLIENT` (Task 2), `RedisLockService`, `RealtimeGateway.bus` (P0)
- Produces:
  - `LocalDeviceRow = { id: bigint; deviceCode: string; vendorDeviceId: string; name: string | null; serialNo: string | null; model: string | null; isDeleted: boolean; vendorMissingSince: Date | null }`
  - `planDeviceSync(vendor: readonly VendorDevice[], local: readonly LocalDeviceRow[]): SyncPlan` — `SyncPlan = { creates: { vendorDeviceId: string; deviceCode: string; name: string; serialNo: string | null; model: string | null }[]; updates: { id: bigint; patch: { Name?; SerialNo?; Model? } }[]; skips: { vendorDeviceId; reason: 'duplicateInVendorList' | 'unsupportedType' | 'tooLong' | 'localDeleted' | 'deviceCodeTaken' }[]; missingAtVendor: { id: bigint; deviceCode: string }[]; seenIds: bigint[]; unchanged: number }` (`name` ว่าง ⇒ ใช้ `deviceCode`) · `isBodycam(vendorType, model, name): boolean` (`/body\s*-?\s*cam|\bmpt\b/i`, model `/(^|[^a-z])mpt(?![a-z])/i`)
  - `DeviceSyncService.syncOnce(): Promise<DeviceSyncResult>` (`{ created, updated, missing, reappeared, skipped, vendorTotal, complete }`) — lock `device:sync` TTL 600 · insert `Devices` + `DeviceState(DeviceId)` ใน transaction เดียว · `VendorSeenAt = now()` + `VendorMissingSince = null` ให้ทุกเครื่องที่เห็น · **เฉพาะ `complete`** ⇒ `VendorMissingSince = now()` ให้เครื่องที่หาย (ที่ยังเป็น null) · ไม่ลบ · หลัง commit: alert 13 ให้เครื่องที่เพิ่งหาย, resolve alert ของเครื่องที่กลับมา
  - `DeviceSyncJob` (worker เท่านั้น): `syncOnce()` ตอน `onApplicationBootstrap` แล้วทุก 3,600,000 ms (`setTimeout(...).unref()` หลังรอบจบ)
  - `ALERT_TYPE = { DEVICE_VENDOR_MISSING: 13 } as const` · `AlertWriterService.raise(input: { alertType; severity: 1|2|3; deviceId?: bigint; title; message; data?; dedupeKey }): Promise<bigint | null>` (insert `ON CONFLICT DO NOTHING` บน `UQ_Alerts_OpenDedupe` ⇒ null เมื่อมีอยู่แล้ว · ได้แถวใหม่ ⇒ emit `alert:new` `{ alertId, alertType, severity, title, message, deviceId }` เข้า `user:{id}` ของผู้ใช้ `ADMIN` ที่ใช้งานอยู่ทุกคน) · `resolve(dedupeKey): Promise<number>` (Status 1|2 ⇒ 3, `ResolvedAt = now()`)
  - alert 13: severity 2 · dedupeKey `13:device:{deviceId}` · title `กล้อง {DeviceCode} หายจากรายการอุปกรณ์ของ DSS` · message `ตรวจรอบล่าสุดไม่พบกล้องนี้ในรายการอุปกรณ์ — ระบบไม่ลบกล้อง กรุณาตรวจที่ DSS`

- [ ] **Step 1: Port / เขียน test ที่ fail** — plan: ชนิดที่ไม่ใช่ bodycam ⇒ skip `unsupportedType` · เติมเฉพาะช่องว่าง ไม่ทับ · เครื่องหาย ⇒ `missingAtVendor` ไม่ลบ · int: mock 100 ⇒ `Devices` 100 แถว + `DeviceState` 100 แถว · sync ซ้ำ ⇒ created 0 · ลบ 1 เครื่องออกจาก vendor list ⇒ `VendorMissingSince` ถูกตั้ง + Alerts 1 แถว (type 13) + socket ของ ADMIN ได้ `alert:new` · sync อีกรอบยังหาย ⇒ ไม่มี alert ซ้ำ · กลับมา ⇒ `VendorMissingSince` null + alert Resolved · **list ไม่ครบ (`complete: false`) ⇒ ไม่มีเครื่องไหนถูกตั้ง missing และไม่มี alert** (Review Focus 5)
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): DeviceSync job from the DSS device list with vendor-missing alert`

### Task 4: บันทึก observation ลง `DeviceState` / `DeviceStatusHistory`

**Files:**
- Create: `server/src/modules/device-status/observation.ts` (pure), `device-status.service.ts`, `device-status.module.ts`
- Test: `observation.test.ts`, `device-status.int-test.ts`

**Interfaces:**
- Produces:
  - `PLATFORM_STATE = { ONLINE: 1, OFFLINE: 2 } as const` · `STATE_SOURCE = { DSS_LOCATION: 2, MANUAL: 5 } as const`
  - `decideObservation(prev: { platformState: 1 | 2 | null }, next: 1 | 2): { changed: boolean; from: 1 | 2 | null; to: 1 | 2 }`
  - `DeviceStatusService.applyObservations(items: { deviceId: bigint; state: 1 | 2 }[], source = 2): Promise<{ changed: { deviceId; from; to }[] }>` — เรียงตาม `deviceId` · ทีละเครื่องใน transaction: `SELECT … FOR UPDATE` แล้ว UPDATE `LastObservedAt = now()`, `LastSource`, `StateSourceObservedAt = now()`, `LastOnlineObservedAt = now()` เมื่อ 1 · เปลี่ยนสถานะ ⇒ `PlatformState`, `StateSince = now()`, `StateSource` + INSERT `DeviceStatusHistory (FromState, ToState, ObservedAt = now(), Source)` · ไม่มี state ⇒ ไม่แตะแถว (ไม่เขียน null)
  - `displayStateOf(row: { platformState; lastObservedAt: Date | null }, now: Date, unknownAfterSeconds: number): 'online' | 'offline' | 'unknown'`

- [ ] **Step 1: เขียน test ที่ fail** — `decideObservation` ทุกกิ่ง · `displayStateOf`: ไม่เคยเห็น ⇒ unknown, เก่ากว่า 120 วินาที ⇒ unknown, ใหม่ ⇒ ตาม state · int: offline→online ⇒ `StateSince` ใหม่ + history 1 แถว · online ซ้ำ 3 รอบ ⇒ `StateSince` เดิม, history ไม่เพิ่ม, `LastObservedAt` เดินหน้า · จำลอง worker restart (สร้าง service ใหม่) แล้ว online ซ้ำ ⇒ `StateSince` เดิม (Review Focus 3) · 2 เครื่องส่งสลับลำดับ ⇒ ไม่ deadlock
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): device state observations with transition history`

### Task 5: GPS ingest pipeline

**Files:**
- Create: `server/src/modules/tracking/fix-freshness.ts`, `stale-start.ts` (เฉพาะ `confirmsStaleStartLanding` + `STALE_START_RULES` จาก reference `route-builder.ts`), `gps-ingest.service.ts`, `tracking.module.ts`
- Test: port `fix-freshness.test.ts`, `confirmsStaleStartLanding` tests, `gps-ingest.int-test.ts` (port กลุ่ม ingest ของ `tracking-webhook.int-test.ts`)

**Interfaces:**
- Consumes: `GpsLocations` (Task 1), `SettingsService`, `RealtimeGateway.bus`
- Produces:
  - `fixMaxAgeSeconds(unknownAfterSeconds: number, pollIntervalSeconds: number): number` = `max(1, unknown) + 2 × max(0, poll)` · `isFreshFix(at, now, maxAgeSeconds): boolean` (อนาคต = fresh)
  - `GpsFix = { deviceId: bigint; recordedAt: Date | null; lat: number; lng: number; speedKph: number | null; heading?: number | null }`
  - `GpsIngestService.ingest(fixes: GpsFix[]): Promise<IngestResult>` — `IngestResult = { received, stored, duplicate, stale, future, suspect, revalidated, freshDeviceIds: bigint[] }` · ลำดับ: `recordedAt` null ⇒ ใช้ `now` · เรียงเวลา · ซ้ำในชุด ⇒ ข้าม · **> now + 2 นาที ⇒ `future` ตัดทิ้ง** · `≤ DeviceState.LastFixAt` ⇒ `stale` ตัดทิ้ง · stale-start revalidation (5 จุดล่าสุดด้วย `CROSS JOIN LATERAL … ORDER BY RecordedAt DESC LIMIT 5`) · drift: ระยะ < 5 m หรือความเร็ว ≤ 200 km/h ⇒ valid ไม่งั้น `IsValidFix = false` (เก็บไว้) · insert chunk 1000 `ON CONFLICT ("DeviceId","RecordedAt") DO NOTHING RETURNING "DeviceId"` · snapshot `DeviceState` (`LastFixAt`, `LastLat`, `LastLng`, `LastSpeedKph`, `LastHeading`, `LastFixValid`, `IsAtDepot`) เดินหน้าอย่างเดียว (`WHERE "LastFixAt" IS NULL OR "LastFixAt" < v.at`) · `IsAtDepot` = fix valid อายุ ≤ `depot.fix-max-age-minutes` และอยู่ในรัศมี `Depots` ที่ active · ไม่มี fix ⇒ null
  - หลัง commit emit `gps:batch` เข้า room `tracking`: `{ points: [{ deviceId: string, lat, lng, speedKph, heading, recordedAt: ISO, isValidFix: true }] }` (เฉพาะจุด valid)

- [ ] **Step 1: Port / เขียน test ที่ fail** — ตามกลุ่ม ingest ของ reference (empty, duplicate, stale, suspect jump, stale-start revalidation) + เพิ่ม: จุดอนาคต 3 นาที ⇒ `future` 1, ไม่ลงตาราง · ส่งชุดเดิมซ้ำ ⇒ `stored` 0 (Review Focus 4) · จุดในรัศมี depot mock ⇒ `IsAtDepot` true · socket ใน room `tracking` ได้ `gps:batch` หลัง commit
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): GPS ingest pipeline with drift, stale and future-time filters`

### Task 6: GpsPoll job + worker wiring

**Files:**
- Create: `server/src/modules/tracking/gps-poll.service.ts`, `server/src/modules/tracking/tracking-worker.module.ts`
- Modify: `server/src/worker.module.ts` (role `tracking` ⇒ `TrackingWorkerModule` ที่รวม `DeviceSyncJob`, `GpsPollService` — Task 7 เพิ่ม `PartitionMaintenanceJob`), `server/.env.example`
- Test: port `gps-poll.test.ts` (`gpsPollOptions`, `runPool`), `gps-poll.int-test.ts`, `worker-roles` test (เพิ่ม)

**Interfaces:**
- Consumes: `DSS_CLIENT`, `DeviceStatusService.applyObservations`, `GpsIngestService.ingest`, `RedisLockService`, `SettingsService`
- Produces:
  - `gpsPollOptions(env): { enabled: boolean; concurrency: number }` (`GPS_POLL_ENABLED` ค่าเริ่มต้น true · `false` ปิด · `GPS_POLL_CONCURRENCY` 8 [1, 32])
  - `runPool<T>(items: readonly T[], size: number, worker: (item: T) => Promise<void>): Promise<void>`
  - `GpsPollService.tick(): Promise<PollResult | null>` (null = ไม่ได้ lock) — lock `gps:poll` TTL 300 · เครื่องที่ `IsDeleted = false AND Status <> 4` เรียง `Id` **ไม่มี limit** · `fetchReading` ทีละเครื่องผ่าน `runPool` · error ของเครื่องหนึ่งนับ `failed` แล้วไปต่อ · state = `online ?? (fix สด ? true : null)` ⇒ `applyObservations` เฉพาะที่ไม่ null · fix ⇒ `ingest` · `PollResult = { devices, observed, fixes, failed, elapsedMs }`
  - `loop()`: `await tick()` แล้ว `setTimeout(loop, gps.poll-interval-seconds × 1000).unref()` · `elapsedMs` > interval ⇒ `logger.warn` · เริ่มใน `onApplicationBootstrap` ของ worker เท่านั้น (api / int test ไม่เริ่มเอง)

- [ ] **Step 1: เขียน test ที่ fail** — int (mock 100 กล้อง): หลัง `syncOnce()` + `tick()` ⇒ `DeviceState` ทุกเครื่องมี `LastObservedAt` (ยกเว้นที่ online null) · `GpsLocations` ได้จุดของเครื่องที่มี fix · เครื่อง index หาร 10 ลงตัว ⇒ Offline · DssClient ปลอมที่ throw ให้ 1 เครื่อง ⇒ เครื่องอื่นครบ, `failed` 1 · DssClient ปลอมช้า (รอบ > interval) ⇒ ทุกเครื่องถูกถามครบ 1 ครั้งต่อรอบ, ไม่มีรอบซ้อนเมื่อเรียก `tick()` 2 ครั้งพร้อมกัน (ตัวที่สองได้ null) (Review Focus 1) · DssClient ตอบ code 4000 / JSON เสีย ⇒ ไม่เขียน state, ไม่มีจุด (Review Focus 2) · Redis ไม่พร้อม ⇒ `tick()` คืน null ไม่เรียก DSS
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` แล้วรัน `npm run start:worker:dev` กับ `DSS_DRIVER=mock` — Expected: log รอบ poll ทุก ~15 วินาที, `Devices` 100 แถว
- [ ] **Step 5: Commit** (เสนอ) `feat(server): GpsPoll worker job over all cameras`

### Task 7: PartitionMaintenance job

**Files:**
- Create: `server/src/db/partitions.ts` (pure), `server/src/modules/tracking/partition-maintenance.job.ts`
- Modify: `server/src/modules/tracking/tracking-worker.module.ts` (เพิ่ม `PartitionMaintenanceJob`)
- Test: `partitions.test.ts`, `partition-maintenance.int-test.ts`

**Interfaces:**
- Produces:
  - `monthlyPartitionsAhead(now: Date, monthsAhead: number): { name(table): string; from: string; to: string }[]` (UTC, `YYYYMM`, เดือนปัจจุบัน + `monthsAhead`)
  - `PartitionMaintenanceJob.runOnce(): Promise<{ created: string[]; blocked: string[] }>` — lock `partition:maintenance` TTL 300 · ตาราง `GpsLocations` และ `AuditLogs` · เดือนปัจจุบัน + 2 เดือน · `CREATE TABLE IF NOT EXISTS … PARTITION OF … FOR VALUES FROM … TO …` · `_default` มีแถวในช่วงเดือนนั้น ⇒ ไม่สร้าง ใส่ `blocked` + `logger.error` · รันตอน bootstrap ของ worker แล้วทุก 24 ชม.

- [ ] **Step 1: เขียน test ที่ fail** — pure: ข้ามปี (2026-12 ⇒ 202612, 202701, 202702) · int: ลบ partition เดือนที่ +2 ทิ้งแล้ว `runOnce()` ⇒ สร้างคืน · รันซ้ำ ⇒ `created` ว่าง · ใส่แถวลง `GpsLocations_default` ที่เวลาเดือน +3 แล้ว `runOnce()` ด้วย now ที่ทำให้ต้องสร้างเดือนนั้น ⇒ `blocked`
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): monthly partition maintenance for GPS and audit logs`

### Task 8: สถานะกล้องสำหรับหน้าจอ + `GET /api/devices`

**Files:**
- Create: `server/src/modules/devices/device-status-display.service.ts`, `devices.controller.ts`, `devices.service.ts`, `devices.mapper.ts`, `dto/query-devices.dto.ts`
- Test: `device-status-display.int-test.ts`, `devices.int-test.ts`

**Interfaces:**
- Consumes: `DSS_CLIENT.listDevices`, `REDIS_CLIENT`, `displayStateOf` (Task 4), `SettingsService`
- Produces:
  - `DeviceStatusDisplayService.statuses(devices: { id: bigint; vendorDeviceId: string }[]): Promise<Map<string, { platformState: 'online' | 'offline' | 'unknown'; platformStatusFetchedAt: string | null }>>` — `MGET` key จาก `deviceStatusCacheKey(id, env)` = `cache:{ชื่อ database}:device-status:{id}` (ชื่อ DB จาก `DATABASE_URL` แบบ `lockPrefix` ใน `common/lock/lock-key.ts` — `bwc` กับ `bwc_test` ใช้ Redis เดียวกันได้ไม่ชนกัน) · ครบ ⇒ ไม่เรียก DSS · ขาด ⇒ `listDevices()` 1 ครั้ง แล้ว `SET … EX status.display-cache-seconds` ทุกเครื่อง (0 ⇒ ไม่ cache) · Redis error ⇒ ข้าม cache เรียก DSS ตรง (fail-open) · DSS error ⇒ ใช้ `displayStateOf(DeviceState)` + `platformStatusFetchedAt: null` · online null จาก DSS ⇒ `unknown`
  - `GET /api/devices` (`devices:read`) query `PageQueryDto & { status?: 1|2|3|4; kind?: 1|2; online?: 'online'|'offline'|'unknown' }` (pageSize ≤ 100) → envelope ของ `DeviceRow = { id, deviceCode, vendorDeviceId, name, model, serialNo, kind, status, streamingEnabled, vendorMissingSince, platformState, platformStatusFetchedAt, lastFixAt, lastLat, lastLng, currentTeam: null }` เรียง `DeviceCode` · ไม่รวม `IsDeleted` · filter `online` คำนวณหลังได้สถานะ (จำนวนกล้อง ~100 — ทำในหน่วยความจำได้)

- [ ] **Step 1: เขียน test ที่ fail** — เรียก 2 ครั้งภายใน 10 วินาที ⇒ DssClient ปลอม `listDevices` ถูกเรียก 1 ครั้ง · `status.display-cache-seconds` = 0 ⇒ ถูกเรียกทุกครั้ง · Redis ปิด (`REDIS_URL` port ว่าง) ⇒ ยังได้สถานะจาก DSS · DSS throw ⇒ ได้สถานะจาก `DeviceState` + `platformStatusFetchedAt` null · `VIEWER` อ่านได้ · ไม่มี token ⇒ 401 · filter `online=offline` ได้เฉพาะ offline
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): device list with cached DSS status (fail-open)`

### Task 9: Tracking read API — ตำแหน่งปัจจุบัน + ประวัติเส้นทาง

**Files:**
- Create: `server/src/modules/tracking/route-builder.ts` (port ตัด `movingRuns` / `matchSegments` / road-match), `tracking.controller.ts`, `tracking-read.service.ts`, `dto/query-history.dto.ts`
- Test: port `route-builder.test.ts` (ตัดกลุ่ม `matchSegments`), `tracking-read.int-test.ts` (port กลุ่ม `deviceHistory` + เพิ่ม positions), `history-plan.int-test.ts`

**Interfaces:**
- Consumes: `DeviceStatusDisplayService.statuses` (Task 8), `fixMaxAgeSeconds` (Task 5), `stale-start.ts`
- Produces:
  - `buildRoute(points: RoutePoint[], rules: { stopRadiusM; stopMinMinutes; gapSeconds }): BuiltRoute` (`dropStaleStarts` → `dropSpikes` → `smoothStationary` → stops → segments/gaps → `simplifyLines` ≤ 2000 จุด) · `toRouteJson(route)`
  - `GET /api/tracking/positions` (`tracking:view`) → `{ data: [{ deviceId, deviceCode, name, lat, lng, speedKph, heading, lastFixAt, fixValid, platformState, platformStatusFetchedAt }], total, fixActiveSeconds: 120 }` ทุกกล้องที่ไม่ลบและไม่ Retired (lat/lng เป็น null ได้)
  - `GET /api/tracking/devices/:id/history?from&to` (`tracking:history`, `@Audit('VIEW_GPS_HISTORY', 'Devices')`) → `{ device: { id, code, name }, from, to, rules, pointCount, suspectCount, staleStartCount, spikeCount, smoothedCount, truncated, start, end, segments, gaps, timeline }` · ใช้เฉพาะ `IsValidFix` · cap 50,001 จุด ⇒ `truncated` · ช่วงไม่ถูก (`to <= from`, เกิน 24 ชม., `from` > now + 5 นาที, วันที่ผิด) ⇒ 400 `INVALID_RANGE` · ไม่พบ ⇒ 404 · rules จาก settings `tracking.stop-*` + `gapSeconds = fixMaxAgeSeconds(...)`

- [ ] **Step 1: Port / เขียน test ที่ fail** — ตามรายการ reference + `history-plan.int-test.ts`: `EXPLAIN` ของ query ประวัติ 24 ชม. ใช้ `PK_GpsLocations` (Index Scan) และอ่านเฉพาะ partition ของช่วงนั้น (partition pruning) — เกณฑ์ < 2 วินาทีที่ 10M แถวตรวจมือใน Task 14
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS (route-guard-coverage ยังผ่าน)
- [ ] **Step 5: Commit** (เสนอ) `feat(server): tracking positions and route history API`

### Task 10: Realtime rooms `tracking` / `alerts`

**Files:**
- Modify: `server/src/modules/realtime/realtime-rooms.ts`, `realtime.gateway.ts`
- Test: `realtime-rooms.test.ts` (เพิ่ม), `realtime.int-test.ts` (เพิ่ม)

**Interfaces:**
- Produces: `TRACKING_ROOM = 'tracking'`, `ALERTS_ROOM = 'alerts'` · `roomsForClient(identity: { sub: string; roleCode: string; permissions: string[] }): string[]` (ขยายจาก `{ sub }` เดิม · gateway ส่ง role + permissions ที่โหลดจาก DB ตอน handshake ไม่ใช้ค่าใน token) = `org`, `user:{sub}` + `tracking` เมื่อ `ADMIN` หรือมี `tracking:view` + `alerts` เมื่อ `ADMIN` หรือมี `alerts:view` (`TEAM_LEADER` ไม่เข้า tracking — P5)

- [ ] **Step 1: เขียน test ที่ fail** — unit: OPERATOR ⇒ `['org','user:7','tracking','alerts']` · user ไม่มี `tracking:view` ⇒ ไม่มี `tracking` · int: socket VIEWER ได้ `gps:batch` ที่ worker emitter ส่งเข้า `tracking` · socket ไม่มีสิทธิ์ไม่ได้
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm run ci` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(server): tracking and alerts realtime rooms`

### Task 11: Client — แผนที่พื้นฐาน + ป้ายสถานะ

**Files:**
- Modify: `client/package.json` (deps ใน Tech Stack), `client/src/styles/global.css` (port `.tracking-marker*`, `.route-*` จาก reference `client/src/styles/global.css` L171-407 ตัด dashcam), `client/.env.example`, `client/src/features/settings/settingForm.ts` (`CATEGORY_LABEL_KEY.tracking`), i18n th/en
- Create: `client/src/components/map/MapCanvas.tsx`, `MarkerClusterLayer.tsx`, `mapConfig.ts`, `client/src/components/status/DeviceStateBadge.tsx`, `deviceStateTone.ts`
- Test: `deviceStateTone.test.ts`, `MarkerClusterLayer.test.tsx`, `mapConfig.test.ts`

**Interfaces:**
- Produces:
  - `MAP_DEFAULT_CENTER = [13.7563, 100.5018]` · `tileLayerConfig(env): { url: string; attribution: string }` (`VITE_MAP_TILE_URL` ค่าเริ่มต้น `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, `VITE_MAP_TILE_ATTRIBUTION` ค่าเริ่มต้น OSM — production ต้องตั้งเป็น tile server ของเราเอง)
  - `<MapCanvas center? zoom? className? children />` (react-leaflet `MapContainer` + `TileLayer` + แจ้ง `tileerror`)
  - `<MarkerClusterLayer markers: { id: string; lat: number; lng: number; icon: L.DivIcon; onClick?: () => void }[] />` (ห่อ `leaflet.markercluster` ผ่าน `useMap`)
  - `deviceStateTone(state: 'online' | 'offline' | 'unknown'): StatusTone` = success / neutral / warning · `<DeviceStateBadge state />` (ข้อความ ออนไลน์ / ออฟไลน์ / ไม่ทราบสถานะ)

- [ ] **Step 1: เขียน test ที่ fail** — tone ทั้ง 3 ค่า · `MarkerClusterLayer` ได้ 3 marker ⇒ layer มี 3 marker และอัปเดตเมื่อ props เปลี่ยน (ไม่สร้าง layer ใหม่ทั้งชุด) · `tileLayerConfig` อ่าน env
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** `npm test && npm run typecheck && npm run lint` — Expected: PASS (design guard + i18n parity)
- [ ] **Step 5: Commit** (เสนอ) `feat(client): map canvas, marker clustering and device state badge`

### Task 12: Client — หน้า แผนที่ติดตาม `/tracking`

**Files:**
- Create: `client/src/features/tracking/tracking.api.ts`, `liveMerge.ts`, `useLivePositions.ts`, `LiveMapPage.tsx`, `components/CameraListPanel.tsx`, `components/CameraCard.tsx`
- Modify: `client/src/app/router.tsx`, `client/src/app/nav.ts` (`to: '/tracking'`), i18n th/en
- Test: port `liveMerge.test.ts`, `useLivePositions.test.tsx` (ตัด `device:status` / `job:status` / mock mode), `LiveMapPage.test.tsx`, `router.test.tsx` / `nav.test.ts` (เพิ่ม)

**Interfaces:**
- Consumes: `GET /api/tracking/positions`, event `gps:batch` `{ points }` (Task 5, 9)
- Produces:
  - `trackingApi.positions(): Promise<PositionsResponse>` · `LiveDevice = { id; deviceCode; name; lat; lng; speedKph; lastFixAt; platformState; platformStatusFetchedAt; live: boolean }`
  - `mergeGpsPoints(devices: LiveDevice[], points: GpsPoint[]): LiveDevice[]` — จุดที่ใหม่กว่า `lastFixAt` เท่านั้นที่ย้ายหมุด · ไม่เปลี่ยน `platformState`
  - `useLivePositions(): { devices: LiveDevice[]; isPending; isError; refetch }` — query key `['tracking', 'positions']` · คิว `gps:batch` แล้ว flush ทุก 1000 ms · refetch snapshot เมื่อ socket reconnect · `refetchInterval` 60000 **เฉพาะตอน socket หลุด**
  - `LiveMapPage`: แผนที่ full-bleed + cluster + หมุด 3 สถานะ (หมุดที่ fix เก่ากว่า 120 วินาทีจาง) · panel รายการกล้อง (ค้นหา, filter สถานะ) · คลิก ⇒ `CameraCard` (รหัส / ชื่อ, `DeviceStateBadge`, อายุตำแหน่ง, พิกัด, เวลาอัปเดตสถานะจาก `platformStatusFetchedAt`, ลิงก์ ประวัติเส้นทาง `/tracking/history?deviceId=…`) · ปุ่ม ดูสด รอ P4 (ไม่แสดง)

- [ ] **Step 1: Port / เขียน test ที่ fail** — `mergeGpsPoints`: จุดเก่ากว่าไม่ย้ายหมุด · `useLivePositions`: 3 event ภายใน 1 วินาที ⇒ render ครั้งเดียว, หลุด ⇒ poll 60 วินาที, ต่อใหม่ ⇒ refetch · page: แสดงกล้องจาก snapshot, filter offline, คลิกรายการ ⇒ การ์ดพร้อมลิงก์ประวัติ · `/tracking` ไม่มี `tracking:view` ⇒ หน้า 403 · เมนู แผนที่ติดตาม มี `to`
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** client checks — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(client): live tracking map`

### Task 13: Client — หน้า ประวัติเส้นทาง `/tracking/history`

**Files:**
- Create: `client/src/features/tracking-history/historyRange.ts`, `historyTimeline.ts`, `history.api.ts`, `HistoryPage.tsx`, `components/RouteLayers.tsx`
- Modify: `client/src/app/router.tsx`, `client/src/app/nav.ts` (`to: '/tracking/history'`), i18n th/en
- Test: port `historyRange.test.ts`, `historyTimeline.test.ts`, `HistoryPage.test.tsx` (ตัด roadMatch), router / nav tests

**Interfaces:**
- Consumes: `GET /api/devices?pageSize=100` (picker), `GET /api/tracking/devices/:id/history`
- Produces: URL `?deviceId&from&to` · `dayWindowOf(date)`, `historySearch(...)`, `historyHref({ deviceId, startAt?, endAt? })` (ช่วงไม่เกิน 24 ชม.) · query key `['tracking', 'history', deviceId, from, to]` `staleTime: Infinity`, ไม่ refetch เอง (ทุกคำขอเขียน audit) · `RouteLayers` วาด segment (`route-line`), gap (`route-gap-line` เส้นประ), จุดเริ่ม / จบ, จุดจอดมีหมายเลข · timeline คลิกแล้วซูมไปจุดนั้น · แสดง `truncated` เป็น Alert

- [ ] **Step 1: Port / เขียน test ที่ fail** — ช่วงวัน / เลื่อนวัน / ห้ามวันอนาคต · timeline label · page: เลือกกล้อง + วัน ⇒ เรียก history ครั้งเดียว, 400 `INVALID_RANGE` แสดงข้อความ server, ไม่มีจุด ⇒ empty state · route / nav
- [ ] **Step 2: Run** — Expected: FAIL · **Step 3: Implement** · **Step 4: Run** client checks + `npm run build` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `feat(client): route history page`

### Task 14: ตรวจบนเครื่อง dev + เอกสาร

**Files:**
- Modify: `docs/blueprint/04-database-design.md` (retention DeviceStatusHistory 3 เดือน, Alerts ใน P1), `03-business-workflows.md` §3.11 (settings ใหม่ `tracking.stop-*` + bounds `status.unknown-after-seconds`), `05-api-design.md` (response shape `/tracking/*`, `/devices`, `INVALID_RANGE`), `06-frontend-architecture.md` (status→tone, env tile), `02-system-architecture.md` (env DSS, lock `partition:maintenance`, ไม่มี cap กล้อง), `09-risks-open-questions.md` §9.5 (DL ใหม่สำหรับการตัดสินใจ 1–10 ของแผนนี้), `08-implementation-roadmap.md` (simulator = `DSS_DRIVER=mock`), `docs/runbooks/local-dev.md` (หมวด DSS / VPN / simulator), `CLAUDE.md` (Current state)

- [ ] **Step 1: simulator** — `DSS_DRIVER=mock`, `WORKER_ROLES=tracking` รัน api + worker + client · login `operator1` ⇒ `/tracking` เห็น 100 กล้อง (cluster) หมุดเคลื่อนทุกรอบ poll โดยไม่ refresh หน้า · `GET /api/devices` 2 ครั้งติดกัน ⇒ log DSS mock ถูกเรียกครั้งเดียว · หยุด Redis ⇒ `/api/devices` ยังตอบ · หยุด worker 1 นาทีแล้วเปิด ⇒ `StateSince` ไม่เปลี่ยน (query DB) · `/tracking/history` ของกล้อง `SIM-0001` วันนี้ ⇒ เห็นวงกลมเส้นทาง
- [ ] **Step 2: ประสิทธิภาพประวัติ** — สร้างข้อมูล 10M แถวใน DB ทดสอบแยก (`generate_series` ใส่ `GpsLocations` 100 กล้อง × ~1 เดือน) แล้ววัด `GET /tracking/devices/:id/history` ช่วง 24 ชม. — Expected: < 2 วินาที · ลบ DB ทดสอบทิ้ง
- [ ] **Step 3: DSS จริงผ่าน VPN** (เมื่อผู้ใช้ใส่ `DSS_BASE_URL` / `DSS_API_KEY`) — `DSS_DRIVER=dss` ⇒ `Devices` เท่ากับจำนวนกล้องใน DSS · หน้าแผนที่เห็นกล้องที่มี fix · บันทึกเวลาต่อรอบ poll จริง (R3) · ถ้ายังไม่ได้ค่า ⇒ บันทึกว่าค้างไว้
- [ ] **Step 4:** แก้เอกสารตาม Files · `npm run ci` (server) + `npm test && npm run build` (client) — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ) `docs: P1 decisions, settings and local DSS setup`

---

## Done when

- Acceptance P1 (Part 8) ผ่านบน simulator ครบ: แผนที่อัปเดตผ่าน `gps:batch` ทุกรอบ · `GET /devices` ใช้ cache และ fail-open · กล้องใหม่เข้าใน 1 รอบ `DeviceSync` · กล้องหาย ⇒ `VendorMissingSince` + alert 13 ไม่ลบ · restart ไม่เปลี่ยน `StateSince` · pipeline GPS ผ่าน test ที่ port มา · ประวัติ 24 ชม. < 2 วินาทีที่ 10M แถว
- ทดสอบกับ DSS จริงผ่าน VPN แล้ว (หรือบันทึกว่าค้างเพราะยังไม่ได้ค่าเชื่อมต่อ)
- `npm run ci` (server) และ `npm test` / `typecheck` / `lint` / `build` (client) ผ่าน
