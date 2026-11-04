# Part 3 — Business Workflows

> ชื่อตาราง/enum ตาม [04-database-design.md](04-database-design.md) · ค่าตัวเลขในวงเล็บคือ default ของ Settings (ดู §3.11)
> กติกาในส่วนนี้ปรับตามคำตอบของผู้ใช้ 2026-11-04 (Part 9 §9.5) — **อาจเปลี่ยนตามข้อมูลจากทีม Booking**

---

## 3.0 แยกความหมายของสถานะ (ห้ามปนกัน)

| คำ | ความหมาย | แหล่งข้อมูล | ใช้ตัดสินอะไร |
|---|---|---|---|
| **Device Online** | กล้องต่อ platform อยู่ (`DeviceState.PlatformState = 1` และข้อมูลไม่เก่าเกิน `status.unknown-after-seconds`) | DSS device list · DSS `/location` online flag · BRMS MQ · webhook | แสดงสถานะบนแผนที่/รายการ |
| **Device Unknown** | ไม่มี observation ใหม่นานเกินกำหนด (คำนวณ ไม่ได้เก็บ) | อายุของ `LastObservedAt` | **hold** — ไม่เปิดและไม่ปิด session จนกว่าจะเกิน `session.unknown-max-minutes` |
| **GPS Active** | มี fix ที่ valid อายุ ≤ 2 นาที | GpsPoll / webhook | แสดงตำแหน่ง · ตรวจว่าอยู่ฐาน (ถ้ามี fix) · ไม่ใช้เป็น trigger |
| **At Base** | fix ล่าสุดอยู่ในรัศมีฐาน/จุดชาร์จ (`Depots` — รองรับหลายจุด) | `DeviceState.LastLat/LastLng` · vendor **ไม่มี** charging state (Q21) | **ไม่เปิดใบงาน** (Q15) |
| **Camera Active (เริ่มใช้งาน)** | Online ต่อเนื่อง ≥ `camera.activation-debounce-minutes` (**15**) และไม่ได้อยู่ฐาน | คำนวณจาก `StateSince` | **trigger เปิด Tracking Session ที่นับเป็นงาน** |
| **Recording Started** | มีไฟล์บันทึกในช่วงเวลานั้นจริง | DSS recording search (หลังเกิดเหตุเท่านั้น) → `RecordingSegments` | แสดงหลักฐาน · auto-void ใบงานขยะ · **ไม่ใช้เป็น trigger และไม่สมมติว่าเปิดกล้อง = อัด** |
| **Tracking Session** | ระเบียน `TrackingSessions` = ช่วงที่กล้อง 1 ตัวเปิดต่อเนื่องและสังกัด WO เดียวกัน | Session engine | หน่วยของ "การใช้งานกล้อง" |
| **Booking Check-in / Check-out** | หัวหน้าทีม (หรือแอดมิน) กดเริ่ม/จบงาน **ในระบบ Booking** | Booking sync **[Assumption ด้านรูปแบบข้อมูล]** | **กำหนดสถานะใบงาน** — check-out = ปิดใบงาน (ผู้ใช้ยืนยัน) |
| **Work Order** | ระเบียนธุรกิจใน `WorkOrders` (PK ของตัวเอง) | Matcher | ผูก Booking (0..1) · รวมหลาย session · **สถานะตาม Booking ไม่ใช่คนในระบบเรากดปิด** |

```mermaid
flowchart LR
  A["Device Online"] -->|"ต่อเนื่อง ≥ 15 นาที"| B{"อยู่ในรัศมีฐาน?"}
  B -->|"ใช่"| Z["Session จัดเป็น IdleOrCharging<br/>ไม่เปิดใบงาน"]
  B -->|"ไม่"| C["Tracking Session"]
  C --> D["Matching"]
  D -->|"HIGH"| E["Work Order Linked"]
  D -->|"อื่น ๆ"| F["Work Order ยังไม่ผูก Booking"]
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
  participant MQ as BRMS MQ
  participant SP as StatusPoll
  participant DS as device-status
  participant DB as PostgreSQL
  participant BUS as Redis emitter
  participant WEB as Web map

  CAM->>DSS: เปิดเครื่อง เชื่อมต่อ platform
  par ช่องทางเร็ว ถ้าเปิด MQ
    DSS-->>MQ: status online
    MQ->>DS: applyObservation(device, ONLINE, BrmsMq)
  and ช่องทางหลัก ทุก 30 วินาที
    SP->>DSS: GET device list
    DSS-->>SP: status ของทุกเครื่อง
    SP->>DS: applyObservation ทีละเครื่อง
  end
  DS->>DB: UPDATE DeviceState SET LastObservedAt = now()
  alt สถานะเปลี่ยน OFFLINE เป็น ONLINE
    DS->>DB: PlatformState = 1, StateSince = now()
    DS->>DB: INSERT DeviceStatusHistory
    DS->>BUS: device:status
    BUS-->>WEB: แสดงกล้อง online
  else สถานะเดิมซ้ำ เช่น MQ reconnect burst
    Note over DS,DB: อัปเดตแค่ LastObservedAt ไม่แตะ StateSince
  end
  Note over DS: ไม่มี session logic ใน ingest path
```

