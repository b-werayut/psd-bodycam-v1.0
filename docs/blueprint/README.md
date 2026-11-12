# Blueprint — PSD Body worn camera

**PSD Body worn camera** — ระบบติดตาม Bodycam และหลักฐานตามใบงานจาก Smart Booking (repo `psd-bodycam-v1.0`)

> เอกสารออกแบบก่อน Implementation ของระบบ **PSD Body worn camera** (`psd-bodycam-v1.0`) · ฉบับ 2026-11-03 · ปรับ 2026-11-09 (DL33–DL36) · ปรับ 2026-11-12 (DL46–DL49)
> Requirement: [requirement ฉบับ 2026-11-12](../requirements/2026-11-12-body-camera-requirements.md) — ยึดทั้งฉบับ (Q24) ยกเว้น 2 ข้อ (Q25 — DL48): ชื่อ role คงเดิม `ADMIN` / `OPERATOR` / `VIEWER` (ไม่ใช้คำว่า Safety) · GPS history และ talk เป็น Must
> Reference: `C:\Git\Internal-BodyCam` (อ่านอย่างเดียว ไม่ถูกแก้ไข)
> Diagram ทั้งหมดเป็น Mermaid — เปิดดูได้ใน GitHub / GitLab / VS Code (Markdown Preview Mermaid Support)

## สารบัญ

| Part | เอกสาร | ตอบคำถาม |
|---|---|---|
| — | [Requirement ฉบับ 2026-11-12](../requirements/2026-11-12-body-camera-requirements.md) | ระบบต้องทำอะไร (web / mobile / Smart Booking) · ต้นทางของ blueprint ทั้งชุด (ข้อยกเว้นดู DL48) |
| 1 | [Existing System Analysis](01-existing-system-analysis.md) | ระบบเดิมเป็นอย่างไร · อะไร reuse / refactor / remove / rebuild · Dashcam ตัดตรงไหน |
| 2 | [System Architecture](02-system-architecture.md) | module อะไรบ้าง · process/deploy อย่างไร · Booking ล่มแล้วอะไรยังทำงาน · security/reliability |
| 3 | [Business Workflows](03-business-workflows.md) | กล้องเปิดแล้วเกิดอะไร · WO มาจาก Booking อย่างไร · match session เข้า WO อย่างไร · session lifecycle · Booking ล่ม/กลับมา |
| 4 | [Database Design](04-database-design.md) | ERD · ทุกตาราง/คอลัมน์/constraint/index · enum · retention · migration · ตัวอย่าง Drizzle |
| 5 | [API Design](05-api-design.md) | REST endpoints + ตัวอย่าง · inbound endpoint จาก Smart Booking · mobile API (หัวหน้าทีม) · WebSocket events · alert types · permission matrix |
| 6 | [Frontend Architecture](06-frontend-architecture.md) | โครงโฟลเดอร์ · routing · หน้าจอ · component reuse · design tokens |
| 7 | [Integration Strategy](07-integration-strategy.md) | Smart Booking POST เข้า inbound endpoint · contract v1 + mapper · auth ขาเข้า · read API (optional) · retry · idempotency · reconcile · monitoring · Confirmed vs Assumption |
| 8 | [Implementation Roadmap](08-implementation-roadmap.md) | phase · dependency · priority · deliverables · acceptance criteria |
| 9 | [Risks & Open Questions](09-risks-open-questions.md) | ความเสี่ยง · กติกาที่ยังไม่ชัด · checklist ข้อมูลจาก Booking · decision log |

---

## Executive Summary

ระบบใหม่ติดตามและบริหาร **Bodycam เท่านั้น** (ตัด Dashcam/ยานพาหนะทั้งหมด) และผูก **การใช้งานกล้องจริง** เข้ากับ **ใบงานจากระบบ Smart Booking** อัตโนมัติ

