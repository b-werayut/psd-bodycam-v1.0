# Part 3 — Business Workflows

> ชื่อตาราง/enum ตาม [04-database-design.md](04-database-design.md) · ค่าตัวเลขในวงเล็บคือ default ของ Settings (ดู §3.11)
> กติกาในส่วนนี้ปรับตามคำตอบของผู้ใช้ 2026-11-04, DL33/DL35 (2026-11-09) และ DL46–DL49 (2026-11-12 — requirement ฉบับ 2026-11-12) (Part 9 §9.5) — **อาจเปลี่ยนตามข้อมูลจากทีม Booking**
> **DL33**: ใบงานมาจากข้อมูล Smart Booking เท่านั้น (1 ต่อ 1 กับ `BookingJobs`) · ระบบไม่สร้างใบงานเอง · ไม่มีใบรวม ไม่มีการผูก/void ด้วยมือ ไม่มีคิวตรวจสอบ
> **DL46**: Smart Booking **POST** ใบงานเข้ามาที่ `POST /api/integration/booking/jobs` (process `api` → `IntegrationInbox` → inbox processor ของ worker `integration`) แทนการ pull ทุก 2 นาทีของ DL31 · read API ของ Booking (refresh ต่องาน / reconcile ตอนกลางคืน) เป็น **optional** · **DL47**: แอปมือถือสำหรับหัวหน้าทีม (`TEAM_LEADER`, scope `team`) — ดู live กล้องของตัวเอง + รายละเอียดใบงาน

---

## 3.0 แยกความหมายของสถานะ (ห้ามปนกัน)

| คำ | ความหมาย | แหล่งข้อมูล | ใช้ตัดสินอะไร |
|---|---|---|---|
| **Device Online** | กล้องต่อ platform อยู่ (`DeviceState.PlatformState = 1` และข้อมูลไม่เก่าเกิน `status.unknown-after-seconds`) | GpsPoll: DSS `/location` (`status`) — DL32 | เปิด/ปิด session (ใช้ภายใน session engine) · หน้าจอไม่ได้รับ push สถานะ — ดึงสถานะจาก DSS ตอนเปิดหน้า (DL35) |
| **Device Unknown** | ไม่มี observation ใหม่นานเกินกำหนด (คำนวณ ไม่ได้เก็บ) | อายุของ `LastObservedAt` | **hold** — ไม่เปิดและไม่ปิด session จนกว่าจะเกิน `session.unknown-max-minutes` |
| **GPS Active** | มี fix ที่ valid อายุ ≤ 2 นาที | GpsPoll | แสดงตำแหน่ง · ตรวจว่าอยู่ฐาน (ถ้ามี fix) · ไม่ใช้เป็น trigger |
| **At Base** | fix ล่าสุดอยู่ในรัศมีฐาน/จุดชาร์จ (`Depots` — รองรับหลายจุด) | `DeviceState.LastLat/LastLng` · vendor **ไม่มี** charging state (Q21) | **ไม่นับเป็นงาน** — session จัดเป็น `IdleOrCharging` (Q15) |
| **Camera Active (เริ่มใช้งาน)** | Online ต่อเนื่อง ≥ `camera.activation-debounce-minutes` (**15**) และไม่ได้อยู่ฐาน | คำนวณจาก `StateSince` | **trigger เปิด Tracking Session ที่นับเป็นงาน** |
| **Recording Started** | มีไฟล์บันทึกในช่วงเวลานั้นจริง | DSS recording search (หลังเกิดเหตุเท่านั้น) → `RecordingSegments` | แสดงหลักฐาน · **ไม่ใช้เป็น trigger และไม่สมมติว่าเปิดกล้อง = อัด** |
| **Tracking Session** | ระเบียน `TrackingSessions` = ช่วงที่กล้อง 1 ตัวเปิดต่อเนื่องและสังกัด WO เดียวกัน (หรือยังไม่มี WO — `AwaitingMatch` / `NoTeam`) | Session engine | หน่วยของ "การใช้งานกล้อง" |
| **Booking Check-in / Check-out** | หัวหน้าทีม (หรือแอดมิน) กดเริ่ม/จบงาน **ในระบบ Booking** | ใบงานที่ Smart Booking POST เข้ามา (`checkInAt` / `checkOutAt`) — มีเวลา check-in/out **[Confirmed — DL46]** · POST ซ้ำทุกครั้งที่งานเปลี่ยน และรูปแบบ field **[Assumption]** | **กำหนดสถานะใบงาน** — check-out = ปิดใบงาน (ผู้ใช้ยืนยัน) |
| **Work Order** | ระเบียนธุรกิจใน `WorkOrders` (PK ของตัวเอง) — **1 ต่อ 1 กับ `BookingJobs`** สร้าง/อัปเดตโดย inbox processor เมื่อได้รับงานจาก Smart Booking เท่านั้น (DL33, DL46) | Smart Booking POST → `IntegrationInbox` → inbox processor | รวมหลาย session · **สถานะตาม Booking ไม่ใช่คนในระบบเรากดปิด** |

```mermaid
flowchart LR
  BS["Smart Booking POST งาน<br/>ผ่าน IntegrationInbox"] -->|"สร้างและอัปเดต 1 ต่อ 1"| E["Work Order ของงาน Booking"]
  A["Device Online"] -->|"ต่อเนื่อง ≥ 15 นาที"| B{"อยู่ในรัศมีฐาน?"}
  B -->|"ใช่"| Z["Session จัดเป็น IdleOrCharging<br/>ไม่นับเป็นงาน"]
  B -->|"ไม่"| C["Tracking Session"]
  C --> D["Matching"]
  D -->|"HIGH"| E
  D -->|"อื่น ๆ"| F["Session รอ Booking<br/>AwaitingMatch หรือ NoTeam<br/>ไม่สร้างใบงาน"]
  F -. "Booking เปลี่ยน ⇒ re-match" .-> D
  BK["Booking check-out"] -->|"ปิด"| E
  C -. "หลังเกิดเหตุ" .-> G["Recording Segments indexed"]
```

---

## 3.1 Bodycam Activation

```mermaid
sequenceDiagram
  autonumber
  participant CAM as Bodycam
  participant DSS as DSS middleware
  participant GP as GpsPoll
  participant DS as device-status
  participant DB as PostgreSQL

  CAM->>DSS: เปิดเครื่อง เชื่อมต่อ platform
  loop ทุก 15 วินาที (setting)
    GP->>DSS: POST /location ทีละเครื่อง (concurrency 8)
    DSS-->>GP: GPS + status
    GP->>DS: applyObservation ทีละเครื่อง
  end
  DS->>DB: UPDATE DeviceState SET LastObservedAt = now()
  alt สถานะเปลี่ยน OFFLINE เป็น ONLINE
    DS->>DB: PlatformState = 1, StateSince = now()
    DS->>DB: INSERT DeviceStatusHistory
  else สถานะเดิมซ้ำ เช่น poll รอบถัดไป หรือ worker restart
    Note over DS,DB: อัปเดตแค่ LastObservedAt ไม่แตะ StateSince
  end
  Note over DS: ไม่มี session logic ใน ingest path และไม่ push สถานะไปหน้าจอ (DL35)
```