กติกา:
- `applyObservation` เป็น `UPDATE` เดียว ใช้ `IS DISTINCT FROM` ตรวจ transition · เวลาใช้ DB `now()`
- **ไม่ล้างสถานะเป็น null** เมื่อ MQ หลุด/worker restart (ต่างจาก `clearPlatformStatuses()` ของ reference) — ความเก่าของข้อมูลถูกตีความเป็น UNKNOWN เอง
- GPS fix ที่สดถือเป็น ONLINE observation ด้วย (source = DssLocation) · fix ที่ valid ใช้คำนวณ `DeviceState.IsAtDepot`
- **หลาย source ขัดกัน — ใช้ลำดับความน่าเชื่อถือ ไม่ใช่ last-write-wins**: BRMS MQ (เมื่อเชื่อมต่ออยู่) > DSS device list > DSS `/location` online flag / GPS fix > webhook · observation จาก source ที่ลำดับต่ำกว่า **เปลี่ยน state ไม่ได้** ถ้า source ที่ตั้ง state ปัจจุบัน (`DeviceState.StateSource`) ยังสดอยู่ (`StateSourceObservedAt` ไม่เก่ากว่า `status.unknown-after-seconds`) — แค่ bump `LastObservedAt`

---

## 3.2 Automatic Work Order Creation

```mermaid
sequenceDiagram
  autonumber
  participant SW as SessionSweep
  participant DB as PostgreSQL
  participant M as Matcher
  participant RT as Realtime and Alerts
  participant OPS as Operator web และ mobile

  loop ทุก 30 วินาที ทุกอุปกรณ์ ORDER BY Id
    SW->>DB: BEGIN และ SELECT DeviceState FOR UPDATE
    SW->>DB: โหลด open session, assignment ณ now, WO ล่าสุด
    SW->>SW: decide(snapshot, now, settings)
    alt Online ครบ 15 นาที และไม่มี open session
      SW->>DB: INSERT TrackingSessions ON CONFLICT DO NOTHING
      Note right of SW: StartedAt = max(StateSince, EndedAt ของ session ก่อนหน้า)
      alt fix ล่าสุดอยู่ในรัศมีฐาน
        SW->>DB: MatchState = Classified, Classification = IdleOrCharging, ไม่สร้าง WO
      else ใช้งานนอกฐาน
        SW->>M: attach(session)
        M->>DB: หา BookingJobs ที่ระบุกล้องตัวนี้ หรือทีมของกล้อง ณ StartedAt
        alt HIGH
          M->>DB: get-or-create WorkOrders ด้วย UQ_WO_BookingJob
          M->>DB: LinkStatus = Linked, LinkSource = Auto
        else MEDIUM หรือ AMBIGUOUS หรือ NONE
          M->>DB: get-or-create ใบรวมของทีม ด้วย UQ_WO_OpenUnlinkedPerTeam
          M->>DB: LinkStatus = Suggested หรือ Ambiguous หรือ Unlinked
        else Booking ยังไม่ผูกกล้องนี้กับทีมหรืองานใด
          M->>DB: get-or-create ใบรวมของกล้อง ด้วย UQ_WO_OpenUnlinkedPerDevice และ alert
        end
        M->>DB: UPDATE session WorkOrderId และ INSERT WorkOrderEvents, MatchAttempts, Outbox
      end
      SW->>DB: COMMIT
      SW->>RT: session:opened, workorder:changed หลัง commit
      RT-->>OPS: แจ้งเตือนเมื่อใบงานยังไม่ผูก Booking
    else ไม่มีอะไรเปลี่ยน
      SW->>DB: COMMIT
    end
  end
```

ข้อกำหนดที่ flow นี้ตอบ:
- **ไม่สร้าง WO ซ้ำจาก event เดิม**: session เปิดได้ตัวเดียวต่ออุปกรณ์ (`UQ_TS_OpenPerDevice` + `EX_TS_NoOverlap`) · WO ต่อ Booking ได้ใบเดียว (`UQ_WO_BookingJob`) · ใบรวมเปิดได้ใบเดียวต่อทีม (`UQ_WO_OpenUnlinkedPerTeam`) หรือต่อกล้องที่ยังไม่มีทีม (`UQ_WO_OpenUnlinkedPerDevice`) · sweep ซ้ำ/worker 2 ตัว/observation ซ้ำ → ผลเหมือนเดิม
- **เปิดกล้องแต่ไม่พบ Booking**: สร้าง WO ที่ยังไม่ผูก Booking ไว้ก่อน **[Confirmed — Q11]** แล้วจับคู่ภายหลังได้
- **กล้องชาร์จที่ฐานไม่เปิดใบงาน [Confirmed — Q15]** · vendor ไม่ส่งสถานะชาร์จ **[Confirmed — Q21]** จึงตรวจ 2 ชั้น:
  1. ตอนเปิด session: fix ล่าสุดที่ valid อายุ ≤ `depot.fix-max-age-minutes` (30) อยู่ในรัศมีของ `Depots` (หลายจุด — พิกัด mock ไว้ก่อน, Q22)
  2. หลังเกิดเหตุ: ใบรวมที่ปิดเพราะไม่มีข้อมูล Booking และ **ทุก session ไม่มี recording เลย** ⇒ ระบบ Void อัตโนมัติ (`Classification = IdleOrCharging`) ถ้า `workorder.auto-void-without-recording = true` — ครอบกรณีกล้องในอาคารที่ไม่มี GPS
- **เลขใบงาน** `WO-YYYYMM-NNNNN` จาก `WorkOrderCounters` (atomic)
- **Title**: link แล้วใช้ชื่องานจาก Booking · ไม่ link = `ใบงานอัตโนมัติ {TeamCode} {DeviceCode}`

---

## 3.3 Booking Work Order Matching

### 3.3.1 Algorithm (`matchAt(session)`) — pure function, versioned (`AlgoVersion`)