- **Smart Booking เป็นต้นทางใบงานเดียว** — ระบบเราไม่มี flow สร้าง/อนุมัติ/มอบหมายงาน และ **ไม่สร้างใบงานเอง** (DL33)
- **Smart Booking ส่งใบงานเข้า `POST /api/integration/booking/jobs` ของเรา** เมื่อสร้างใบงาน **[Confirmed]** และส่งซ้ำทุกครั้งที่ใบงานเปลี่ยน **[Assumption]** — ไม่ pull ทุก 2 นาทีแล้ว (DL46) · ใบงานมีเลข DO / SH และเวลา check-in / check-out **[Confirmed]** · read API ของ Booking (refresh รายใบ / reconcile รายคืน) เป็น optional ถ้า Booking มีให้ **[Assumption]**
- ทุก Booking job ที่รับมาเป็น **Work Order** ภายใน 1:1 (PK ของตัวเอง) · เมื่อกล้องเริ่มใช้งาน ระบบเปิด **Tracking Session** แล้วผูกเข้า WO ของงานที่ตรงกันอัตโนมัติ (1 WO มีหลาย session)
- **สถานะใบงานตาม Booking check-in/check-out** — check-out ⇒ ปิดใบงาน · Booking ยกเลิก ⇒ Cancelled · ระบบเราไม่มีปุ่มปิด/reopen/void (หัวหน้าทีม/แอดมินทำฝั่ง Booking)
- จับคู่ไม่ได้ ⇒ session ค้าง `AwaitingMatch` รอ Booking แล้ว rematch อัตโนมัติเมื่อข้อมูลเปลี่ยน · ไม่มีการผูกด้วยมือ ไม่มีคิวตรวจสอบ (DL33) · กล้องชาร์จที่ฐาน ⇒ session `IdleOrCharging`
- **เมนูหลัก = Live** (live wall + talk) **และ หลักฐาน** (`/evidence`: ใบงาน → กล้อง + ช่วงเวลา → playback / ดาวน์โหลด MP4) (DL36) · session ที่ไม่มีใบงานค้นได้จาก `/recordings` · GPS history และ talk เป็น Must แม้ requirement จัดเป็น Optional (DL48)
- ผู้ใช้ **web** = `ADMIN` (แอดมินฝ่ายความปลอดภัยใน requirement), `OPERATOR` (ผู้จัดการแผนก/ฝ่าย · scope แผนก), `VIEWER` — ฝั่ง monitoring และตรวจหลักฐาน · ไม่เปลี่ยนชื่อ role และไม่ใช้คำว่า Safety (DL48)
- ผู้ใช้ **mobile** = **หัวหน้าทีม** role `TEAM_LEADER` (scope `team`) เท่านั้น: ดู live กล้องของตัวเอง + รายละเอียดใบงานจาก Smart Booking ของทีม · ไม่มี playback / GPS / สถานะกล้อง / talk บนมือถือ · `TEAM_LEADER` ไม่มีเมนู web (DL47)
- Retention: GPS 3 เดือน · ใบงาน 3 เดือน · audit 12 เดือน · ไม่ย้ายข้อมูลจากระบบเดิม
- **ทั้งหมดอาจปรับตามข้อมูลจากทีม Booking** (ผู้ใช้ระบุ 2026-11-04)
- Real-time tracking **ไม่ขึ้นกับ Booking** — Booking ล่ม แผนที่/สถานะ/session/หลักฐานยังทำงานครบ · สถานะ online/offline บนหน้าจอดึงจาก DSS ตอนเปิด ไม่ push (DL35)
- Stack เดิม: **NestJS 10 + Drizzle + PostgreSQL + Redis/BullMQ + Socket.IO** · **React 18 + Vite + Tailwind + shadcn** · กล้องผ่าน **DSS middleware** ชุดเดิม (ไม่ใช้ BRMS MQ — DL30) · ไฟล์ export MP4 อยู่บน Local disk (PVC) 24 ชม. ไม่ใช้ MinIO (DL34)
- Reuse โค้ดเดิมได้มาก: infra (`server/src/common/*`), auth/Entra, GPS pipeline, streaming/playback/export/talk, realtime, HMAC ขาเข้า (pattern ของ webhook เดิม), design system + shell ฝั่ง client

---

## Glossary