กติกา:
- `applyObservation` เป็น `UPDATE` เดียว ใช้ `IS DISTINCT FROM` ตรวจ transition · เวลาใช้ DB `now()`
- **ไม่ล้างสถานะเป็น null** เมื่อ DSS หลุด/worker restart (ต่างจาก `clearPlatformStatuses()` ของ reference) — ความเก่าของข้อมูลถูกตีความเป็น UNKNOWN เอง
- GPS fix ที่สดถือเป็น ONLINE observation ด้วย (source = DssLocation) · fix ที่ valid ใช้คำนวณ `DeviceState.IsAtDepot`
- **แหล่งสถานะเดียวคือ GpsPoll** (DL32): `/location` ให้ทั้ง GPS และ online/offline ในรอบเดียว · ไม่มี StatusPoll / BRMS MQ / device webhook จึงไม่ต้องตัดสินลำดับระหว่าง source · observation ซ้ำแค่ bump `LastObservedAt`
- **ไม่มี event `device:status`** (DL35): `DeviceState` ใช้ภายใน session engine เท่านั้น · หน้าจอที่แสดงสถานะกล้อง (รายการ/รายละเอียดกล้อง/ก่อนเปิด live) ดึงสถานะจาก DSS ผ่าน API ตอนเปิดหน้า · ตำแหน่งบนแผนที่ยังมาทาง `gps:batch` ตามเดิม

---

## 3.2 Work Order Creation (จากงานที่ Smart Booking POST เข้ามาเท่านั้น — DL33, DL46) และการเปิด Session

ใบงานเกิดได้ทางเดียว: Smart Booking POST งานมาที่ `POST /api/integration/booking/jobs` → process `api` ตรวจ auth + validate แล้วเก็บ raw ลง `IntegrationInbox` (`Channel = 1 Push`) ตอบ `202` (ไม่ map และไม่แตะ `BookingJobs` / `WorkOrders`) → inbox processor (worker `integration`) map ด้วย `BookingInboundMapper` แล้ว upsert `BookingJobs` + `WorkOrders` **1 ต่อ 1** ใน transaction เดียว (DL46) · **session engine ไม่สร้างใบงาน** — แค่เปิด session แล้วให้ matcher attach เข้า WO ของงานที่ชนะ

```mermaid
sequenceDiagram
  autonumber
  participant BK as Smart Booking
  participant API as api inbound endpoint
  participant SY as inbox processor
  participant SW as SessionSweep
  participant M as Matcher
  participant DB as PostgreSQL
  participant RT as Realtime and Alerts

  Note over BK,SY: ทางเดียวที่สร้างใบงาน (DL33, DL46)
  BK->>API: POST /api/integration/booking/jobs เมื่อสร้างหรือเปลี่ยนงาน
  API->>API: ตรวจ auth และ validate DTO
  API->>DB: INSERT IntegrationInbox Channel = Push ON CONFLICT DO NOTHING
  API-->>BK: 202 accepted หรือ 200 duplicate
  API->>SY: queue booking-inbox หลัง commit
  SY->>DB: BEGIN และ upsert BookingJobs ด้วย version guard
  SY->>DB: upsert WorkOrders 1 ต่อ 1 ด้วย UQ_WO_BookingJob สถานะตาม Booking
  SY->>DB: COMMIT
  SY->>RT: workorder:changed หลัง commit
  SY->>M: queue matching ทีมและกล้องของงาน

  loop ทุก 30 วินาที ทุกอุปกรณ์ ORDER BY Id
    SW->>DB: BEGIN และ SELECT DeviceState FOR UPDATE
    SW->>DB: โหลด open session, assignment ณ now, WO ล่าสุด
    SW->>SW: decide(snapshot, now, settings)
    alt Online ครบ 15 นาที และไม่มี open session
      SW->>DB: INSERT TrackingSessions ON CONFLICT DO NOTHING
      Note right of SW: StartedAt = max(StateSince, EndedAt ของ session ก่อนหน้า)
      alt fix ล่าสุดอยู่ในรัศมีฐาน
        SW->>DB: MatchState = Classified, Classification = IdleOrCharging
      else ใช้งานนอกฐาน
        SW->>M: matchAt(session)
        M->>DB: อ่าน BookingJobs ที่ระบุกล้องตัวนี้ หรือทีมของกล้อง ณ StartedAt
        alt HIGH หรือ MEDIUM ได้งานเดียว
          M->>DB: lock WorkOrders ของงานนั้น แล้ว UPDATE session WorkOrderId, MatchState = Attached
          M->>DB: INSERT WorkOrderEvents SessionAttached
        else NONE หรือ AMBIGUOUS หรือ ProjectionStale
          M->>DB: MatchState = AwaitingMatch ไม่สร้าง WO
        else Booking ยังไม่ผูกกล้องนี้กับทีมหรืองานใด
          M->>DB: MatchState = NoTeam ไม่สร้าง WO และ alert CAMERA_ACTIVE_NO_TEAM
        end
        M->>DB: INSERT MatchAttempts เมื่อ InputHash เปลี่ยน
      end
      SW->>DB: COMMIT
      SW->>RT: session:opened และ workorder:changed ถ้า attach หลัง commit
    else ไม่มีอะไรเปลี่ยน
      SW->>DB: COMMIT
    end
  end
```

ข้อกำหนดที่ flow นี้ตอบ:
- **ไม่สร้าง WO ซ้ำ**: WO ต่อ Booking job ได้ใบเดียว (`UQ_WO_BookingJob`) — POST ซ้ำ (`ExternalEventId` เดิม ⇒ `UQ_Inbox_Event` ตอบ `200 duplicate`) / POST ใหม่ของงานเดิม = upsert ใบเดิม · session เปิดได้ตัวเดียวต่ออุปกรณ์ (`UQ_TS_OpenPerDevice` + `EX_TS_NoOverlap`) · sweep ซ้ำ/worker 2 ตัว/observation ซ้ำ → ผลเหมือนเดิม
- **เปิดกล้องแต่ไม่พบ Booking**: session ค้าง `AwaitingMatch` (หรือ `NoTeam`) — **ไม่สร้างใบงาน รอ Booking อย่างเดียว** แล้ว re-match อัตโนมัติเมื่อข้อมูล Booking เปลี่ยน (§3.3.4 · DL33 แทน DL10)
- **กล้องชาร์จที่ฐานไม่นับเป็นงาน [Confirmed — Q15]** · vendor ไม่ส่งสถานะชาร์จ **[Confirmed — Q21]** จึงตรวจตอนเปิด session: fix ล่าสุดที่ valid อายุ ≤ `depot.fix-max-age-minutes` (30) อยู่ในรัศมีของ `Depots` (หลายจุด — พิกัด mock ไว้ก่อน, Q22) ⇒ `Classified` + `IdleOrCharging` · กล้องในอาคารที่ไม่มี fix และไม่มีงาน Booking ⇒ ค้าง `AwaitingMatch` (ไม่มีใบงานให้ void แล้ว — DL33)
- **เลขใบงาน** `WO-YYYYMM-NNNNN` จาก `WorkOrderCounters` (atomic) ตอน inbox processor สร้าง WO
- **Title**: ชื่องานจาก Booking
- **DO / SH**: เลข DO และ SH ที่มากับใบงาน **[Confirmed — DL46]** เก็บใน `BookingJobs.DoNo` / `ShNo` ใช้**แสดงผลและค้นหาเท่านั้น ไม่ใช่ matching key** · ความหมาย (คาดว่า Delivery Order / Shipment) **[Assumption]**

---

## 3.3 Booking Work Order Matching

### 3.3.1 Algorithm (`matchAt(session)`) — pure function, versioned (`AlgoVersion`)