```mermaid
flowchart TB
  S["Session ของกล้อง D เริ่มที่ t"] --> DR{"มี BookingJob ในช่วงเวลา<br/>ที่ระบุกล้อง D ใน DeviceRefs?"}
  DR -->|"มี"| C
  DR -->|"ไม่มี"| T{"DeviceAssignments<br/>ของ D ณ t"}
  T -->|"ไม่มี"| NT["Result NoTeam<br/>ใบรวมของกล้อง<br/>alert ให้ Operator"]
  T -->|"มี team"| C["Candidates = BookingJobs ที่<br/>ระบุกล้อง D หรือ ref ทีม หรือ ref หัวหน้าทีม ณ t<br/>Status ใน Planned, Confirmed, InProgress, Unknown<br/>ช่วง session ซ้อนกับช่วงงาน ± 60 นาที<br/>และผ่าน Rule 1"]
  C --> N{"จำนวน candidate"}
  N -->|"0"| X{"projection สด?"}
  X -->|"ใช่"| EXT{"มีงานในช่วงขยาย ±3 ชม.?"}
  EXT -->|"มี 1"| MED["MEDIUM = Suggested"]
  EXT -->|"ไม่มี หรือ มากกว่า 1"| NONE["NONE = Unlinked"]
  X -->|"ไม่ เก่าเกิน 15 นาที"| PEND["ProjectionStale = Pending<br/>รอ reconcile"]
  N -->|"1 หรือมากกว่า"| TIER["จัด tier<br/>T1 อยู่ในช่วงงาน · T2 ก่อนเริ่ม · T3 หลังจบ"]
  TIER --> BEST{"tier ที่ดีที่สุดมีกี่งาน"}
  BEST -->|"1"| HI{"status map ได้<br/>ไม่ใช่ Unknown?"}
  HI -->|"ใช่"| HIGH["HIGH = auto link"]
  HI -->|"ไม่"| MED
  BEST -->|"มากกว่า 1"| TB["tie-break<br/>1 งานที่ระบุกล้อง D<br/>2 Booking check-in แล้วยังไม่ check-out<br/>3 งานที่มี WO เปิดอยู่แล้ว"]
  TB -->|"ตัดสินได้"| HIGH
  TB -->|"ตัดสินไม่ได้"| AMB["AMBIGUOUS<br/>คิวให้ Operator เลือก"]
```

| ผล | การกระทำ | LinkStatus ของ WO |
|---|---|---|
| HIGH | get-or-create WO ของ Booking job แล้ว attach session | Linked (Auto) |
| MEDIUM | attach เข้าใบรวมของทีม + เก็บคำแนะนำ · คิว review ของ Operator | Suggested |
| AMBIGUOUS | เหมือน MEDIUM แต่ไม่มี candidate ที่แนะนำ (แสดงทุกตัว) | Ambiguous |
| NONE | attach เข้าใบรวมของทีม | Unlinked |
| ProjectionStale | attach เข้าใบรวมของทีม · re-match อัตโนมัติเมื่อ sync สำเร็จ | Pending |
| NoTeam | attach เข้า **ใบรวมของกล้อง** (`TeamId` ว่าง — ยังสร้างใบงานไว้ก่อนตาม Q11) · alert `CAMERA_ACTIVE_NO_TEAM` | Unlinked |

นิยามที่ใช้ในการ match:
- **ลำดับแหล่งที่บอกว่ากล้องไปงานไหน**:
  1. **`BookingJobs.DeviceRefs`** — Booking ระบุกล้องที่ใช้กับงาน (รวมกล้องสำรอง) **[Confirmed — Q4, Q20: การผูกกล้องมาจากฝั่ง Booking เท่านั้น · รูปแบบข้อมูลเป็น Assumption]** — match ด้วย `Devices.DeviceCode` / `VendorDeviceId` / `SerialNo` · ไม่ต้องมีทีมก็ match ได้
  2. **ทีม** จาก `DeviceAssignments` ณ `StartedAt` (**sync มาจาก Booking เท่านั้น** ถ้า Booking มีข้อมูลกล้องประจำทีม) แล้วเทียบ `BookingJobs.BookingTeamRef` กับ `Teams.BookingTeamRef` หรือ `BookingJobs.BookingLeaderRef` กับ `Employees.BookingEmployeeRef` ของหัวหน้าทีม — ทั้งสองแบบ HIGH ได้
  - session ที่ไม่มีทั้งข้อ 1 และ 2 = `NoTeam` เข้าใบรวมของกล้อง และ re-match เมื่อ Booking ส่งข้อมูลมา · **ระบบเราไม่มีหน้าจอผูกกล้องกับทีมเอง**
- `BookingJobs.TeamId` / `LeaderEmployeeId` เป็น **cache สำหรับแสดงผล** · เมื่อแก้ ref ของทีม/พนักงาน/กล้อง ⇒ job `re-resolve` อัปเดต cache + enqueue re-match
- **ช่วงเวลางาน** = `[min(PlannedStartAt, BookingCheckInAt), BookingCheckOutAt ?? (check-in แล้ว ⇒ ไม่มีขอบบน) ?? PlannedEndAt]` · candidate = ช่วง session `[StartedAt, EndedAt หรือ now]` **ซ้อน** กับช่วงงาน ± `matching.window-before/after-minutes` (60) · tier คิดจาก `StartedAt` · งานที่ไม่มีเวลาใช้ทั้งวัน `ScheduledDate` (Asia/Bangkok) และ confidence สูงสุด MEDIUM
- **งานที่ check-in แล้วแต่ยังไม่ check-out = ยังเป็นใบเดิม** — กล้องแบตหมด เอาไปชาร์จแล้วเปิดใหม่หลายชั่วโมง session ใหม่ก็ยังเข้า WO เดิม **[Confirmed — Q3]**
- ระยะห่าง GPS กับ `BookingJobs.SiteLat/SiteLng` เป็นแค่ข้อมูลประกอบใน candidate list (กล้องส่วนใหญ่ไม่มี fix)
- **Rule 1 (กัน loop)**: Booking job ที่ WO ถูก **check-out แล้ว** ไม่เป็น auto candidate จนกว่า Booking จะ **check-in ใหม่** (ระบบ reopen ให้) · Cancelled / Voided ไม่เป็น candidate อีก · WO ที่ปิดเพราะ `SafetyTimeout` ยังเป็น candidate (session ใหม่ได้ HIGH ⇒ reopen + `NeedsReview`)
- `MatchAttempts` เขียนเฉพาะเมื่อ `InputHash` เปลี่ยน · คำแนะนำ MEDIUM ของ session ล่าสุดเก็บที่ `WorkOrders.SuggestedBookingJobId`