| คำ | ความหมาย |
|---|---|
| **Device Online / Offline / Unknown** | สถานะการต่อ platform ของกล้อง · Unknown = ไม่มีข้อมูลใหม่นานเกินกำหนด (คำนวณ ไม่เก็บ) |
| **GPS Active** | มีพิกัดที่ valid อายุ ≤ 2 นาที (กล้องในอาคารมักไม่มี — ไม่ใช่สัญญาณว่าปิด) |
| **Camera Active** | Online ต่อเนื่องครบ 15 นาที และไม่ได้อยู่ในรัศมีฐาน = "เริ่มใช้งาน" |
| **Smart Booking** | ระบบใบงานภายนอก (ต้นทางใบงานเดียว) · POST ใบงานเข้า inbound endpoint ของเรา (DL46) · ในโค้ดใช้ชื่อ `booking` / `BOOKING` |
| **Inbound endpoint** | `POST /api/integration/booking/jobs` ใน process `api` ที่ Smart Booking เรียก · ตรวจ auth (HMAC / API key **[Assumption]**) → validate → บันทึก `IntegrationInbox` → ตอบ 202 (`accepted`) / 200 (`duplicate`) · map และ upsert ใน worker `integration` (DL46) |
| **DO / SH** | เลขอ้างอิงที่มากับใบงาน **[Confirmed]** · ความหมาย = เลข Delivery Order / Shipment **[Assumption]** · เก็บใน `BookingJobs.DoNo` / `ShNo` ใช้แสดงและค้นหา ไม่ใช้จับคู่ |
| **`TEAM_LEADER` / scope `team`** | role ของหัวหน้าทีมที่ใช้แอปมือถือ (DL47) · scope `team` = ใบงานของทีมที่ตนเป็นหัวหน้า active (`TeamMembers.Role = 1 Leader`) หรือที่ระบุตนเป็นหัวหน้า + กล้องของทีม/ของใบงาน `Planned` / `Open` · นอก scope = 404 |
| **Booking Check-in / Check-out** | หัวหน้าทีม/แอดมินกดเริ่ม/จบงานใน Smart Booking แล้วมากับ POST (`checkInAt` / `checkOutAt`) · check-out = ปิดใบงานในระบบเรา |
| **Depot** | ฐาน/จุดชาร์จกล้อง — session ที่เกิดที่ฐานไม่นับเป็นงาน (ระบบตั้ง `IdleOrCharging` เอง) |
| **Recording** | มีไฟล์บันทึกจริงตาม DSS recording search (รู้ได้หลังเกิดเหตุ) — เปิดกล้อง **ไม่เท่ากับ** อัดวิดีโอ |
| **Tracking Session** | ช่วงที่กล้อง 1 ตัวเปิดต่อเนื่อง · ผูก WO ได้ 0..1 ใบ (`MatchState`: Attached / AwaitingMatch / NoTeam / Classified) |
| **Work Order (WO)** | ใบงานในระบบเรา สร้าง/อัปเดต 1:1 จาก Booking job เท่านั้น (DL33) · `Status` Planned (รอเริ่ม) / Open / Closed / Cancelled ตาม Booking · `NeedsReview` = badge แจ้งข้อมูล ไม่มีคิว |
| **Booking Job** | ใบงานในระบบ Smart Booking ที่ POST เข้ามา · ระบบเราเก็บ snapshot ล่าสุดเป็น projection (`BookingJobs`) |
| **Team** | หน่วยปฏิบัติงาน หัวหน้า 1 คน (คนขับ) + ลูกทีม · กล้องหลัก 1 ตัวต่อทีม · ใช้จับคู่และกำหนด scope `team` · หัวหน้าทีมมีบัญชี `TEAM_LEADER` ใช้แอปมือถือ ลูกทีมไม่มีบัญชี (DL47) |
| **DeviceRefs** | กล้องที่ Booking ระบุให้ใบงาน (รวมกล้องสำรอง) — การผูกกล้องมาจาก Booking เท่านั้น |
| **AwaitingMatch** | session ที่ยังจับคู่ Booking ไม่ได้ (ไม่มีหรือมีหลาย candidate) — รอ Booking แล้ว rematch อัตโนมัติ · ไม่มีการผูกด้วยมือ / คิวตรวจสอบ (DL33) · ดูหลักฐานได้จาก `/recordings` |
| **หลักฐาน (Evidence)** | เมนู `/evidence`: เลือกใบงาน → กล้อง + ช่วงเวลาจาก session → playback / ดาวน์โหลด MP4 (DL36) · วิดีโอต้นฉบับอยู่บน Dahua DSS Platform · ไฟล์ export อยู่บน PVC 24 ชม. (DL34) |
| **DSS middleware** | `psd-bwc-dss-services` (FastAPI) ที่เรียก Dahua DSS Platform อีกชั้น — ถือ token ของ DSS, HLS ผ่าน `/proxy`, talk เป็น RTSP **[Confirmed]** |