```mermaid
flowchart TB
  S["Session ของกล้อง D เริ่มที่ t"] --> DR{"มี BookingJob ในช่วงเวลา<br/>ที่ระบุกล้อง D ใน DeviceRefs?"}
  DR -->|"มี"| C
  DR -->|"ไม่มี"| T{"DeviceAssignments<br/>ของ D ณ t"}
  T -->|"ไม่มี"| NT["Result NoTeam<br/>ไม่สร้างใบงาน รอ Booking<br/>alert CAMERA_ACTIVE_NO_TEAM"]
  T -->|"มี team"| C["Candidates = BookingJobs ที่<br/>ระบุกล้อง D หรือ ref ทีม หรือ ref หัวหน้าทีม ณ t<br/>Status ใน Planned, Confirmed, InProgress, Unknown<br/>ช่วง session ซ้อนกับช่วงงาน ± 60 นาที<br/>และผ่าน Rule 1"]
  C --> N{"จำนวน candidate"}
  N -->|"0"| X{"projection สด?"}
  X -->|"ใช่"| EXT{"มีงานในช่วงขยาย ±3 ชม.?"}
  EXT -->|"มี 1"| MED["MEDIUM<br/>attach เข้า WO ของงานนั้น (DL37)"]
  EXT -->|"ไม่มี หรือ มากกว่า 1"| NONE["NONE"]
  X -->|"ไม่ inbox ค้างเกิน 15 นาที"| PEND["ProjectionStale<br/>รอ inbox processor ตามทัน"]
  N -->|"1 หรือมากกว่า"| TIER["จัด tier<br/>T1 อยู่ในช่วงงาน · T2 ก่อนเริ่ม · T3 หลังจบ"]
  TIER --> BEST{"tier ที่ดีที่สุดมีกี่งาน"}
  BEST -->|"1"| HI{"status map ได้<br/>ไม่ใช่ Unknown?"}
  HI -->|"ใช่"| HIGH["HIGH<br/>attach เข้า WO ของงานนั้น"]
  HI -->|"ไม่"| MED
  BEST -->|"มากกว่า 1"| TIEB["tie-break<br/>1 งานที่ระบุกล้อง D<br/>2 Booking check-in แล้วยังไม่ check-out<br/>3 งานที่มี session attach อยู่แล้ว"]
  TIEB -->|"ตัดสินได้"| HIGH
  TIEB -->|"ตัดสินไม่ได้"| AMB["AMBIGUOUS"]
  NONE --> AW["Session AwaitingMatch<br/>ไม่สร้างใบงาน<br/>re-match เมื่อ Booking เปลี่ยน"]
  PEND --> AW
  AMB --> AW
```

| ผล | การกระทำ | `TrackingSessions.MatchState` |
|---|---|---|
| HIGH (ผู้ชนะ 1 งาน) | attach session เข้า WO ของ Booking job นั้น (WO มีอยู่แล้วตั้งแต่ได้รับงาน) | 1 Attached |
| MEDIUM (งานเดียวในช่วงขยาย ±3 ชม. หรือสถานะ Booking map ไม่ได้) | attach อัตโนมัติเหมือน HIGH · บันทึก confidence MEDIUM ใน `MatchAttempts` (DL37) | 1 Attached |
| AMBIGUOUS | ไม่ attach · เก็บทุก candidate ใน `MatchAttempts` | 2 AwaitingMatch |
| NONE | ไม่ attach | 2 AwaitingMatch |
| ProjectionStale (แถว `IntegrationInbox` ที่ยัง `Pending` / `Failed` เก่าสุดอายุเกิน `booking.stale-after-minutes` — DL46) | ไม่ attach · re-match อัตโนมัติเมื่อ inbox processor ตามทัน | 2 AwaitingMatch |
| NoTeam | ไม่ attach · alert `CAMERA_ACTIVE_NO_TEAM` | 3 NoTeam |

**ไม่มีผลใดสร้างใบงาน** (DL33) · session ที่ยังไม่มี WO ดู §3.3.4

นิยามที่ใช้ในการ match:
- **ลำดับแหล่งที่บอกว่ากล้องไปงานไหน**:
  1. **`BookingJobs.DeviceRefs`** — Booking ระบุกล้องที่ใช้กับงาน (รวมกล้องสำรอง) **[Confirmed — Q4, Q20: การผูกกล้องมาจากฝั่ง Booking เท่านั้น · รูปแบบข้อมูลเป็น Assumption]** — match ด้วย `Devices.DeviceCode` / `VendorDeviceId` / `SerialNo` · ไม่ต้องมีทีมก็ match ได้
  2. **ทีม** จาก `DeviceAssignments` ณ `StartedAt` (**มาจาก Booking เท่านั้น** ถ้า Booking มีข้อมูลกล้องประจำทีม — ดึงผ่าน read API ที่เป็น optional **[Assumption]** · DL46) แล้วเทียบ `BookingJobs.BookingTeamRef` กับ `Teams.BookingTeamRef` หรือ `BookingJobs.BookingLeaderRef` กับ `Employees.BookingEmployeeRef` ของหัวหน้าทีม — ทั้งสองแบบ HIGH ได้
  - session ที่ไม่มีทั้งข้อ 1 และ 2 = `NoTeam` (ไม่สร้างใบงาน) และ re-match เมื่อ Booking ส่งข้อมูลมา · **ระบบเราไม่มีหน้าจอผูกกล้องกับทีมเอง**
- `BookingJobs.TeamId` / `LeaderEmployeeId` เป็น **cache สำหรับแสดงผล** · เมื่อแก้ ref ของทีม/พนักงาน/กล้อง ⇒ job `re-resolve` อัปเดต cache + enqueue re-match
- **ช่วงเวลางาน** = `[min(PlannedStartAt, BookingCheckInAt), BookingCheckOutAt ?? (check-in แล้ว ⇒ ไม่มีขอบบน) ?? PlannedEndAt]` · candidate = ช่วง session `[StartedAt, EndedAt หรือ now]` **ซ้อน** กับช่วงงาน ± `matching.window-before/after-minutes` (60) · tier คิดจาก `StartedAt` · งานที่ไม่มีเวลาใช้ทั้งวัน `ScheduledDate` (Asia/Bangkok) และ confidence สูงสุด MEDIUM (จึงยังไม่ attach จนกว่า Booking จะมีเวลา check-in หรือเวลาตามแผน)
- **งานที่ check-in แล้วแต่ยังไม่ check-out = ยังเป็นใบเดิม** — กล้องแบตหมด เอาไปชาร์จแล้วเปิดใหม่หลายชั่วโมง session ใหม่ก็ยังเข้า WO เดิม **[Confirmed — Q3]**
- ระยะห่าง GPS กับ `BookingJobs.SiteLat/SiteLng` เป็นแค่ข้อมูลประกอบใน candidate list (กล้องส่วนใหญ่ไม่มี fix)
- **Rule 1 (กัน loop)**: session ที่เริ่ม**ตั้งแต่** `BookingCheckOutAt` ของงานไปแล้ว ไม่ match งานนั้น จนกว่า Booking จะ **check-in ใหม่** (ระบบ reopen ให้) — กัน successor ที่ถูก split ตอน check-out วนกลับเข้าใบเดิม · session ที่เริ่มก่อน check-out ยัง attach ย้อนหลังได้ (เช่น POST มาช้า — WO ที่ Closed รับ session ได้โดยสถานะไม่เปลี่ยน) · Cancelled ไม่เป็น candidate อีก · WO ที่ปิดเพราะ `SafetyTimeout` ยังเป็น candidate (session ใหม่ได้ HIGH ⇒ reopen + `NeedsReview`)
- `MatchAttempts` เขียนเฉพาะเมื่อ `InputHash` เปลี่ยน · `Candidates` เก็บทุก candidate พร้อม tier และเหตุผล — ใช้อธิบายย้อนหลังว่าทำไม attach หรือไม่ attach