### 3.3.2 Manual link โดย Operator ชนะ auto เสมอ

```mermaid
sequenceDiagram
  autonumber
  participant OP as Operator
  participant API as API work-orders
  participant DB as PostgreSQL
  participant RT as Realtime

  OP->>API: GET /work-orders/:id/booking-candidates
  API->>DB: คำนวณ candidate สด จาก BookingJobs
  API-->>OP: รายการพร้อม tier, เหตุผล, ระยะทาง
  OP->>API: POST /work-orders/:id/link bookingJobId พร้อม If-Match RowVersion
  API->>DB: BEGIN และอ่าน DeviceId ของ sessions ใน WO นี้ (ยังไม่ lock)
  API->>DB: lock DeviceState ของอุปกรณ์เหล่านั้น เรียง DeviceId
  API->>DB: lock WO นี้ และ WO ของ Booking job (ถ้ามี) เรียง Id
  API->>DB: ตรวจ RowVersion และตรวจรายการ session ซ้ำหลัง lock
  alt Booking job นี้ยังไม่มี WO
    API->>DB: link in place SET BookingJobId, LinkStatus = Linked, LinkSource = Manual
  else Booking job นี้มี WO อื่นอยู่แล้ว
    API->>DB: ย้าย sessions ทั้งหมดไป WO นั้น
    API->>DB: WO นี้ Status = Merged, MergedIntoWorkOrderId
  end
  API->>DB: ถ้างานนั้น check-out แล้ว ตั้งสถานะ WO ตาม Booking
  API->>DB: INSERT WorkOrderEvents และ Outbox และ AuditLogs
  API->>DB: COMMIT
  API->>RT: workorder:changed
  API-->>OP: 200 พร้อม RowVersion ใหม่
  Note over API,DB: RowVersion ไม่ตรง ตอบ 412 ให้โหลดใหม่
```

- การ link/unlink เป็น**การจับคู่หลักฐานกับงาน** ไม่ใช่การยืนยันสถานะงาน — สถานะยังตาม Booking check-in/check-out **[Confirmed — Q8: ไม่มีการยืนยันสถานะเองในระบบนี้]**
- **Link ทำทั้งใบ** — ถ้าบาง session ไม่เกี่ยวกับงานนั้น ย้ายออกก่อนด้วย `POST /tracking-sessions/:id/attach`
- Link ได้ทั้ง WO ที่ Open และ Closed (link ย้อนหลัง) · WO ที่ merge เข้าใบอื่น ⇒ Merged
- `LinkSource = Manual` ⇒ matcher **ไม่แตะ** WO นั้นอีก (Booking เปลี่ยน ⇒ flag `NeedsReview`)
- Unlink ด้วยมือ ⇒ `LinkStatus = Unlinked`, `LinkSource = Manual` · ไม่นับเป็นใบรวมของทีม (ไม่ชน `UQ_WO_OpenUnlinkedPerTeam` และไม่รับ session ใหม่)
- **Lock order เดียวทั้งระบบ**: `DeviceState` (DeviceId น้อยไปมาก) → `WorkOrders` (Id น้อยไปมาก) → `TrackingSessions` · retry สูงสุด 3 ครั้งเมื่อ deadlock

### 3.3.3 Re-matching

| Trigger | ขอบเขต | กติกา |
|---|---|---|
| Booking job ใหม่/เปลี่ยน (`PayloadHash` เปลี่ยน รวม check-in/check-out/DeviceRefs) | WO ของทีมและกล้องที่เกี่ยวข้อง ±`booking.rematch-horizon-hours` (72) | queue `matching` ด้วย `jobId = team:{id}:{window}` (dedupe) |
| Sync กลับมาสำเร็จหลัง stale | WO ที่ `LinkStatus = Pending` | re-run ทั้งหมด |
| แก้ assignment / ref ย้อนหลัง | session ในช่วงที่แก้ | job `re-resolve` แล้ว re-run |
| Sweep | **session ที่ยังเปิด** ซึ่ง `AwaitingMatch` หรืออยู่ในใบรวมของทีม (Auto) | re-run ทุกรอบ (local, ถูก) |

- **WO ที่เข้าข่าย**: Open ที่ `LinkStatus ∈ {Pending, Suggested, Ambiguous, Unlinked}` และ `LinkSource` ไม่ใช่ Manual · รวมใบรวมที่ **ปิดเพราะไม่มีข้อมูล Booking (NoBookingData)** ภายใน horizon (link ย้อนหลังได้)
- **ใครเขียนอะไร**: queue `matching` จัดการ session ที่ปิดแล้ว + การ link ระดับ WO · **session ที่ยังเปิด** ให้ `SessionSweep` (writer เดียวของ lifecycle session) · ทั้งสองฝั่งใช้ lock order เดียวกัน
- WO ที่ link แบบ Auto ย้ายไปงานอื่นได้เฉพาะเมื่อยัง Open · ไม่มีคนแตะ · ผลใหม่ HIGH ของงานอื่น — นอกนั้น `NeedsReview`