---

## Key Design Decisions & Trade-offs

| Decision | ได้ | เสีย / ยอมรับ |
|---|---|---|
| Modular monolith + process roles (`api`, `worker` แยก `tracking`/`integration`/`media`) | reuse โค้ดเดิม · transaction เดียวข้าม domain · deploy ง่าย | ต้องคุม boundary ด้วย lint rule |
| แยก `TrackingSessions` ออกจาก `WorkOrders` | ไม่มี pseudo work order · ไม่มี reserved seed rows · ไม่มี reopen loop | มี 2 แนวคิดที่ผู้ใช้ต้องเข้าใจ (session vs WO) |
| Session engine แบบ level-triggered sweep 30s | self-healing หลัง restart / DSS หลุด · idempotent | latency สูงสุด ≈ debounce + 1 รอบ |
| Smart Booking **push** ใบงานเข้า `POST /api/integration/booking/jobs` → `IntegrationInbox` · read API เป็น optional (DL46 แทน pull ของ DL31) | ใบงานมาถึงในระดับวินาที · งานปกติไม่ต้องเรียก API ของ Booking · เราเป็นเจ้าของ contract ขาเข้า (mapper `v1` / `smart-booking` กันโครงสร้าง Booking รั่วเข้า core) · `api` แค่บันทึก inbox แล้วตอบ ไม่ map เอง | ต้องเปิด endpoint ให้ระบบภายนอกเรียก ⇒ HMAC / API key + rate limit + firewall ขาเข้า + rotation secret 2 ชุด (`BOOKING_INBOUND_SECRETS`) · POST ที่หายกู้ได้เฉพาะเมื่อ Booking ส่งซ้ำ หรือ reconcile รายคืน (ถ้ามี read API) · ไม่รู้ว่า Booking ส่งไม่ออก ⇒ alert `BOOKING_INBOUND_SILENT` |
| Matching อ่าน projection `BookingJobs` | Booking ล่มไม่กระทบ · อธิบายย้อนหลังได้ (`MatchAttempts`) | ข้อมูลช้าเท่า backlog ของ inbox processor (ปกติไม่กี่วินาที · เกิน `booking.stale-after-minutes` ⇒ `ProjectionStale`) |
| Invariant บังคับที่ DB (partial unique, exclusion, CHECK) | race condition สร้างข้อมูลผิดไม่ได้ | ต้องมี `btree_gist` (มี fallback) |
| ใบงานมาจาก Booking เท่านั้น (`BookingJobId` NOT NULL — DL33) | ใบงานตรง Booking เสมอ · ไม่มีใบงานขยะ · ไม่มีงาน manual (link / void / คิวตรวจสอบ) | session ที่ Booking ไม่ระบุค้าง `AwaitingMatch` ไม่มีใบงาน — ดูหลักฐานจาก `/recordings` รายกล้อง |
| สถานะใบงานตาม Booking check-in/check-out | ไม่มีสองแหล่งความจริงเรื่องสถานะ | Booking ล่ม = ปิดใบงานช้า (ปิดย้อนหลังด้วยเวลาจริง) · ต้องมี SafetyTimeout |
| Matching อัตโนมัติอย่างเดียว (DL33) | ไม่มีคิวงานให้ Operator · ผลอธิบายได้จาก `MatchAttempts` | การผูกผิดแก้ได้ทางเดียวคือแก้ข้อมูลใน Booking |
| Mobile app เฉพาะหัวหน้าทีม `TEAM_LEADER` scope `team` (DL47) | ตรง requirement §4 · แอปเล็ก (live กล้องตัวเอง + ใบงานของทีม) · ข้อมูลอ่อนไหว (playback / GPS) อยู่บน web เท่านั้น | scope level ที่ 3 ต้องทดสอบ 404 ทุก endpoint ที่หัวหน้าทีมเรียก · ต้องผูก `Employees.UserId` และหัวหน้าใน `TeamMembers` ให้ถูก ไม่งั้นรายการว่าง |
| ไม่ push online/offline — หน้าจอดึงสถานะจาก DSS ตอนเปิด (DL35) ผ่าน cache Redis 10s (DL45) | สถานะที่เห็นสดกว่า GpsPoll · event น้อยลง · หลายคนเปิดพร้อมกันไม่ยิง DSS ซ้ำ | หน้าจอที่เปิดค้างไม่อัปเดตสถานะเอง · สถานะเก่าได้ ≤ 10s |
| ไฟล์ export MP4 บน Local disk PVC 24 ชม. (DL34) | ไม่ต้องดูแล object storage | ต้อง mount PVC ร่วม `api` + `worker-media` (R16) · ผู้ใช้ต้องดาวน์โหลดเก็บเองภายใน 24 ชม. |
| Partition GPS/Audit รายเดือน | retention = drop partition · query เร็ว | DDL partition ต้องเขียน custom migration |