### 3.3.2 ไม่มีการผูกด้วยมือ (DL33)

ไม่มี link / unlink / merge / void ใบงาน และไม่มีการ attach หรือจัดประเภท session ด้วยมือ — การจับคู่เป็นอัตโนมัติจากข้อมูล Booking อย่างเดียว · ถ้าผลไม่ถูก ต้องแก้ข้อมูลฝั่ง Booking (เช่น `DeviceRefs` / ทีม) แล้วระบบ re-match เอง (§3.3.3)

### 3.3.3 Re-matching

| Trigger | ขอบเขต | กติกา |
|---|---|---|
| inbox processor ประมวลผล POST จาก Smart Booking แล้ว Booking job ใหม่/เปลี่ยน (`PayloadHash` เปลี่ยน รวม check-in/check-out/DeviceRefs — DL46) | session ของทีมและกล้องที่เกี่ยวข้อง ±`booking.rematch-horizon-hours` (72) | queue `matching` ด้วย `jobId = team:{id}:{window}` (dedupe) |
| inbox processor ตามทัน backlog หลัง stale (หรือ reconcile ตอนกลางคืนเสร็จ — เฉพาะเมื่อมี read API) | session `AwaitingMatch` / `NoTeam` ภายใน horizon (รวมที่ผลล่าสุดเป็น ProjectionStale) | re-run ทั้งหมด |
| แก้ assignment / ref ย้อนหลัง | session ในช่วงที่แก้ | job `re-resolve` แล้ว re-run |
| Sweep | **session ที่ยังเปิด** ซึ่ง `AwaitingMatch` หรือ `NoTeam` | re-run ทุกรอบ (local, ถูก) |

- **session ที่เข้าข่าย**: `AwaitingMatch` / `NoTeam` ที่เริ่มภายใน horizon — ทั้งที่ยังเปิดและปิดแล้ว (attach ย้อนหลังได้)
- **ใครเขียนอะไร**: queue `matching` จัดการ session ที่ปิดแล้ว · **session ที่ยังเปิด** ให้ `SessionSweep` (writer เดียวของ lifecycle session) · ทั้งสองฝั่งใช้ **lock order เดียวทั้งระบบ**: `DeviceState` (DeviceId น้อยไปมาก) → `WorkOrders` (Id น้อยไปมาก) → `TrackingSessions` · retry สูงสุด 3 ครั้งเมื่อ deadlock
- session ที่ attach แล้วย้ายไป WO ของงานอื่นได้เฉพาะเมื่อ WO เดิมยัง Open และผลใหม่เป็น HIGH ของงานอื่น — นอกนั้นคงไว้ + `NeedsReview`

### 3.3.4 Session ที่ยังไม่มีใบงาน (แทน "ใบรวม" เดิม — DL33)

| คำถาม | กติกา |
|---|---|
| เกิดเมื่อไร | ผล AMBIGUOUS / NONE / ProjectionStale ⇒ `AwaitingMatch` · ไม่รู้ทีมและ Booking ไม่ระบุกล้อง ⇒ `NoTeam` |
| สร้างใบงานไหม | **ไม่** — ไม่มีใบรวม ไม่มีการปิดที่ 240 นาที · รอ Booking อย่างเดียว |
| attach เมื่อไร | re-match อัตโนมัติได้ HIGH เมื่อ Smart Booking POST ข้อมูลที่เปลี่ยนเข้ามา (§3.3.3) ภายใน `booking.rematch-horizon-hours` · พ้น horizon แล้วคงเป็น session ที่ไม่มีใบงาน |
| ดูหลักฐานที่ไหน | หน้าค้นหาวิดีโอรายกล้อง `/recordings` (ไม่ใช่รายการใบงาน) · มี recording ⇒ alert `RECORDING_OUTSIDE_WORK` |
| session ต่อเนื่องหลัง WO ถูก check-out ขณะกล้องยังเปิด | `AwaitingMatch` · attach **เฉพาะเมื่อได้ HIGH** ของงานอื่น (เช่นงานถัดไป) — ไม่กลับเข้างานเดิม (Rule 1) |

---

## 3.4 Tracking Session Lifecycle

### 3.4.1 State diagram

```mermaid
stateDiagram-v2
  [*] --> Open : Online ต่อเนื่องครบ 15 นาที
  Open --> Open : offline สั้นกว่า merge gap หรือ unknown สั้นกว่า unknown max
  Open --> Closed : offline ครบ merge gap
  Open --> Closed : unknown ครบ unknown max
  Open --> Split : WO ถูก check-out หรือ cancel
  Open --> Split : เปลี่ยนงานอัตโนมัติ A ไป B
  Open --> Split : ครบ max segment 12 ชม.
  Open --> Split : อุปกรณ์ถูกย้ายทีม
  Open --> Split : เข้า หรือ ออกจากรัศมีฐาน
  Split --> Open : เปิด session ถัดไปทันที ที่เวลาเดียวกัน
  Closed --> [*]
```

| เหตุการณ์ | EndedAt | EndReason | session ถัดไป |
|---|---|---|---|
| Offline ≥ merge gap (15) | `StateSince` ของ offline | DeviceOffline | — (ถ้ากล้องเปิดใหม่ภายหลังและงานยังไม่ check-out ⇒ session ใหม่เข้า WO เดิม) |
| Unknown ≥ 30 นาที | `LastOnlineObservedAt` | StatusUnknown | — |
| Booking check-out / cancel ขณะกล้องเปิด | `BookingCheckOutAt` / เวลาที่ cancel | WorkOrderClosed | เปิดทันที · `AwaitingMatch` · ไม่กลับเข้างานเดิมจนกว่าจะ check-in ใหม่ (Rule 1) |
| สลับงานอัตโนมัติ A→B (A ยังไม่ check-out) | `max(A.PlannedEndAt, B.BookingCheckInAt ?? B.PlannedStartAt)` | JobSwitched | attach B · WO A `NeedsReview` (AutoSwitched) **[Confirmed — Q5]** |
| ครบ `session.max-segment-hours` (12) | เวลาครบ cap | MaxSegment | WO เดิม · `StartInferred = SplitBoundary` |
| ย้ายทีม | เวลาที่ assignment เปลี่ยน | DeviceReassigned | match ใหม่ |
| เข้าฐาน (หรือออกจากฐาน) | เวลาที่ตรวจพบ | AtBaseChanged | ฝั่งฐาน = Classified IdleOrCharging · ฝั่งนอกฐาน = match ปกติ |

> max segment 12 ชม. ผูกกับข้อจำกัด playback ≤ 24 ชม. ของ DSS — **ไม่เป็น setting ที่ตั้งเกิน 24 ได้**
> session ถัดไปเริ่ม **ที่เวลาจบของตัวก่อนหน้าพอดี** — กัน bug "เกิดใหม่พร้อมเวลาเกิน cap" ของ reference

### 3.4.2 แบตหมด / พัก / กล้องสำรอง

```mermaid
sequenceDiagram
  autonumber
  participant C1 as กล้องหลัก
  participant C2 as กล้องสำรอง
  participant BK as Smart Booking ผ่าน POST และ inbox
  participant SW as SessionSweep
  participant WO as WorkOrder A

  BK->>SW: งาน A check-in 08:00 กล้อง C1
  C1->>SW: online 07:50 นับเป็นงานที่ 08:05
  SW->>WO: session S1 attach WO A
  C1->>SW: offline 10:00 แบตหมด
  SW->>SW: S1 ปิดที่ 10:00 เมื่อ offline ครบ 15 นาที
  alt ชาร์จแล้วเปิดกล้องเดิมตอน 13:00
    C1->>SW: online 13:00
    SW->>WO: session S2 งาน A ยังไม่ check-out จึงเข้า WO A
  else เปลี่ยนเป็นกล้องสำรอง
    BK->>SW: งาน A ระบุกล้อง C2 เพิ่มใน DeviceRefs
    C2->>SW: online 10:20
    SW->>WO: session S2 ของ C2 match งาน A HIGH attach WO A
  end
  BK->>SW: check-out 16:00
  SW->>WO: WO A Closed ตาม Booking
```