### 3.3.4 ใบรวมของทีม (WO ที่ยังไม่ผูก Booking)

session ที่ได้ MEDIUM / AMBIGUOUS / NONE / ProjectionStale / NoTeam เข้า **WO เปิดใบเดียว** ต่อทีม (`UQ_WO_OpenUnlinkedPerTeam`) หรือต่อกล้องเมื่อยังไม่รู้ทีม (`UQ_WO_OpenUnlinkedPerDevice`) · `LinkSource` ไม่ใช่ Manual

| คำถาม | กติกา |
|---|---|
| `LinkStatus` ของใบรวม | ตาม session ล่าสุดที่ attach: Pending > Ambiguous > Suggested > Unlinked · `SuggestedBookingJobId` = คำแนะนำของ session ล่าสุด |
| re-match ได้ HIGH ทุก session ในใบ เป็นงานเดียวกัน | **link in place** หรือ merge ถ้างานนั้นมี WO อยู่แล้ว |
| re-match ได้ HIGH แค่บาง session | ย้ายเฉพาะ session นั้นไป WO ของงาน · ใบรวมที่ไม่เหลือ session ⇒ Merged |
| Operator เลือก/ยืนยัน/link ด้วยมือ | link ทั้งใบ (§3.3.2) |
| ปิดเมื่อไร | ระบบ poll Booking ต่อเนื่อง · **ถ้ายังไม่มีข้อมูล Booking ที่ตรงกันภายใน `workorder.unlinked-close-after-minutes` (240) นับจาก `OpenedAt` ⇒ ปิด** (`CloseReason = NoBookingData`) **[Confirmed — Q23]** · ปิดแล้วยัง link ย้อนหลังได้ (re-match ครอบใบที่ปิดแบบนี้ภายใน horizon) และเข้าคิวตรวจสอบ (`NeedsReview`) |
| session ต่อเนื่องหลัง WO ถูก check-out ขณะกล้องยังเปิด (`AwaitingMatch`) | attach **เฉพาะเมื่อได้ HIGH** (เช่นงานถัดไป) · NONE ค้างเป็น `AwaitingMatch` — **ไม่เข้าใบรวม** (กัน loop) |

---

## 3.4 Tracking Session Lifecycle

### 3.4.1 State diagram