## Assumptions หลัก

1. DSS middleware ชุดเดิม (`psd-bwc-dss-services` — [Confirmed]) · สถานะกล้องมาจาก `/location` (GpsPoll) ชุดเดียวกับ GPS (DL32)
2. **ทุกอย่างเกี่ยวกับ Smart Booking = Assumption** (ชื่อฟิลด์, payload, auth, retry, read API) จนกว่าทีม Booking ยืนยัน — ที่ **[Confirmed]** มีแค่ "POST ใบงานเมื่อสร้าง" และ "ใบงานมี DO / SH / check-in / check-out" (ดู [Part 7 §7.1](07-integration-strategy.md#71-confirmed-vs-assumption), [Part 9 §9.4](09-risks-open-questions.md#94-booking-information-checklist))
3. **Smart Booking POST ใบงานทั้งก้อนซ้ำทุกครั้งที่เปลี่ยน** (check-in, check-out, ยกเลิก, แก้ไข) ที่ endpoint เดิม = upsert **[Assumption]** — ถ้า POST เฉพาะตอนสร้าง สถานะใบงานจะตาม check-in / check-out ไม่ได้ ⇒ ข้อแรกของ checklist
4. **Booking ระบุกล้อง/ทีม/หัวหน้าทีมในใบงานได้** (`deviceRefs` / `teamRef` / `leaderRef` **[Assumption]**) **— ความเสี่ยงอันดับ 1** · ถ้าไม่ได้ session ค้าง `AwaitingMatch` / `NoTeam` (ไม่มีการผูกด้วยมือ — DL33)
5. DO / SH = เลข Delivery Order / Shipment **[Assumption]** — ใช้แสดงและค้นหาเท่านั้น
6. Auth ขาเข้า = HMAC-SHA256 (`BOOKING_INBOUND_AUTH=hmac`, ค่าเริ่มต้น) หรือ API key **[Assumption — ต้องตกลงกับ Booking]** · Booking retry เมื่อ timeout / non-2xx แบบ exponential backoff ≥ 24 ชม. และส่งซ้ำรายใบได้เมื่อขอ **[Assumption]**
7. PostgreSQL 16 managed รองรับ `btree_gist` + declarative partitioning
8. Vendor ไม่มีสถานะชาร์จ (ยืนยันแล้ว) — ตรวจกล้องที่ฐานด้วย `Depots` + fix ล่าสุด ⇒ session `IdleOrCharging`

---

## Recommended Architecture (สรุป)

```mermaid
flowchart LR
  subgraph Client["Clients"]
    WEB["Web SPA<br/>React + Vite + Tailwind"]
    MOB["Mobile app<br/>หัวหน้าทีม"]
  end
  subgraph Platform["PSD Body worn camera"]
    API["api<br/>REST · Socket.IO · Booking inbound"]
    WT["worker tracking<br/>poll · session sweep"]
    WI["worker integration<br/>inbox processor + WO upsert · matching · push"]
    WM["worker media<br/>MP4 export · recording index"]
    PG[("PostgreSQL")]
    RD[("Redis")]
    FS[("Local disk PVC<br/>ไฟล์ export MP4 24 ชม.")]
  end
  DSS["DSS middleware<br/>psd-bwc-dss-services"]
  DSV["Dahua DSS Platform<br/>วิดีโอ 3 เดือน"]
  BK["Smart Booking"]
  WEB --> API
  MOB --> API
  BK -- "POST ใบงาน" --> API
  API --> PG
  API <--> RD
  WT --> PG
  WI --> PG
  WM --> PG
  WT <--> RD
  WI <--> RD
  WM <--> RD
  WM --> FS
  API --> FS
  WT --> DSS
  API --> DSS
  WM --> DSS
  DSS --> DSV
  WI -. "read API ถ้ามี" .-> BK
```

- **Real-time path** (DSS `/location` → GPS + สถานะ → `DeviceState` ภายใน + `gps:batch` → Socket.IO) และ **session engine** ไม่เรียก Booking · ไม่ push online/offline — หน้าจอดึงสถานะจาก DSS ตอนเปิดผ่าน `api` (DL35) ซึ่ง cache ผลไว้ใน Redis 10s (DL45)
- **Redis** = Socket.IO adapter / emitter · lock · rate limit · BullMQ · circuit breaker · cache สถานะกล้องบนหน้าจอ — ไม่ใช่ cache ข้อมูลทั่วไป
- **Booking path** (DL46): Smart Booking POST → `api` ตรวจ auth + validate → `INSERT IntegrationInbox` (`Channel = 1 Push`, `ON CONFLICT DO NOTHING`) → ตอบ 202 / 200 duplicate (ไม่แตะ `BookingJobs` / `WorkOrders`) → worker integration: inbox processor map (`BookingInboundMapper`) + projection + upsert WO 1:1 (DL33) → queue `matching` · read API (`fetchJob` / `fetchWindow` — ปุ่ม refresh + reconcile รายคืน) เป็น optional มี circuit breaker · `BOOKING_PROVIDER_DRIVER=none` (ค่าเริ่มต้น) ปิดทั้งสองอย่าง
- **Mobile path** (DL47): แอปหัวหน้าทีมเรียก `/mobile/me`, `/mobile/jobs`, `/streams/live` ผ่าน `api` ภายใต้ scope `team` · push FCM "ใบงานใหม่ของทีม" · room `team:{id}`
- **ไฟล์ export MP4**: `worker-media` เขียนลง Local disk PVC · `api` stream ให้ดาวน์โหลดด้วย download ticket · ลบหลัง 24 ชม. (DL34)
- **กติกาหลัก**: session engine เป็น writer เดียวของ lifecycle session · ทุก write ต่ออุปกรณ์ถือ row lock `DeviceState` · emit realtime หลัง commit

## Recommended Database Schema (สรุป)

34 ตาราง แบ่งกลุ่ม (รายละเอียด [Part 4](04-database-design.md)) · DL46–DL47 ไม่เพิ่มตาราง:

| กลุ่ม | ตาราง |
|---|---|
| Identity & Access | `Departments`, `Employees`, `Users`, `Roles`, `Permissions`, `RolePermissions`, `RefreshTokens`, `UserDevices`, `PushTokens` |
| Teams | `Teams`, `TeamMembers` |
| Devices | `Devices`, `DeviceState`, `DeviceStatusHistory`, `DeviceAssignments`, `Depots` |
| Tracking | `GpsLocations` (partitioned), `TrackingSessions`, `RecordingSegments` |
| Work Orders | `WorkOrders`, `WorkOrderEvents`, `WorkOrderCounters` |
| Booking Integration | `BookingJobs` (+ `DoNo`, `ShNo`), `MatchAttempts`, `IntegrationInbox` (+ `Channel`: 1 Push · 2 Reconcile · 3 CsvImport · 4 Refresh), `IntegrationSyncState` (`LastReceivedAt` แทน `Cursor`), `IntegrationCallLogs` (`Direction = 2 Inbound` สำหรับ POST) |
| Media | `StreamingSessions`, `TalkSessions`, `EvidenceExports` |
| System | `Alerts`, `Notifications`, `AuditLogs` (partitioned), `Settings` |

Role `TEAM_LEADER` และ scope `team` เพิ่มผ่าน data migration (`Roles` / `RolePermissions`) ไม่มีตารางใหม่ · หัวหน้าทีมต้องผูก `Employees.UserId` (บังคับใน service — DL47)

Invariant สำคัญที่ DB บังคับ:
- `UQ_TS_OpenPerDevice` + `EX_TS_NoOverlap` — 1 session เปิดต่ออุปกรณ์ ไม่ซ้อนเวลา
- `UQ_WO_BookingJob` — 1 Booking ↔ 1 WO (`BookingJobId` NOT NULL · ใบงานมาจาก Booking เท่านั้น — DL33)
- `UQ_TeamMembers_ActiveLeader` · `UQ_DevAsg_TeamActivePrimary` · `EX_DevAsg_NoOverlap`
- `UQ_Inbox_Event` — idempotency ของ integration (POST ซ้ำด้วย `ExternalEventId` เดิม ⇒ 200 `duplicate`)

## Implementation Plan (สรุป)

| Phase | ผลลัพธ์ | Priority |
|---|---|---|
| P0 Foundation | scaffold, port infra, auth + Entra, RBAC/scope, migrations, CI, shell + design system | Must |
| P1 Devices & Tracking | device sync, status/GPS ingest, Teams + assignments, live map, GPS history (Must — DL48) | Must |
| P2 Sessions & Work Orders | session engine (`AwaitingMatch` / `IdleOrCharging`), sessions page, WO UI (ใบงานจาก `booking-simulator`) | Must |
| P3 Booking Integration | P3a inbound endpoint `POST /api/integration/booking/jobs` + inbox + mapper `v1` + simulator → projection + upsert WO 1:1 · P3b matching อัตโนมัติ + rematch · P3c Smart Booking go-live: ตกลง contract/auth, mapper `smart-booking` ถ้าจำเป็น, read API adapter (optional), pilot (**ติด Booking spec gate**) | Must |
| P4 Media | live, playback, recordings, หลักฐาน `/evidence` + MP4 export (Local disk PVC), live wall, talk (Must — DL48) | Must |
| P5 Mobile app (หัวหน้าทีม) API & Notifications | role `TEAM_LEADER` + scope `team`, `/mobile/me`, `/mobile/jobs`, live กล้องของทีม, push "ใบงานใหม่ของทีม" (FCM), device registry (ไม่มี PIN) (DL47) | Must |
| P6 Hardening & Go-live | retention 3/12 เดือน, observability, security (รวม inbound endpoint), load test, ตั้ง master data ใหม่, UAT | Must |

Critical path: P0 → P1 → P2 → P3 → P6 · ไม่มี Booking ก็ขึ้นระบบได้ในโหมด tracking + live + ค้นหลักฐานรายกล้อง (`/recordings`) — ใบงานจะมีเมื่อ Smart Booking เริ่ม POST (DL33, DL46)

**สิ่งที่ต้องทำต่อทันที**: ส่ง [checklist §9.4](09-risks-open-questions.md#94-booking-information-checklist) + draft contract ขาเข้า v1 ([Part 7](07-integration-strategy.md)) ให้ทีม Smart Booking · เริ่ม P0 และ P3a (inbound endpoint + simulator) ได้ทันที