- กล้องสำรองต้อง **ระบุจากฝั่ง Booking เท่านั้น** (`DeviceRefs` ในใบงาน) **[Confirmed — Q4, Q20]** — ระบบเราไม่มีการผูกกล้องเอง
- ถ้า Booking ยังไม่ระบุ: session ของกล้องสำรอง = `NoTeam` (ไม่สร้างใบงาน) + alert `CAMERA_ACTIVE_NO_TEAM` · เมื่อ Booking เพิ่มกล้องในใบงาน ⇒ re-match HIGH attach เข้า WO ของงานอัตโนมัติ · ไม่มีการ attach ด้วยมือ (DL33)

### 3.4.3 Decision table ของ `decide()` (ต่ออุปกรณ์ ต่อรอบ)

| # | เงื่อนไข | การกระทำ |
|---|---|---|
| 1 | อุปกรณ์ Retired / Inactive | ปิด open session (ถ้ามี) · ไม่เปิดใหม่ |
| 2 | ไม่มี open session · effective = ONLINE · `now − StateSince ≥ debounce (15)` | เปิด session `StartedAt = max(StateSince, lastSession.EndedAt)` · อยู่ในรัศมีฐาน ⇒ Classified IdleOrCharging · ไม่งั้น match (§3.3 — HIGH ⇒ attach · อื่น ๆ ⇒ `AwaitingMatch` / `NoTeam`) |
| 3 | ไม่มี open session · อื่น ๆ | ไม่ทำอะไร |
| 4 | มี open session · effective = OFFLINE · `now − StateSince ≥ merge gap` | ปิด `EndedAt = StateSince` |
| 5 | มี open session · effective = UNKNOWN · `now − LastObservedAt ≥ unknown max` | ปิด `EndedAt = LastOnlineObservedAt` |
| 6 | มี open session · WO ของ session ไม่ Open แล้ว (check-out / cancel) | split ที่เวลานั้น · successor `AwaitingMatch` |
| 7 | มี open session · `now − StartedAt ≥ max segment` | split · successor WO เดิม |
| 8 | มี open session · assignment ณ now ≠ `session.TeamId` | split · successor match ใหม่ |
| 9 | มี open session · สถานะอยู่ในรัศมีฐานเปลี่ยน | split (`AtBaseChanged`) |
| 10 | มี open session `AwaitingMatch` / `NoTeam` · match ได้ HIGH | ถ้า session เริ่มก่อนช่วงงาน − window-before: split ที่จุดนั้น (`StartInferred = PlannedBoundary`) แล้ว attach successor · ไม่งั้น attach ทั้ง session |
| 11 | มี open session ใน WO A (ยังไม่ check-out) · `now ≥ A.PlannedEndAt` และงาน B ของทีม/กล้องเดียวกันเป็น HIGH · `matching.auto-switch-enabled` | split ที่ `max(A.PlannedEndAt, B.BookingCheckInAt ?? B.PlannedStartAt)` |
| 12 | อื่น ๆ | hold |

pass ระดับ WO ใน sweep เดียวกัน:

| เงื่อนไข WO (Open) | การกระทำ |
|---|---|
| Booking check-out แล้ว | Closed (`BookingCheckout`) เวลา = `BookingCheckOutAt` — **ทางปิดหลัก** **[Confirmed — Q1, Q2]** |
| ยังไม่ check-out · `now − OpenedAt ≥ workorder.stale-open-hours` (**36**) | **ไม่ปิด** · `NeedsReview` + alert `WORK_ORDER_NO_CHECKOUT` **[Confirmed — Q23]** |
| ยังไม่ check-out · `now − OpenedAt ≥ workorder.force-close-after-hours` (168 = 7 วัน) | Closed (`SafetyTimeout`) + `NeedsReview` — กันใบงานค้างตลอดไป **[Confirmed — Q23]** |

> `OpenedAt` = เวลา check-in ใน Booking · ใบ `Planned` (ยังไม่ check-in) ไม่เข้า pass นี้ (DL37) · ใบ Planned ปิดเมื่อ Booking ส่ง Completed / Cancelled มาเท่านั้น (ถาม Booking — Part 9 §9.4)
> `NeedsReview` เป็นแค่ badge ข้อมูลบนหน้าใบงาน + alert ถึง Admin — **ไม่มีคิวตรวจสอบ ไม่มีปุ่ม clear ไม่มี SLA** (DL33)

---

## 3.5 สถานะใบงานตาม Booking Check-in / Check-out

```mermaid
sequenceDiagram
  autonumber
  participant L as หัวหน้าทีม ใน Booking app
  participant BK as Smart Booking
  participant API as api inbound endpoint
  participant SY as inbox processor
  participant DB as PostgreSQL
  participant SW as SessionSweep
  participant RT as Realtime

  L->>BK: check-in งาน A
  BK->>API: POST งาน A ทั้งใบ checkInAt มีค่า
  Note over BK,API: Assumption ว่า Smart Booking POST ซ้ำทุกครั้งที่งานเปลี่ยน
  API->>DB: INSERT IntegrationInbox แล้วตอบ 202
  API->>SY: queue booking-inbox หลัง commit
  SY->>DB: BookingJobs A BookingCheckInAt, Status InProgress
  Note over SY,DB: WO A มีอยู่แล้วตั้งแต่ได้รับ POST แรกของงาน A
  SY->>DB: WO A Planned เป็น Open, OpenedAt = BookingCheckInAt
  SY->>DB: queue rematch ทีมและกล้องของงาน A
  Note over SW,DB: session AwaitingMatch ของทีมหรือกล้อง จับคู่ HIGH เข้า WO A
  L->>BK: check-out งาน A
  BK->>API: POST งาน A ทั้งใบ checkOutAt มีค่า
  API->>SY: ผ่าน IntegrationInbox และ queue booking-inbox
  SY->>DB: BookingJobs A BookingCheckOutAt
  SY->>DB: WO A Status = Closed, CloseReason = BookingCheckout, ClosedAt = BookingCheckOutAt
  SY->>RT: workorder:changed หลัง commit
  Note over SW: รอบถัดไป ไม่เกิน 30 วินาที
  SW->>DB: session ที่ยังเปิดของ WO A split ที่ BookingCheckOutAt
  SW->>DB: successor AwaitingMatch ไม่กลับเข้างาน A จนกว่าจะ check-in ใหม่
  opt Booking check-in งาน A อีกครั้ง
    BK->>API: POST งาน A check-in ใหม่
    SY->>DB: WO A Closed เป็น Open, Source = Booking
  end
```