```mermaid
stateDiagram-v2
  [*] --> Open : Online ต่อเนื่องครบ 15 นาที
  Open --> Open : offline สั้นกว่า merge gap หรือ unknown สั้นกว่า unknown max
  Open --> Closed : offline ครบ merge gap
  Open --> Closed : unknown ครบ unknown max
  Open --> Split : WO ถูก check-out หรือ cancel หรือ void
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
| ใบรวมถูกปิดเพราะไม่มีข้อมูล Booking ครบ 240 นาที ขณะกล้องยังเปิด | เวลาที่ปิด | WorkOrderClosed | `AwaitingMatch` · ไม่สร้างใบรวมใหม่จนกว่ากล้องปิด-เปิดใหม่ · attach เมื่อ Booking ส่งข้อมูลที่ HIGH |
| Unknown ≥ 30 นาที | `LastOnlineObservedAt` | StatusUnknown | — |
| Booking check-out / cancel / admin void ขณะกล้องเปิด | `BookingCheckOutAt` / เวลาที่ cancel / void | WorkOrderClosed / WorkOrderVoided | เปิดทันที · `AwaitingMatch` · **ไม่สร้างใบรวมใหม่** |
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
  participant BK as Booking
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
- ถ้า Booking ยังไม่ระบุ: session ของกล้องสำรอง = `NoTeam` เข้าใบรวมของกล้อง + alert `CAMERA_ACTIVE_NO_TEAM` · เมื่อ Booking เพิ่มกล้องในใบงาน ⇒ re-match HIGH ย้ายเข้า WO ของงานอัตโนมัติ · Operator ใช้ `POST /tracking-sessions/:id/attach` ได้ในคิวตรวจสอบ (เป็นการจับคู่หลักฐาน ไม่ใช่การผูกกล้อง)

### 3.4.3 Decision table ของ `decide()` (ต่ออุปกรณ์ ต่อรอบ)

| # | เงื่อนไข | การกระทำ |
|---|---|---|
| 1 | อุปกรณ์ Retired / Inactive | ปิด open session (ถ้ามี) · ไม่เปิดใหม่ |
| 2 | ไม่มี open session · effective = ONLINE · `now − StateSince ≥ debounce (15)` | เปิด session `StartedAt = max(StateSince, lastSession.EndedAt)` · อยู่ในรัศมีฐาน ⇒ Classified IdleOrCharging · ไม่งั้น attach |
| 3 | ไม่มี open session · อื่น ๆ | ไม่ทำอะไร |
| 4 | มี open session · effective = OFFLINE · `now − StateSince ≥ merge gap` | ปิด `EndedAt = StateSince` |
| 5 | มี open session · effective = UNKNOWN · `now − LastObservedAt ≥ unknown max` | ปิด `EndedAt = LastOnlineObservedAt` |
| 6 | มี open session · WO ของ session ไม่ Open แล้ว (check-out / cancel / void) | split ที่เวลานั้น · successor `AwaitingMatch` |
| 7 | มี open session · `now − StartedAt ≥ max segment` | split · successor WO เดิม |
| 8 | มี open session · assignment ณ now ≠ `session.TeamId` | split · successor match ใหม่ |
| 9 | มี open session · สถานะอยู่ในรัศมีฐานเปลี่ยน | split (`AtBaseChanged`) |
| 10 | มี open session `AwaitingMatch` / ในใบรวมของทีม (Auto) · match ได้ HIGH | ถ้า session เริ่มก่อนช่วงงาน − window-before: split ที่จุดนั้น (`StartInferred = PlannedBoundary`) แล้ว attach successor · ไม่งั้นย้ายทั้ง session · ใบรวมที่ว่างลง ⇒ Merged |
| 11 | มี open session ใน WO A (Linked, ยังไม่ check-out) · `now ≥ A.PlannedEndAt` และงาน B ของทีม/กล้องเดียวกันเป็น HIGH · `matching.auto-switch-enabled` | split ที่ `max(A.PlannedEndAt, B.BookingCheckInAt ?? B.PlannedStartAt)` |
| 12 | อื่น ๆ | hold |

pass ระดับ WO ใน sweep เดียวกัน:

| เงื่อนไข WO (Open) | การกระทำ |
|---|---|
| Linked · Booking check-out แล้ว | Closed (`BookingCheckout`) เวลา = `BookingCheckOutAt` — **ทางปิดหลักของใบงานที่ผูก Booking** **[Confirmed — Q1, Q2]** |
| Linked · ยังไม่ check-out · `now − OpenedAt ≥ workorder.stale-open-hours` (**36**) | **ไม่ปิด** · `NeedsReview` + alert `WORK_ORDER_NO_CHECKOUT` **[Confirmed — Q23]** |
| Linked · ยังไม่ check-out · `now − OpenedAt ≥ workorder.force-close-after-hours` (168 = 7 วัน) | Closed (`SafetyTimeout`) + `NeedsReview` — กันใบงานค้างตลอดไป **[Confirmed — Q23]** |
| ใบรวม (ไม่ผูก Booking) · `now − OpenedAt ≥ workorder.unlinked-close-after-minutes` (240) โดยยังไม่มีข้อมูล Booking ที่ตรงกัน | Closed (`NoBookingData`) + `NeedsReview` (ReviewReason NoBookingData) แล้วตรวจ auto-void (ทุก session ไม่มี recording ⇒ Voided IdleOrCharging, ล้าง review) |
| อยู่ในคิวตรวจสอบนานเกิน `review.sla-hours` (**36**) นับจาก `ReviewSince` | alert `REVIEW_QUEUE_OVERDUE` ถึง Operator + Admin (ครั้งเดียวต่อใบ) **[Confirmed — Q7]** |

---

## 3.5 สถานะใบงานตาม Booking Check-in / Check-out

```mermaid
sequenceDiagram
  autonumber
  participant L as หัวหน้าทีม ใน Booking app
  participant BK as Booking
  participant SY as booking-sync
  participant DB as PostgreSQL
  participant SW as SessionSweep
  participant RT as Realtime

  L->>BK: check-in งาน A
  SY->>BK: sync incremental หรือ webhook
  SY->>DB: BookingJobs A BookingCheckInAt, Status InProgress
  SY->>DB: queue rematch ทีมและกล้องของงาน A
  Note over SW,DB: session ของทีมที่ยังไม่ผูก จับคู่ HIGH เข้า WO A
  L->>BK: check-out งาน A
  SY->>DB: BookingJobs A BookingCheckOutAt
  SY->>DB: WO A Status = Closed, CloseReason = BookingCheckout, ClosedAt = BookingCheckOutAt
  SY->>RT: workorder:changed หลัง commit
  Note over SW: รอบถัดไป ไม่เกิน 30 วินาที
  SW->>DB: session ที่ยังเปิดของ WO A split ที่ BookingCheckOutAt
  SW->>DB: successor AwaitingMatch ไม่สร้างใบรวมใหม่
  opt Booking check-in งาน A อีกครั้ง
    SY->>DB: WO A Closed เป็น Open, Source = Booking
  end
```

- **ในระบบเราไม่มีปุ่มปิดใบงาน** — สถานะใบงานที่ผูก Booking ตาม check-in/check-out ของ Booking เท่านั้น **[Confirmed — Q2]** · หัวหน้าทีม/แอดมินทำ check-out ฝั่ง Booking (สอดคล้องกับคำตอบเดิมว่า "ปิดได้ทั้งหัวหน้าทีมและแอดมินระบบ" — DL13)
- **Reopen = เปลี่ยนสถานะจาก Closed กลับเป็น Open** ไม่ใช่การเปิดดู · **การเปิดดูใบงานและหลักฐานทำได้ตลอด** ตราบที่ข้อมูลยังอยู่ใน retention (3 เดือน) **[Confirmed — Q9]** · ระบบ reopen เองเฉพาะเมื่อ Booking check-in ใหม่ หรือใบที่ปิดด้วย SafetyTimeout มี session HIGH ใหม่ · ไม่มีปุ่ม reopen ให้คน
- **Void** (`ADMIN` เท่านั้น): ใบงานที่ไม่ใช่งานจริง (ทดสอบ/ชาร์จ) — ระบบ void ให้เองเมื่อใบรวมไม่มี recording — ใช้ได้กับใบที่ยังไม่ผูก Booking (ใบที่ผูก Booking ให้ยกเลิกฝั่ง Booking) · session ยัง attach อยู่และบันทึก `Classification` · open session ถูก split (`WorkOrderVoided`)
- **Session engine เป็น writer เดียวของ lifecycle session** — sync เปลี่ยนแค่ WO แล้ว sweep ทำ split ให้ (เวลาจบ = `BookingCheckOutAt` ⇒ deterministic)

---

## 3.6 Booking API Failure / Recovery

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Scheduler
  participant SY as booking-sync worker
  participant CB as Circuit breaker Redis
  participant BK as Booking API
  participant DB as PostgreSQL
  participant M as Matcher
  participant ADM as Admin UI

  SCH->>SY: incremental sync ทุก 2 นาที
  SY->>CB: state?
  CB-->>SY: CLOSED
  SY->>BK: GET jobs changed since cursor timeout 8s
  BK--xSY: timeout หรือ 5xx
  SY->>DB: IntegrationCallLogs Outcome = Timeout และ ConsecutiveFailures + 1
  SY->>SY: BullMQ retry backoff 30s 1m 2m 4m 8m พร้อม jitter
  Note over SY,CB: ล้มเหลวติดกัน 5 ครั้ง
  SY->>CB: OPEN 2 นาที
  loop ระหว่าง breaker OPEN
    SCH->>SY: sync
    SY->>CB: state?
    CB-->>SY: OPEN ข้ามรอบโดยไม่ queue ซ้ำ
  end
  Note over M,DB: Session และ WO ยังทำงานบน projection เดิม
  M->>DB: match ไม่เจอ และ projection เก่าเกิน 15 นาที ได้ LinkStatus = Pending
  DB-->>ADM: banner ข้อมูล Booking ไม่เป็นปัจจุบัน และ alert BOOKING_SYNC_STALE
  CB->>SY: HALF_OPEN หลังครบ 2 นาที
  SY->>BK: probe 1 request
  BK-->>SY: 200
  SY->>CB: CLOSED
  SY->>BK: reconcile full window -7 วัน ถึง +14 วัน แบบแบ่งหน้า
  SY->>DB: upsert BookingJobs ด้วย version guard รวม check-in และ check-out ที่ตกค้าง
  SY->>M: queue rematch สำหรับ WO Pending, Unlinked, Suggested
  M->>DB: link ย้อนหลังที่ได้ HIGH และบันทึก MatchAttempts Trigger = Reconcile
  DB-->>ADM: banner หาย และ alert resolved
```

- **Booking ล่มไม่กระทบ tracking**: real-time path และ session engine ไม่เรียก Booking
- ระหว่างล่ม **ใบงานที่ผูก Booking จะไม่ถูกปิด** (ไม่รู้ check-out) — ปิดย้อนหลังด้วยเวลา `BookingCheckOutAt` จริงเมื่อ sync กลับมา
- write-back ไป Booking (ถ้ามี) ค้างใน `IntegrationOutbox` แล้วส่งตามลำดับเมื่อกลับมา
- ข้อความที่ fail เกิน 5 ครั้ง ⇒ `Dead` แสดงในหน้า Integration ให้ admin กด retry

---

## 3.7 เหตุการณ์จาก Booking

| เหตุการณ์จาก Booking | WO ยังไม่มี | WO Open | WO Closed แล้ว |
|---|---|---|---|
| Check-in | re-match session ที่เกี่ยวข้อง (อาจเกิด WO Linked) | อัปเดตข้อมูลแสดงผล | **reopen** (Source Booking) |
| Check-out / Completed | บันทึก — session ย้อนหลังที่ match ภายหลังจะได้ WO สถานะ Closed | **Closed (`BookingCheckout`)** · split open session | อัปเดตเวลา check-out ถ้าเปลี่ยน |
| Cancelled | ไม่ทำอะไร | WO → `Cancelled` · split open session · `NeedsReview` ถ้ามี recording (alert `WORK_ORDER_CANCELLED_WITH_EVIDENCE`) — **ฝั่ง bodycam ตรวจสอบหลักฐานได้** **[Confirmed — Q6]** | `NeedsReview` |
| เปลี่ยนทีม / เวลา / DeviceRefs | re-match | Auto + ไม่มีคนแตะ ⇒ re-match · ไม่งั้น `NeedsReview` · **`WorkOrders.TeamId`/`DepartmentId` ไม่เปลี่ยนตาม Booking** | `NeedsReview` (alert `BOOKING_JOB_CHANGED_AFTER_CLOSE`) |
| หายจาก full sync | `SourceMissingSince` | `NeedsReview` | `NeedsReview` |

---

## 3.8 State Diagrams ของ Work Order

### Status

```mermaid
stateDiagram-v2
  [*] --> Open : session แรกถูก attach
  Open --> Closed : Booking check-out
  Open --> Closed : ใบรวมไม่มีข้อมูล Booking ครบ 240 นาที หรือ safety timeout 7 วัน
  Open --> Cancelled : Booking cancelled
  Open --> Voided : admin ระบุว่าไม่ใช่งานจริง หรือ auto-void ไม่มี recording
  Open --> Merged : link กับ Booking ที่มี WO อยู่แล้ว
  Closed --> Open : Booking check-in อีกครั้ง
  Closed --> Voided : auto-void ใบรวมที่ไม่มี recording
  Closed --> Merged : link ย้อนหลังกับงานที่มี WO อยู่แล้ว
  Closed --> [*]
  Cancelled --> [*]
  Voided --> [*]
  Merged --> [*]
```

### LinkStatus (มิติแยกจาก Status)

```mermaid
stateDiagram-v2
  [*] --> Pending : สร้าง WO ระหว่าง projection เก่า
  [*] --> Linked : HIGH
  [*] --> Suggested : MEDIUM
  [*] --> Ambiguous : หลาย candidate
  [*] --> Unlinked : ไม่มี candidate
  Pending --> Linked : reconcile ได้ HIGH
  Pending --> Unlinked : reconcile ไม่พบ
  Suggested --> Linked : Operator ยืนยัน
  Suggested --> Unlinked : Operator ปฏิเสธ
  Ambiguous --> Linked : Operator เลือก
  Unlinked --> Linked : link ด้วยมือ หรือ re-match HIGH
  Linked --> Unlinked : unlink ด้วยมือ
  Linked --> Linked : relink ด้วยมือ
```