- **สถานะใบงานตาม check-in/check-out ได้ก็ต่อเมื่อ Smart Booking POST ทุกครั้งที่งานเปลี่ยน** (check-in, check-out, cancel, แก้ไข) **[Assumption — DL46]** · ถ้า Booking POST เฉพาะตอนสร้างงาน ระบบจะไม่รู้ check-in/check-out (เว้นแต่มี read API ให้ refresh / reconcile) ⇒ ข้อแรกที่ต้องถาม Booking (§3.10)
- **ในระบบเราไม่มีปุ่มปิดใบงาน** — สถานะใบงานตาม check-in/check-out ของ Booking เท่านั้น **[Confirmed — Q2]** · หัวหน้าทีม/แอดมินทำ check-out ฝั่ง Booking (สอดคล้องกับคำตอบเดิมว่า "ปิดได้ทั้งหัวหน้าทีมและแอดมินระบบ" — DL13)
- **Reopen = เปลี่ยนสถานะจาก Closed กลับเป็น Open** ไม่ใช่การเปิดดู · **การเปิดดูใบงานและหลักฐานทำได้ตลอด** ตราบที่ข้อมูลยังอยู่ใน retention (3 เดือน) **[Confirmed — Q9]** · ระบบ reopen เองเฉพาะเมื่อ Booking check-in ใหม่ หรือใบที่ปิดด้วย SafetyTimeout มี session HIGH ใหม่ · ไม่มีปุ่ม reopen ให้คน
- **ไม่มี Void / Merge** (DL33) — ใบงานทุกใบมาจาก Booking · งานที่ไม่ใช่งานจริงให้ยกเลิกฝั่ง Booking ⇒ `Cancelled` (หลักฐานยังเปิดดูได้)
- **Session engine เป็น writer เดียวของ lifecycle session** — inbox processor เปลี่ยนแค่ WO แล้ว sweep ทำ split ให้ (เวลาจบ = `BookingCheckOutAt` ⇒ deterministic)

---

## 3.6 Booking Inbound Failure / Recovery (DL46)

ข้อมูลใบงานเข้ามาทาง push อย่างเดียวโดยปกติ จึงมี 3 กรณีที่ข้อมูลขาด: (ก) ระบบเรารับ POST ไม่ได้ · (ข) Smart Booking หยุดส่ง · (ค) inbox processor ค้าง

```mermaid
sequenceDiagram
  autonumber
  participant BK as Smart Booking
  participant API as api inbound endpoint
  participant DB as PostgreSQL
  participant SY as inbox processor
  participant M as Matcher
  participant AS as AlertSweep
  participant ADM as Admin UI

  Note over BK,DB: ก. ระบบเราล่ม api หรือ DB ไม่พร้อม
  BK->>API: POST /api/integration/booking/jobs
  API--xBK: 503 SERVICE_UNAVAILABLE หรือ timeout
  BK->>BK: retry แบบ exponential backoff อย่างน้อย 24 ชม. เป็น Assumption
  BK->>API: POST ซ้ำเมื่อระบบกลับมา
  API->>DB: INSERT IntegrationInbox ON CONFLICT DO NOTHING
  API-->>BK: 202 accepted หรือ 200 duplicate

  Note over BK,ADM: ข. Smart Booking หยุดส่ง ไม่มี POST เข้ามา
  AS->>DB: อ่าน IntegrationSyncState.LastReceivedAt
  AS->>ADM: เงียบเกิน 24 ชม. alert BOOKING_INBOUND_SILENT
  opt มี read API ของ Booking และ driver ไม่ใช่ none
    SY->>BK: reconcile ตอนกลางคืน 02:00 fetchWindow -7 วัน ถึง +14 วัน
    SY->>DB: INSERT IntegrationInbox Channel = Reconcile แล้ว upsert ด้วย version guard
  end

  Note over DB,AS: ค. inbox processor ค้าง หรือ backlog สะสม
  AS->>DB: อายุแถว Pending หรือ Failed ที่เก่าที่สุดใน IntegrationInbox
  M->>DB: match ไม่เจอ และ backlog เก่าเกิน 15 นาที บันทึก ProjectionStale session ค้าง AwaitingMatch
  AS->>ADM: banner ข้อมูล Booking ไม่เป็นปัจจุบัน และ alert BOOKING_SYNC_STALE
  SY->>DB: retry sweep แถว Pending ที่เก่ากว่า 1 นาที และแถว Failed
  SY->>DB: upsert BookingJobs และ WorkOrders ด้วย version guard รวม check-in และ check-out ที่ตกค้าง
  SY->>M: queue rematch สำหรับ session AwaitingMatch และ NoTeam ภายใน horizon
  M->>DB: attach ย้อนหลังที่ได้ HIGH
  AS->>ADM: banner หาย และ alert resolved
```

- **ปัญหาฝั่ง Booking ไม่กระทบ tracking**: real-time path และ session engine ไม่เรียก Booking · endpoint รับ POST อยู่ใน `api` และแค่เก็บลง inbox จึงไม่ขึ้นกับความเร็วของ processor
- **(ก) ระบบเราล่ม** (api / DB ไม่พร้อม): ตอบ `503 SERVICE_UNAVAILABLE` หรือ timeout ⇒ Smart Booking ต้อง retry แบบ exponential backoff อย่างน้อย 24 ชม. และรักษาลำดับต่องานพอสมควร **[Assumption — ต้องตกลงกับ Booking]** · เรา insert inbox ก่อนตอบเสมอ ⇒ ตอบ `202` แล้วข้อมูลไม่หาย · enqueue Redis ล้มหลัง insert ยังตอบ `202` — retry sweep เก็บแถว `Pending` ที่เก่ากว่า 1 นาที · POST ซ้ำ = `200 duplicate` · ลำดับผิดกันด้วย version guard (`version` / `updatedAt`)
- **(ข) Smart Booking หยุดส่ง**: เราไม่รู้ว่ามีงานที่ขาด ⇒ `AlertSweep` ตรวจ `IntegrationSyncState.LastReceivedAt` เงียบเกิน `booking.inbound-silence-alert-hours` (24) ⇒ alert 17 `BOOKING_INBOUND_SILENT` (Warning ถึง Admin) · ถ้ามี read API (`BOOKING_PROVIDER_DRIVER` ≠ `none`) reconcile ตอนกลางคืน 02:00 (`fetchWindow`) เก็บ POST ที่หาย ⇒ inbox `Channel = 2 Reconcile` · ไม่มี read API ⇒ กู้ได้เมื่อ Booking ส่งซ้ำ (manual resend ถ้ามี **[Assumption]**) หรือ admin import CSV (`Channel = 3 CsvImport`)
- **(ค) inbox processor ค้าง**: แถว `Pending` / `Failed` ที่เก่าที่สุดอายุเกิน `booking.stale-after-minutes` (15) ⇒ matching ได้ `ProjectionStale` + banner + alert 10 `BOOKING_SYNC_STALE` (เกิน 60 นาที = Critical) · processor ตามทัน ⇒ re-match (§3.3.3)
- ระหว่างข้อมูลขาด **ใบงานจะไม่ถูกปิด** (ไม่รู้ check-out) — ปิดย้อนหลังด้วยเวลา `BookingCheckOutAt` จริงเมื่อได้ข้อมูล
- งานที่สร้างใน Booking ระหว่างข้อมูลขาดยังไม่มี WO จนกว่าจะได้รับ POST (หรือ reconcile) — session ช่วงนั้นค้าง `AwaitingMatch` แล้ว attach ย้อนหลังเมื่อได้ข้อมูล (Rule 1 ยอมให้ session ที่เริ่มก่อน check-out เข้า WO ที่ Closed ได้)
- แถว inbox ที่ process ไม่ผ่านครบจำนวน retry (Part 7 §7.7) ⇒ `Dead` + alert `INTEGRATION_DEAD_LETTER` แสดงในหน้า Integration ให้ admin กด retry
- Circuit breaker / retry ของ outbound ใช้เฉพาะ read API ที่เป็น optional (refresh ต่องาน / reconcile) — ดู Part 7

---

## 3.7 เหตุการณ์จาก Booking

ทุกแถวสมมติว่า Smart Booking POST ทั้งใบทุกครั้งที่งานเปลี่ยน **[Assumption — DL46]** · `eventType` (`job.created` / `job.updated` / `job.checked-in` / `job.checked-out` / `job.cancelled`) เป็นข้อมูลประกอบเท่านั้น — processor upsert ตาม snapshot ทั้งใบเสมอ

| เหตุการณ์จาก Booking | POST แรกของงาน (ยังไม่มี WO) | WO Open | WO Closed แล้ว |
|---|---|---|---|
| งานใหม่ (ยังไม่ check-in) | **สร้าง WO** สถานะ `Planned` (รอเริ่ม — DL37) 1 ต่อ 1 · re-match session ที่เกี่ยวข้อง | — | — |
| Check-in | **สร้าง WO** สถานะ Open 1 ต่อ 1 (มีใบ `Planned` อยู่แล้ว ⇒ เปลี่ยนเป็น Open) · re-match session ที่เกี่ยวข้อง | อัปเดตข้อมูลแสดงผล · re-match | **reopen** (Source Booking) |
| Check-out / Completed | สร้าง WO สถานะ Closed (`BookingCheckout`) — session ย้อนหลังที่ match ภายหลังเข้าใบนี้ได้ (Rule 1) | **Closed (`BookingCheckout`)** · split open session | อัปเดตเวลา check-out ถ้าเปลี่ยน |
| Cancelled | สร้าง WO สถานะ `Cancelled` (ไม่เป็น candidate) | WO → `Cancelled` · split open session · `NeedsReview` ถ้ามี recording (alert `WORK_ORDER_CANCELLED_WITH_EVIDENCE`) — **ฝั่ง bodycam ตรวจสอบหลักฐานได้** **[Confirmed — Q6]** | `NeedsReview` |
| เปลี่ยนทีม / เวลา / DeviceRefs | — (ถือเป็นงานใหม่) | re-match (§3.3.3) · `WorkOrders.TeamId` / `DepartmentId` อัปเดตตาม Booking (แผนกมาจาก Booking — DL38) | `NeedsReview` (alert `BOOKING_JOB_CHANGED_AFTER_CLOSE`) |
| หายจาก reconcile ตอนกลางคืน (เฉพาะเมื่อมี read API — DL46) | — | `SourceMissingSince` + `NeedsReview` | `SourceMissingSince` + `NeedsReview` |

`NeedsReview` = badge ข้อมูลบนหน้าใบงาน + alert ถึง Admin เท่านั้น (ไม่มีคิวตรวจสอบ — DL33)

---

## 3.8 State Diagrams ของ Work Order

### Status

```mermaid
stateDiagram-v2
  [*] --> Planned : POST แรกเป็นงานที่ยังไม่ check-in
  [*] --> Open : POST แรกมี check-in แล้ว
  Planned --> Open : Booking check-in
  Planned --> Closed : Booking Completed โดยไม่มี check-in
  Planned --> Cancelled : Booking cancelled
  [*] --> Closed : POST แรกมี check-out แล้ว
  [*] --> Cancelled : POST แรกเป็นงานที่ยกเลิกแล้ว
  Open --> Closed : Booking check-out
  Open --> Closed : safety timeout 7 วัน
  Open --> Cancelled : Booking cancelled
  Closed --> Open : Booking check-in อีกครั้ง หรือ session ใหม่ได้ HIGH หลัง SafetyTimeout
  Closed --> [*]
  Cancelled --> [*]
```

- สถานะมี Planned (รอเริ่ม) / Open / Closed / Cancelled และตาม Booking เท่านั้น (DL33, DL37) · session attach เข้าใบ Planned ได้ (เปิดกล้องก่อน check-in) แต่สถานะไม่เปลี่ยนจนกว่า Booking check-in · ค่า 4 Voided / 5 Merged สงวนไว้ (เลิกใช้ DL33 — ห้ามใช้เลขซ้ำ)
- **ไม่มี LinkStatus** (DL33) — ใบงานทุกใบผูก Booking 1 ต่อ 1 ตั้งแต่สร้าง · สถานะการจับคู่อยู่ที่ session (`TrackingSessions.MatchState`)

---

## 3.9 Mobile: หัวหน้าทีม — ดู live กล้องของตัวเอง และรายละเอียดใบงาน

ผู้ใช้แอปคือ **หัวหน้าทีมภาคสนาม** (role `TEAM_LEADER`, scope `team`) ตาม requirement ฉบับ 2026-11-12 §4 (**DL47** — แทน DL4 / DL16 เดิมที่ให้แอปเป็นของ Operator/Admin/Viewer) · แอปทำ 2 อย่างเท่านั้น: **Live กล้องของตัวเอง** และ **รายละเอียดใบงานจาก Smart Booking** · check-in/check-out ยังทำใน Booking app เหมือนเดิม

```mermaid
sequenceDiagram
  autonumber
  participant BK as Smart Booking
  participant SYS as ระบบเรา api และ worker
  participant FCM as FCM
  participant APP as Mobile app ของหัวหน้าทีม
  participant DSS as DSS middleware

  BK->>SYS: POST งานใหม่ของทีม T ผ่าน inbox และ processor
  SYS->>FCM: push ใบงานใหม่ของทีม พร้อม deep link ไปหน้ารายละเอียดใบงาน
  FCM-->>APP: แจ้งเตือน
  APP->>SYS: login แล้ว GET /mobile/me
  SYS-->>APP: user, employee, team และกล้องของฉัน
  APP->>SYS: GET /mobile/jobs?status=planned
  SYS-->>APP: งานของฉัน เฉพาะ scope team
  APP->>SYS: GET /mobile/jobs/:workOrderId
  SYS-->>APP: เลขใบงาน DO SH เวลาแผน check-in check-out สถานที่ กล้อง และ availableActions
  APP->>SYS: POST /streams/live กล้องของฉัน
  SYS->>DSS: ขอ live HLS
  SYS-->>APP: HLS URL ผ่าน proxy
```

User flow (DL47):
1. **Login** → หน้า **งานของฉัน** แบ่ง tab รอเริ่ม / กำลังทำ / ล่าสุด (`planned` / `open` / `recent` — recent = Closed / Cancelled ไม่เกิน 7 วัน) + ทางลัด **กล้องของฉัน** บนหน้าแรก
2. แตะใบงาน → **รายละเอียดใบงาน**: เลขใบงาน, เลขงาน Booking, DO, SH, เวลาตามแผน, check-in / check-out, สถานที่, กล้องของงาน, ช่วง session (เริ่ม/จบ) · อ่านอย่างเดียว
3. แตะกล้อง → **Live กล้องของฉัน** (player เต็มจอ ผ่าน `POST /streams/live` ใน scope `team`) · ปุ่ม live แสดงตาม `availableActions`