---

## 3.9 Mobile: Monitoring และตรวจสอบหลักฐาน

ผู้ใช้แอปคือ **ฝั่งตรวจสอบใบงาน/หลักฐานและ monitoring** (Operator, Admin, Viewer) — **ไม่ใช่พนักงานภาคสนาม** **[Confirmed — Q18]** · หัวหน้าทีมใช้ Booking app สำหรับ check-in/check-out

```mermaid
sequenceDiagram
  autonumber
  participant APP as Mobile app ของ Operator
  participant API as API
  participant FCM as FCM

  API->>FCM: push alert เช่น กล้องดับระหว่างงาน หรือใบงานยังไม่ผูก Booking
  FCM-->>APP: แจ้งเตือน
  APP->>API: GET /work-orders/:id
  API-->>APP: ใบงาน + Booking + sessions + availableActions
  APP->>API: GET /streams/recordings?workOrderId
  API-->>APP: ช่วงที่มีวิดีโอ
  APP->>API: POST /streams/playback หรือ POST /streams/live
  API-->>APP: playback URL ผ่าน proxy
  opt ใบงานยังไม่ผูก Booking
    APP->>API: POST /work-orders/:id/link bookingJobId
  end
```

- แอปใช้ API ชุดเดียวกับ web (scope + permission เดียวกัน) + endpoint เฉพาะมือถือ: ทะเบียนเครื่อง, push token, `GET /mobile/overview` (สรุปสั้นสำหรับหน้าแรก)
- Check-in/check-out หน้างาน **อยู่ฝั่ง Booking** — ระบบเรารับเป็นข้อมูลเท่านั้น (Q14 รอทีม Booking เรื่องรูปแบบข้อมูล)

---

## 3.10 สิ่งที่ยังรอจากทีม Booking (สรุปไป Part 9 §9.4)

พัฒนาด้วย **mock adapter ก่อน** แล้วเปลี่ยนเป็นของจริงเมื่อได้ spec **[Confirmed — Q14]**

1. **รูปแบบ check-in/check-out**: มีเวลา check-in/check-out ต่อใบงานไหม · ส่งเป็น event (webhook) หรือ field ในใบงาน · check-in ซ้ำได้ไหม
2. **Booking ระบุกล้องในใบงาน** (`DeviceRefs` รวมกล้องสำรอง) ด้วยรหัสอะไร (DeviceCode / Serial / รหัส DSS) — **เป็นแหล่งเดียวของการผูกกล้อง** (Q20)
3. Booking มอบงานให้ "ทีม" / "หัวหน้าทีม-คนขับ" / "รถ" — ใช้ ref อะไร · มีข้อมูลกล้องประจำทีมให้ sync ไหม

---

## 3.11 Settings ที่ใช้ใน workflow

| Key | Default | Bounds | ใช้ที่ |
|---|---|---|---|
| `status.poll-interval-seconds` | 30 | 10–300 | StatusPoll |
| `status.unknown-after-seconds` | 120 | ≥ 2 × poll | คำนวณ UNKNOWN |
| `gps.poll-interval-seconds` | 15 | 5–300 | GpsPoll (เดิม) |
| `camera.activation-debounce-minutes` | **15** **[Confirmed — Q3]** | 1–60 | เปิด session |
| `session.merge-gap-minutes` | 15 | 0–240 | ตัด session เมื่อ offline (ไม่ใช่การปิดใบงาน) |
| `session.unknown-max-minutes` | 30 | 5–240 | ปิด session เมื่อ unknown |
| `session.max-segment-hours` | 12 | 1–24 (**ผูกกับ playback 24 ชม.**) | split |
| `depot.fix-max-age-minutes` | 30 | 5–240 | ตรวจอยู่ฐาน |
| `matching.window-before-minutes` / `after` | 60 / 60 **[Confirmed — Q3]** | 0–240 | candidate window |
| `matching.extended-window-minutes` | 180 **[Confirmed — Q3]** | ≥ window | MEDIUM |
| `matching.auto-switch-enabled` | true **[Confirmed — Q5]** | bool | A→B |
| `workorder.create-when-unmatched` | true **[Confirmed — Q11]** | bool | สร้างใบรวม |
| `workorder.unlinked-close-after-minutes` | 240 **[Confirmed — Q23]** | 30–1440 | ปิดใบรวมที่ไม่มีข้อมูล Booking (นับจาก `OpenedAt`) |
| `workorder.auto-void-without-recording` | true | bool | Q15 ชั้นที่ 3 |
| `workorder.stale-open-hours` | 36 **[Confirmed — Q23]** | 12–336 | alert ไม่มี check-out |
| `workorder.force-close-after-hours` | 168 **[Confirmed — Q23]** | 24–720 | SafetyTimeout |
| `review.sla-hours` | 36 **[Confirmed — Q7]** | 1–336 | alert คิวตรวจสอบเกินเวลา |
| `booking.sync-interval-seconds` | 120 | 30–3600 | incremental |
| `booking.stale-after-minutes` | 15 | 5–240 | banner / Pending |
| `booking.rematch-horizon-hours` | 72 | 1–336 | re-match |
| `alert.offline-during-job-minutes` | 10 | 1–120 | alert 5 |

เพิ่ม key = แก้ `SETTING_DEFAULTS` + `SETTING_BOUNDS` (`setting-spec.ts`) + data migration (กติกาเดิมของ reference — ไม่พึ่ง seed)