กติกา:
- **Scope `team`**: ทีม = ทีมที่พนักงานของฉัน (`Employees.UserId = me`) เป็นหัวหน้า active (`TeamMembers.Role = 1`) · ใบงาน = `BookingJobs.TeamId` = ทีมของฉัน หรือ `BookingJobs.LeaderEmployeeId` = ฉัน · กล้อง = `DeviceAssignments` active ของทีม + กล้องใน `DeviceRefs` ของใบงาน `Planned` / `Open` ของฉัน · นอก scope = 404 · ไม่มีทีม / ไม่ใช่หัวหน้า ⇒ รายการว่าง (ไม่ error) · เปลี่ยนหัวหน้ามีผลทันที (DL22)
- **Push (FCM)** ถึงหัวหน้าทีมเฉพาะ "ใบงานใหม่ของทีม" เมื่อ WO ของทีมถูกสร้าง (deep link `bodycam://jobs/{workOrderId}`) · ใบงานที่ ref ทีม/หัวหน้ายัง map ไม่ได้จะไม่มี push · **alert ไม่ push ไปมือถือแล้ว** (ผู้ใช้ web เห็นที่กระดิ่งบน web)
- Realtime: `TEAM_LEADER` เข้า room `team:{id}` รับ `workorder:changed` ของทีม · ไม่มี `gps:batch`
- **ไม่มีในแอป (web เท่านั้น)**: playback / หลักฐาน, GPS / แผนที่, สถานะกล้อง (monitoring), live wall, talk, alerts, user management (requirement §4.3 · DL48) · `TEAM_LEADER` เข้า web ⇒ หน้า "ใช้งานผ่านแอปมือถือ" ไม่มีเมนู
- ไม่มีคิวตรวจสอบ / link / จัดประเภท session (DL33)
- Login: Entra SSO ถ้าหัวหน้าทีมมีบัญชี Entra ไม่งั้น username/password แบบ reference (lockout + refresh rotation) — รองรับทั้งคู่ **[Confirmed — DL49]** · บัญชีสร้างโดย `ADMIN` และผูกพนักงานผ่าน `Employees.UserId`
- Check-in/check-out หน้างาน **อยู่ฝั่ง Booking app** — ระบบเรารับเป็นข้อมูลที่ Smart Booking POST มาเท่านั้น

---

## 3.10 สิ่งที่ยังรอจากทีม Booking (สรุปไป Part 9 §9.4)

พัฒนาด้วยของจำลองก่อน แล้วเปลี่ยนเป็นของจริงเมื่อได้ spec **[Confirmed — Q14]**: `booking-simulator` (`npm run booking:simulate -- <scenario>`) POST payload v1 ที่ sign แล้วเข้า endpoint จริง · `mock` provider ตอบ `fetchJob` / `fetchWindow` สำหรับ read API (DL46)

1. **POST ทุกครั้งที่งานเปลี่ยน** (check-in, check-out, cancel, แก้ไข) ไม่ใช่แค่ตอนสร้าง **[Assumption — ข้อสำคัญที่สุด]** — ถ้า POST เฉพาะตอนสร้าง สถานะใบงานจะตาม check-in/check-out ไม่ได้ · ส่งทั้งใบหรือแค่ส่วนที่เปลี่ยน · มี `eventId` / `version` / `updatedAt` ไหม · check-in ซ้ำได้ไหม
2. **ตกลง push contract**: `POST /api/integration/booking/jobs` body draft v1 ของเรา (Part 5 / Part 7) — Smart Booking ส่งตามนี้ได้ไหม หรือต้องใช้ body ของ Booking เอง (เขียน mapper `smart-booking` ใน P3c) **[Assumption]**
3. **DO / SH** หมายถึงอะไร (คาดว่า Delivery Order / Shipment) **[Assumption]** — ระบบเราใช้แสดงผลและค้นหาเท่านั้น
4. **Auth ขาเข้า**: HMAC (`X-Booking-Timestamp` + `X-Booking-Signature`) หรือ API key (`X-Api-Key`) · egress IP ของ Booking สำหรับเปิด firewall ขาเข้า **[Assumption]**
5. **Retry ฝั่ง Booking**: retry เมื่อ timeout / non-2xx แบบ exponential backoff อย่างน้อย 24 ชม. · รักษาลำดับต่องาน · ส่งซ้ำตามคำขอ (manual resend) ได้ไหม **[Assumption]**
6. **Read API (optional)**: ขอ `GET /jobs/{jobId}` + `GET /jobs?from&to` เพื่อ refresh ต่องาน / reconcile ตอนกลางคืน — ไม่มี ⇒ POST ที่หายกู้ได้เมื่อ Booking ส่งซ้ำเท่านั้น **[Assumption]**
7. **Booking ระบุกล้องในใบงาน** (`DeviceRefs` รวมกล้องสำรอง) ด้วยรหัสอะไร (DeviceCode / Serial / รหัส DSS) — **เป็นแหล่งเดียวของการผูกกล้อง** (Q20)
8. Booking มอบงานให้ "ทีม" / "หัวหน้าทีม-คนขับ" / "รถ" — ใช้ ref อะไร · มีข้อมูลกล้องประจำทีมให้ดึงไหม (ผ่าน read API)

---

## 3.11 Settings ที่ใช้ใน workflow

| Key | Default | Bounds | ใช้ที่ |
|---|---|---|---|
| `status.unknown-after-seconds` | 120 | ≥ 2 × poll | คำนวณ UNKNOWN |
| `status.display-cache-seconds` | 10 | 0–60 (0 = ไม่ cache) | อายุ cache Redis ของสถานะกล้องที่ `api` ดึงจาก DSS ให้หน้าจอ (DL45) · ไม่กระทบ session engine |
| `gps.poll-interval-seconds` | 15 | 5–300 | GpsPoll (เดิม) |
| `camera.activation-debounce-minutes` | **15** **[Confirmed — Q3]** | 1–60 | เปิด session |
| `session.merge-gap-minutes` | 15 | 0–240 | ตัด session เมื่อ offline (ไม่ใช่การปิดใบงาน) |
| `session.unknown-max-minutes` | 30 | 5–240 | ปิด session เมื่อ unknown |
| `session.max-segment-hours` | 12 | 1–24 (**ผูกกับ playback 24 ชม.**) | split |
| `depot.fix-max-age-minutes` | 30 | 5–240 | ตรวจอยู่ฐาน |
| `matching.window-before-minutes` / `after` | 60 / 60 **[Confirmed — Q3]** | 0–240 | candidate window |
| `matching.extended-window-minutes` | 180 **[Confirmed — Q3]** | ≥ window | MEDIUM — attach อัตโนมัติ (DL37) |
| `matching.auto-switch-enabled` | true **[Confirmed — Q5]** | bool | A→B |
| `workorder.stale-open-hours` | 36 **[Confirmed — Q23]** | 12–336 | alert ไม่มี check-out (นับจาก check-in) |
| `workorder.force-close-after-hours` | 168 **[Confirmed — Q23]** | 24–720 | SafetyTimeout (นับจาก check-in) |
| `booking.stale-after-minutes` | 15 | 5–240 | **ความหมายใหม่ (DL46)**: อายุของแถว `IntegrationInbox` ที่ยัง `Pending` / `Failed` ที่เก่าที่สุด (backlog ของ processor) เกินค่านี้ ⇒ ผล `ProjectionStale` + banner + alert 10 `BOOKING_SYNC_STALE` |
| `booking.inbound-silence-alert-hours` | 24 | 0–168 (0 = ปิด) | ไม่มี POST จาก Smart Booking ที่รับได้นานเกินนี้ ⇒ alert 17 `BOOKING_INBOUND_SILENT` (DL46) |
| `booking.rematch-horizon-hours` | 72 | 1–336 | re-match |
| `alert.offline-during-job-minutes` | 10 | 1–120 | alert 5 |

ไม่มี setting ของใบรวม / auto-void / SLA คิวตรวจสอบแล้ว (DL33) · ตัด `booking.sync-interval-seconds` (ไม่มี pull ทุก 2 นาทีแล้ว — DL46 · ยังไม่มีโค้ด จึงลบได้เลย)

เพิ่ม key = แก้ `SETTING_DEFAULTS` + `SETTING_BOUNDS` (`setting-spec.ts`) + data migration (กติกาเดิมของ reference — ไม่พึ่ง seed) · `booking.inbound-silence-alert-hours` ต้องทำครบทั้ง 3 จุดนี้
