# Part 2 — Proposed System Architecture

---

## 2.1 Architecture Style: Modular Monolith

| เกณฑ์ | Modular Monolith (เลือก) | Microservices |
|---|---|---|
| ขนาดทีม / ระบบ | เหมาะกับทีมเล็ก กล้อง 100–300 ตัว | overhead สูงเกินขนาดงาน |
| Reuse จาก reference | port โค้ด NestJS เดิมได้ตรง (`server/src/common/*`, auth, tracking, streaming) | ต้องแตกโค้ดเดิมใหม่ทั้งหมด |
| Transaction ข้าม domain | session + work order + events อยู่ใน transaction เดียวได้ | ต้องใช้ saga/distributed tx |
| Failure isolation | ได้จาก **process role + queue แยก + circuit breaker** (ดู 2.6) | ได้โดยธรรมชาติ |
| การ scale | แยก worker role เป็น pod ได้ด้วย env โดยไม่แก้โค้ด | scale รายบริการ |

**ข้อสรุป**: Modular Monolith บน NestJS · 1 codebase · หลาย process role · boundary ชัดเจนระดับ module (ห้าม import ข้าม boundary ที่กำหนด) · แตกเป็น service ได้ภายหลังถ้าจำเป็น (Booking Integration เป็นตัวแรกที่แตกได้ เพราะคุยกับส่วนอื่นผ่าน table + queue อยู่แล้ว)

---

## 2.2 System Context

```mermaid
flowchart TB
  subgraph Users["ผู้ใช้"]
    OPS["Admin / Operator<br/>Web browser"]
    LEAD["Operator / Admin<br/>Mobile app"]
    TL["หัวหน้าทีม<br/>Booking app"]
  end
  subgraph Sys["PSD Body worn camera (ระบบใหม่)"]
    CORE["PSD Body worn camera<br/>NestJS API + Workers"]
    DISK[("Local disk (PVC)<br/>MP4 export ชั่วคราว 24 ชม.")]
  end
  subgraph Ext["ระบบภายนอก"]
    BOOK["Booking System<br/>ต้นทางใบงาน"]
    DSSMW["DSS middleware<br/>psd-bwc-dss-services · FastAPI"]
    DSSSRV["Dahua DSS Platform<br/>วิดีโอหลักฐาน 3 เดือน"]
    ENTRA["Microsoft Entra ID<br/>SSO"]
    FCM["Firebase Cloud Messaging"]
  end
  CAM["Bodycam devices"]
  OPS -- "HTTPS REST + Socket.IO" --> CORE
  LEAD -- "HTTPS REST + push" --> CORE
  TL -- "check-in / check-out" --> BOOK
  CORE -- "pull sync (change feed / reconcile)" --> BOOK
  CORE -- "devices, location, stream, playback, talk" --> DSSMW
  DSSMW -- "DSS API · HLS · RTSP talk" --> DSSSRV
  CORE -- "OIDC id_token verify" --> ENTRA
  CORE -- "push" --> FCM
  CORE -- "เขียน / อ่านไฟล์ export" --> DISK
  CAM -- "4G" --> DSSSRV
```

ขอบเขต: ระบบใหม่ **ไม่คุยกับกล้องโดยตรง** (เหมือน reference) และ **ไม่สร้างใบงานเอง** — ใบงานทุกใบมาจาก Booking (DL33)

- **DSS มี 2 ชั้น [Confirmed — reference `docs/LIVE-STREAMING-CONTRACT.md`]**: ระบบเราเรียก DSS middleware (`psd-bwc-dss-services`, FastAPI) เท่านั้น แล้ว middleware เรียก Dahua DSS Platform (VMS กล้องของ Dahua) อีกชั้น · token / URL / session ของ DSS Platform ไม่ออกจาก middleware · HLS URL ที่ได้ชี้กลับ `/proxy` ของ middleware · talk เป็น RTSP ระหว่าง middleware กับ DSS Platform · กล้องลงทะเบียนกับ DSS Platform ผ่าน 4G · ทั้ง DSS middleware และ Dahua DSS Platform ติดตั้งใน **PSD on-premise** (DL40)
- วิดีโอหลักฐานต้นฉบับอยู่บน Dahua DSS Platform (retention 3 เดือน ฝั่ง infra) · ระบบเราเก็บเฉพาะไฟล์ MP4 ที่ export ชั่วคราวบน Local disk (PVC) — ไม่มี MinIO / object storage (DL34)

---

## 2.3 Container & Deployment

```mermaid
flowchart LR
  subgraph Edge["Ingress / LB"]
    ING["TLS termination<br/>ทุก path → web"]
  end
  subgraph App["Kubernetes namespace team3"]
    SPA["web: nginx<br/>React SPA static<br/>proxy /api/ · /api/talk/ws · /socket.io/"]
    API1["api pod x N<br/>REST · Socket.IO · talk WS"]
    WT["worker-tracking x 1<br/>GpsPoll · SessionSweep"]
    WI["worker-integration x 1..N<br/>Booking sync · inbox + upsert WO · matching · push"]
    WM["worker-media x 1..N<br/>evidence export ffmpeg · recording index"]
  end
  subgraph Data["Data"]
    PG[("PostgreSQL 16<br/>+ btree_gist")]
    RD[("Redis 7<br/>adapter · locks · BullMQ · breaker")]
    FS[("Local disk (PVC)<br/>MP4 export ชั่วคราว")]
  end
  ING --> SPA
  SPA -- "BACKEND_URL" --> API1
  API1 --> PG
  API1 <--> RD
  WT --> PG
  WT <--> RD
  WI --> PG
  WI <--> RD
  WM --> PG
  WM <--> RD
  WM -- "เขียนไฟล์" --> FS
  API1 -- "stream ดาวน์โหลด" --> FS
```

- **Process roles** จาก codebase เดียว: `main.api.ts` และ `main.worker.ts` + env `WORKER_ROLES` (`tracking`, `integration`, `media` — ใส่หลายค่าคั่นด้วย comma ได้) · dev/pilot รัน worker ตัวเดียว `WORKER_ROLES=tracking,integration,media`
- `worker-tracking` ต้องมี **1 instance ที่ active** (Redis lock กันซ้ำอยู่แล้ว แต่ไม่ได้ประโยชน์จากการ scale)
- `worker-integration` / `worker-media` scale แนวนอนได้ (BullMQ consumers)
- Redis ต้องมี persistence (AOF) และใช้ร่วมระหว่าง API กับ worker (key prefix ต่อ environment — port `lock-key.ts` ของ reference)
- `worker-media` image ต้องมี ffmpeg · migrate เป็น job แยกก่อน rollout
- **กันงานแปลงไฟล์แย่งเครื่อง (DL39)** — สำคัญเป็นพิเศษเพราะ `api` กับ worker อยู่บน PSD Server เครื่องเดียวกัน (DL44): การแยก process ยังกัน event loop, crash และ deploy ไม่ให้ลากกัน แต่ CPU / RAM / network / disk ยังใช้ร่วมกัน จึงต้องคุมเพิ่ม
  - Kubernetes `resources` แยกต่อ container: `worker-media` ตั้ง `limits` (เริ่มที่ CPU 1 core / memory 1 GiB แล้วปรับตามโหลดจริง) · `api` ตั้ง `requests` กัน CPU / memory ไว้ให้เสมอ
  - จำกัดงานแปลงพร้อมกันของ queue `evidence-export` ด้วย env `EVIDENCE_EXPORT_CONCURRENCY` (port จาก reference: default 1, สูงสุด 8) · งานที่เกินรอคิว · timeout ต่องาน `EVIDENCE_EXPORT_TIMEOUT_MINUTES` (default 180)
  - ffmpeg ใช้ `-c:v copy` (ไม่ encode วิดีโอใหม่) จึงกิน CPU น้อย — ภาระหลักคือ network (ดึง segment จาก DSS) กับ disk (เขียน MP4) · คิวยาวให้เพิ่ม pod `worker-media` (× 1..N) แทนการเพิ่ม concurrency ในเครื่องเดียว
- **ไฟล์ export (DL34)**: Local disk (PVC, `STORAGE_DRIVER=local`) mount ทั้ง `api` และ `worker-media` — `worker-media` เขียนไฟล์ MP4, `api` stream ให้ดาวน์โหลดผ่าน download ticket · ลบไฟล์หลัง 24 ชม. (`EvidenceCleanup`) แต่เก็บแถว `EvidenceExports` 12 เดือน · ไม่มี MinIO / object storage · ตอนนี้มี node เดียว (PSD Server) ใช้ PVC แบบ ReadWriteOnce ได้ · ถ้าเพิ่ม node ภายหลังต้องเป็น ReadWriteMany (Part 9 R16)
- **เส้นทาง HTTP เหมือนระบบเดิมที่รันอยู่** (`psd-bwc-frontend`): ingress ส่งทุก path ไปที่ container `web` แล้ว nginx ของ `web` proxy `/api/`, `/api/talk/ws` (WebSocket ดิบของ talk) และ `/socket.io/` ต่อไปที่ API ผ่าน env `BACKEND_URL` (`scheme://host:port` ไม่มี path) — ดู `client/nginx.conf` · หน้าเว็บกับ API จึงเป็น same-origin (`VITE_API_BASE=/api`) ไม่ต้องตั้ง CORS / `COOKIE_SAMESITE` ข้ามโดเมน
  - container `web` ไม่ยอม start ถ้าไม่มี `BACKEND_URL` หรือมี path (`client/docker-entrypoint.d/15-require-backend-url.sh`)
  - API อยู่หลัง proxy 2 ชั้น (ingress + nginx ของ `web`) ⇒ ตั้ง `TRUST_PROXY=2` หรือช่วง IP ของ pod / ingress — ค่าเริ่มต้น `loopback` ใช้ไม่ได้บน Kubernetes (`req.ip` จะเป็น IP ของ nginx ทุกคำขอ)
  - ลำดับปล่อยเวอร์ชัน: API ก่อน `web` เสมอ
- **Namespace = `team3` เดิม (DL41)** — namespace ของทีมที่ระบบเดิม (`psd-bwc-frontend`, `psd-bwc-web-backend`) ใช้อยู่ ไม่ใช่ชื่อระบบ · ระบบนี้ deploy ร่วมใน namespace เดียวกัน
  - ชื่อ Deployment / Service ต้องไม่ชนกับของระบบเดิม (`psd-bwc-*`) · ชื่อจริงกำหนดใน gitops
  - `BACKEND_URL` ของ `web` = `http://<api-service>.team3.svc:3000`
  - quota CPU / memory ของ namespace ใช้ร่วมกับระบบเดิม ⇒ `requests` / `limits` ตาม DL39 ต้องตั้งให้ครบทุก container
- **ทั้งระบบอยู่ใน PSD on-premise (DL43)** — อยู่ใน data center ของ PSD **2 VM (DL44)**
  - **PSD Server** (VM Ubuntu · `xxx.xxx.x.xx`) เครื่องเดียวรัน Kubernetes namespace `team3` (web / api / worker-\*), data tier (PostgreSQL / Redis / PVC) และ DSS middleware (systemd นอก K8s)
  - **Dahua DSS Platform** (VM Windows · `xxx.xxx.x.xx`) อยู่คนละเครื่อง
  - PSD Server เป็น single point of failure (Part 9 R17) ⇒ backup PostgreSQL ต้องเก็บนอกเครื่อง
  - นอก on-prem: ผู้ใช้ (browser / mobile), Microsoft Entra ID, FCM, Booking System (ตำแหน่ง **[Assumption]**) และกล้องที่ต่อเข้ามาทาง 4G
  - firewall ขาออกจาก cluster ต้องเปิด: Entra ID (JWKS / OIDC), FCM HTTP v1, Booking API · ขาเข้า: HTTPS ที่ ingress
- DSS middleware (`psd-bwc-dss-services`, FastAPI) รันเป็น systemd บน **PSD Server** เครื่องเดียวกับ K8s (นอก cluster) ได้ instance เดียว (`WORKERS=1`, state อยู่ใน memory) — API และ worker เรียกผ่าน HTTP ภายในเครื่อง (`xxx.xxx.x.xx:3004`, ไม่ออก network) แล้ว middleware เรียก Dahua DSS Platform อีกเครื่องต่อ (§2.2) · ถ้าแยก middleware ไปเครื่องอื่นภายหลัง talk ต้องเข้ารหัส (TLS / VPN) · diagram infra ดู `docs/diagrams/infrastructure.drawio`

---

## 2.4 Module Map

```mermaid
flowchart TB
  subgraph Interface["Interface layer (api process)"]
    REST["REST controllers"]
    GW["RealtimeGateway<br/>Socket.IO /realtime"]
    TALKWS["Talk WebSocket"]
  end
  subgraph Domain["Domain modules"]
    AUTH["auth"]
    USERS["users + roles"]
    ORG["org: departments, employees"]
    TEAMS["teams"]
    DEV["devices + device-assignments"]
    DSTAT["device-status<br/>observation ingest"]
    TRK["tracking<br/>GPS pipeline + history"]
    SES["sessions<br/>session engine"]
    WO["work-orders<br/>WO จาก Booking + matching อัตโนมัติ"]
    BKG["booking-integration<br/>adapter · projection · inbox · pull sync"]
    MEDIA["streaming + evidence + talk"]
    NOTI["notifications + alerts"]
    DASH["dashboard"]
  end
  subgraph Common["common (global)"]
    C1["db · scope · settings · lock · queue · rate-limit"]
    C2["audit · context · storage · push · realtime-bus · vendor clients"]
  end
  REST --> AUTH & USERS & ORG & TEAMS & DEV & TRK & SES & WO & BKG & MEDIA & NOTI & DASH
  DSTAT --> DEV
  TRK --> DEV
  SES --> DEV & TEAMS & WO
  WO --> TEAMS
  WO -. "อ่าน BookingJobs (read-only)" .-> BKG
  BKG -- "upsert WO 1:1 (DL33)" --> WO
  BKG -. "queue: matching.rematch" .-> WO
  WO --> NOTI
  SES --> NOTI
  Domain --> Common
  GW --> Common
```

### หน้าที่ของแต่ละ module

| Module | Responsibility | Reuse จาก reference |
|---|---|---|
| `auth` | login password + Entra SSO, refresh rotation, lockout, ทะเบียนเครื่องมือถือ (ไม่มี PIN) | `modules/auth` เกือบทั้งหมด |
| `users` | ผู้ใช้, role, role-permission matrix, ระงับบัญชี (`cutAllSessions`) | `modules/users` (ตัด company) |
| `org` | departments (tree), employees, link employee ↔ user, `BookingEmployeeRef` | `departments`, `employees` |
| `teams` | ทีม, สมาชิก, เปลี่ยนหัวหน้าทีม (ประวัติ), `BookingTeamRef` | ใหม่ |
| `devices` | ทะเบียน bodycam, vendor sync (`device-sync.plan.ts`), streaming toggle, Depots · การผูกกล้อง → ทีม **อ่านจาก Booking sync เท่านั้น** (ไม่มีหน้าจอผูกเอง — Q20) · สถานะกล้องที่แสดงบนหน้าจอ `api` ถาม DSS middleware ตอน request (DL35) | `devices`, `device-assignments` (refactor เป็น read-only projection) |
| `device-status` | **Device Event Processing**: รับ observation จาก GpsPoll (`/location` ให้ทั้ง GPS และ online/offline — DL32) → `DeviceState` + `DeviceStatusHistory` ให้ session engine ใช้ภายใน · ไม่ push สถานะขึ้นหน้าจอ (ไม่มี `device:status` — DL35) · ไม่มี business logic | แยกจาก `GpsPoll.applyVendorStatuses` (ไม่ port `brms-mq.service.ts` — DL30) |
| `tracking` | GPS ingestion pipeline (`ingestLocations`), positions snapshot, route history | `modules/tracking` (ตัด road-match) |
| `sessions` | **Session engine** (sweep, pure `decide()`, open/close/split) · เป็น writer เดียวของ lifecycle session · ไม่สร้างใบงาน — match ไม่ได้ ⇒ session ค้าง `AwaitingMatch` / `NoTeam` · กล้องชาร์จที่ฐาน ⇒ ระบบตั้ง `Classified` + `IdleOrCharging` · recording index | ใหม่ (แทน `camera-session.service.ts`) |
| `work-orders` | WO **1:1 กับ `BookingJobs`** สร้าง/อัปเดตจาก Booking sync เท่านั้น (inbox processor เรียก writer ของ module นี้ — DL33) · สถานะตาม Booking (check-in / check-out / ยกเลิก) · **matching อัตโนมัติ** attach session เข้า WO ของ Booking job (อ่าน `BookingJobs`) · read model ใบงาน (list/detail, หน้า หลักฐาน) · mobile overview · ไม่มี link / unlink / merge / void / คิวตรวจสอบ (DL33) | ใหม่ |
| `booking-integration` | Booking provider port + adapters (`mock`, `http`), sync แบบ pull อย่างเดียว (incremental/full/fetch รายใบ — DL31), inbox processor (upsert `BookingJobs` + `WorkOrders` 1:1 ใน transaction เดียว), circuit breaker, mapping, monitoring endpoints | ใหม่ (ใช้ pattern provider/driver ของ reference) |
| `streaming` / `evidence` / `talk` | live, playback, recording search, MP4 export (ไฟล์บน Local disk PVC — DL34 · ช่วงเดิมที่ยังใช้ได้ ⇒ reuse job เดิม — DL36), two-way talk, quota, role/device access | port ทั้งหมด |
| `notifications` | alert engine (dedupe), in-app inbox, FCM push via BullMQ | port + alert types ใหม่ |
| `dashboard` | overview cards | refactor |
| `realtime` | Socket.IO gateway, rooms, auth, emitter จาก worker | port |
| `audit-logs`, `settings`, `health` | ตาม reference + health ของ Redis/integration | port + ขยาย |

### กติกา dependency (บังคับด้วย lint rule `no-restricted-imports` หรือ dependency-cruiser)

1. `booking-integration` **ห้าม import** `sessions` และ matcher ของ `work-orders` — ส่งงาน match ต่อผ่าน BullMQ queue `matching` เท่านั้น · ข้อยกเว้นเดียว: inbox processor เรียก writer ของ `work-orders` เพื่อ upsert `WorkOrders` 1:1 กับ `BookingJobs` (+ สถานะตาม Booking) ใน transaction เดียวกับ projection — writer นี้ lock แค่แถว `WorkOrders` ไม่แตะ session / `DeviceState` (DL33)
2. `work-orders` อ่าน `BookingJobs` ผ่าน `BookingReadModel` (read-only repository ของ `work-orders` เอง — ไม่ import `booking-integration` จึงไม่เกิด import วน) — ไม่เรียก Booking API
3. `tracking` / `device-status` / `sessions` **ห้ามเรียกระบบภายนอกที่ไม่ใช่ vendor กล้อง** — real-time path ไม่ขึ้นกับ Booking
4. ทุก write ที่แตะ session ของอุปกรณ์ต้องถือ row lock `DeviceState` ของอุปกรณ์นั้น (lock order: `DeviceId` จากน้อยไปมาก → `WorkOrders` → `TrackingSessions`)
5. Worker-only modules (`scheduler` timers, BullMQ processors) ห้าม import เข้า `AppModule` (กติกาเดิมของ reference)

---

## 2.5 Data Flows

### (A) Real-time tracking — ไม่แตะ Booking

```mermaid
flowchart LR
  DSS["DSS middleware"] -- "/location ต่อเครื่อง<br/>GPS + online/offline" --> GP["GpsPoll 15s"]
  GP --> TRK["tracking<br/>ingestLocations"]
  GP -- "online/offline" --> DS["device-status<br/>applyObservation"]
  TRK --> DS
  DS --> PG[("DeviceState<br/>DeviceStatusHistory")]
  TRK --> GPS[("GpsLocations")]
  TRK -- "gps:batch" --> BUS["Redis emitter"]
  BUS --> GW["Socket.IO"] --> WEB["Map (ตำแหน่งสด)"]
```

- สถานะ online/offline **ไม่ถูก push ขึ้นหน้าจอ** (ไม่มี `device:status` — DL35) · `DeviceState` ใช้ภายในโดย session engine · หน้าจอที่แสดงสถานะกล้อง (รายการ/รายละเอียดอุปกรณ์, ก่อนเปิด live) ให้ `api` ถาม DSS middleware ตอนเปิดหน้า

### (B) Session → Work Order ของ Booking job

```mermaid
flowchart LR
  SW["SessionSweep 30s<br/>per device FOR UPDATE"] -- "decide()" --> TS[("TrackingSessions")]
  SW -- "match" --> M["Matcher<br/>work-orders"]
  M -- "read" --> BJ[("BookingJobs projection")]
  M -- "attach เมื่อได้ candidate เดียว" --> WO[("WorkOrders + WorkOrderEvents<br/>มีอยู่แล้วจาก Booking sync")]
  M -- "record" --> MA[("MatchAttempts")]
  M -. "ไม่มี / หลาย candidate" .-> AW["session ค้าง AwaitingMatch / NoTeam<br/>รอ matching.rematch"]
  WO -- "workorder:changed" --> RT["Realtime + Alerts + Push"]
```

- เส้นทาง session **ไม่สร้างใบงาน** — ใบงานเกิดจาก Booking sync เท่านั้น (flow C · DL33) · ไม่มีการ link / override ด้วยมือ · rematch อัตโนมัติเมื่อข้อมูล Booking เปลี่ยน ภายใน `booking.rematch-horizon-hours`

### (C) Booking sync — pull อย่างเดียว (DL31), แยก queue, มี breaker · ทางเดียวที่สร้างใบงาน (DL33)

```mermaid
flowchart LR
  SCH["repeatable job<br/>incremental 2m / full nightly"] --> SYNC["booking-sync worker"]
  REF["api: ปุ่ม refresh<br/>fetchJob"] -- "HTTP" --> BOOK
  SYNC -- "HTTP via breaker" --> BOOK["Booking System"]
  SYNC -- "INSERT dedupe" --> IN[("IntegrationInbox")]
  REF --> IN
  IN --> PROC["inbox processor"]
  PROC -- "upsert + version guard" --> BJ[("BookingJobs")]
  PROC -- "upsert 1:1 + สถานะตาม Booking<br/>transaction เดียวกัน" --> WO[("WorkOrders")]
  PROC -- "enqueue rematch" --> Q["queue: matching"]
  Q --> WOM["work-orders matcher<br/>attach session"]
```

- ทุกแถว `BookingJobs` มี `WorkOrders` 1 แถว (`UQ_WO_BookingJob`) · sync ยังไม่ check-in ⇒ Planned (DL37) · check-in ⇒ Open · check-out ⇒ Closed (`BookingCheckout`) · Booking ยกเลิก ⇒ Cancelled (ยังดูหลักฐานได้) · emit `workorder:changed` หลัง commit

### (D) Streaming

Browser → `POST /api/streams/live` → `StreamingService` ตรวจสิทธิ์สด + scope + `StreamingEnabled` + quota → ขอ URL จาก DSS middleware (ชี้กลับ `/proxy` ของ middleware) → seal AES-GCM → browser เล่นผ่าน proxy `/api/streams/:token/playlist.m3u8` (port จาก reference ทั้ง flow)

Evidence (หน้า หลักฐาน `/evidence` — DL36): เลือกใบงาน → กล้อง + ช่วงเวลาจาก session ของใบงาน → playback หรือ `POST /api/evidence-exports` (device + channel + start/end เดิมที่ยัง queued / processing / ready ไม่หมดอายุ ⇒ ใช้ job เดิม) → `worker-media` ดึง HLS → ffmpeg → เขียน MP4 ลง Local disk (PVC) → ดาวน์โหลดผ่าน ticket จาก `api` (DL34)

---

## 2.6 Failure Isolation

| สิ่งที่ล่ม | ผลกระทบ | สิ่งที่ยังทำงาน | กลไก |
|---|---|---|---|
| **Booking API** | sync หยุด, projection เก่าลง, ไม่มีใบงานใหม่ | tracking, session, match กับ projection เดิม, live/playback ทั้งหมด | circuit breaker (Redis) · retry backoff · banner "ข้อมูล Booking ไม่เป็นปัจจุบัน" · session ที่ match ไม่ได้ระหว่างนั้นค้าง `AwaitingMatch` แล้ว rematch อัตโนมัติหลัง Booking กลับมา (full reconcile เมื่อ breaker ปิด) |
| Booking ช้า (timeout) | job ของ queue `booking-*` ช้า | ทุกอย่างนอก queue นั้น | timeout 8s · concurrency จำกัด · อยู่คนละ worker role |
| DSS middleware / Dahua DSS Platform | ไม่มี status/GPS ใหม่, live/playback ใช้ไม่ได้, หน้าจอดึงสถานะกล้องไม่ได้ (DL35) | หน้าจอ, WO เดิม, Booking sync | สถานะอุปกรณ์กลายเป็น UNKNOWN (คำนวณจากอายุข้อมูล) · session **ไม่ถูกปิดทันที** (hold ≤ `session.unknown-max-minutes`) |
| Redis | ไม่มี realtime จาก worker, ไม่มี lock, queue หยุด | REST API, DB | health check แจ้ง · worker-tracking หยุด sweep เมื่อ lock ไม่ได้ (fail-safe) |
| worker-tracking | ไม่มี session ใหม่ / ไม่มี GPS ใหม่ | UI, Booking sync | level-triggered sweep ⇒ เมื่อกลับมา คำนวณใหม่จาก state ปัจจุบันได้เอง |
| PostgreSQL | ระบบหยุด | — | managed HA + backup (นอกขอบเขต design นี้) |

---

## 2.7 Worker Jobs & Queues

| Role | Job | กลไก | ความถี่ | Lock / Concurrency |
|---|---|---|---|---|
| tracking | `GpsPoll` (DSS `/location` → GPS + online/offline — DL32) | timer | 15s (setting) | lock `gps:poll` · concurrency 8 |
| tracking | `SessionSweep` (open/close/split session · pass ระดับ WO: alert ไม่มี check-out 36 ชม. / ปิด `SafetyTimeout` 7 วัน — ไม่สร้างใบงาน) | timer | 30s | lock `session:sweep` · ทุกอุปกรณ์ ORDER BY Id แบ่งหน้า |
| tracking | `AlertSweep` (offline during work, stale Booking) | timer | 60s | lock `alert:sweep` |
| integration | `booking-sync` incremental / full | BullMQ repeatable | 2 นาที / รายคืน 02:00 | concurrency 1 · ข้ามเมื่อ breaker เปิด |
| integration | `booking-inbox` (upsert `BookingJobs` + `WorkOrders` 1:1) | BullMQ | ทันที | concurrency 4 · ต่อ job ใช้ version guard |
| integration | `matching` (rematch session → WO อัตโนมัติ) | BullMQ `jobId` dedupe ต่อทีม+ช่วงเวลา | ทันที | concurrency 2 |
| integration | `notification-push` | BullMQ | ทันที | port |
| media | `evidence-export` | BullMQ | ทันที | concurrency `EVIDENCE_EXPORT_CONCURRENCY` (default 1, ≤ 8 — DL39) · ffmpeg · เขียนไฟล์ลง Local disk PVC (DL34) |
| media | `recording-index` | BullMQ repeatable | session เปิด: ทุก 30 นาที · ปิดแล้ว: 30 นาทีหลังจบ | concurrency 2 |
| media | `StreamIdle` / `TalkIdle` / `EvidenceCleanup` | timer | 60s | port |
| tracking | `PartitionMaintenance` / `Retention` (GPS 3 เดือน, ใบงาน 3 เดือน, audit 12 เดือน, แถว `EvidenceExports` 12 เดือน · ไม่มี archive) | BullMQ repeatable | รายวัน | lock |

หลักคิด: งานความถี่สูงที่ level-triggered (poll/sweep) ใช้ timer + Redis lock (แบบ reference — ง่าย, self-healing) · งานที่ต้อง retry/durable ใช้ BullMQ

---

## 2.8 Authentication / Authorization Layer

- **Guard chain** (port): `JwtAuthGuard` → `RateLimitGuard` → `PermissionsGuard` + `AuditInterceptor` · secure by default (`@Public()` เท่านั้นที่เปิด)
- **Roles** (บริษัทเดียว):

| Role | Data scope | ใช้ทำอะไร |
|---|---|---|
| `ADMIN` | all | ทุกอย่าง รวม settings, integration, roles |
| `OPERATOR` | department (รวมแผนกย่อย) | ศูนย์ควบคุม (web + mobile): เฝ้าดู (แผนที่/live/live wall/talk), playback / export หลักฐาน, จัดการทีม, ack alert · ไม่มีคิวตรวจสอบ / link / classify (DL33) |
| `VIEWER` | department | อ่านอย่างเดียว |

- `OPERATOR` แทน `SUPERVISOR` + `DISPATCHER` ของ reference — ระบบใหม่ไม่มีงานสร้าง/อนุมัติ/มอบหมายใบงาน จึงไม่ต้องแยก 2 บทบาท (Part 9 DL14)
- **ไม่มีการสร้าง/ปิด/reopen/void ใบงานโดยคนในระบบนี้** — ใบงานทุกใบมาจาก Booking และเปลี่ยนสถานะตาม check-in / check-out / ยกเลิกของ Booking (หัวหน้าทีม/แอดมินทำฝั่ง Booking) **[Confirmed — DL13, DL15, DL33]**
- **ไม่มี role หัวหน้าทีม** — แอปมือถือสำหรับ Operator/Admin/Viewer (monitoring + ตรวจหลักฐาน) **[Confirmed — DL16]**

- **Scope** port `server/src/common/scope/*` แล้วเปลี่ยน level เป็น `all` / `department` (subtree ด้วย recursive CTE + cache 60s) · นอก scope = 404 (กติกาเดิม)
- Permission catalog ดู [05-api-design.md §5.7](05-api-design.md#57-permission-catalog)
- **Service-to-service**:
  - Booking → เรา: ไม่มี — เชื่อมแบบ pull อย่างเดียว (DL31)
  - เรา → Booking: OAuth2 client credentials หรือ API key ตามที่ Booking กำหนด **[Assumption]** · token cache + refresh ก่อนหมดอายุ
  - เรา → DSS middleware: `DssAuth` เดิม (token cache 10 นาที, re-login เมื่อ 401) · token ของ Dahua DSS Platform อยู่ใน middleware เท่านั้น **[Confirmed]**

---

## 2.9 Security & Reliability

| หัวข้อ | การออกแบบ |
|---|---|
| Authentication | JWT 15 นาที + refresh rotation (reuse ⇒ revoke ทั้งหมด) · Entra SSO · lockout ปรับได้ใน Settings · ระงับบัญชีตัด session ทันที (`cutAllSessions` + `session:revoked`) |
| RBAC + data scope | permission ต่อ endpoint + scope ที่ query layer · action ที่ sensitive (live, talk, export) ตรวจสิทธิ์สดจาก DB (`PermissionCheckService.hasPermissionNow`) |
| API security | `ValidationPipe({whitelist, forbidNonWhitelisted})` · rate limit ต่อกลุ่ม · CORS whitelist (ห้าม `*`) · helmet · ขนาด body จำกัด · ไม่ส่ง stack trace ใน production |
| Device event validation | observation ต้อง map กับ `Devices.VendorDeviceId` ที่ลงทะเบียนแล้ว (ไม่รู้จัก = นับ + ทิ้ง) · เวลาอนาคตเกิน 2 นาทีปฏิเสธ · drift filter |
| Secure streaming | URL vendor seal AES-256-GCM ไม่ถึง browser · allowlist host กัน SSRF · session token + idle timeout · toggle ต่อ role / ต่ออุปกรณ์ · audit ทุกการเปิดดู |
| Audit logging | `@Audit` ทุก write + การเปิดดู live/playback/export · `WorkOrderEvents` เป็น timeline ระดับธุรกิจ · partition `AuditLogs` |
| Secret management | env จาก Kubernetes Secret / vault · ไม่มี secret ใน repo · `prod:check` (port `prod-readiness.ts`) ตรวจ env ก่อน deploy · rotate HMAC secret ได้ (รองรับ 2 key ช่วงเปลี่ยน) |
| Idempotency | inbox unique `(Source, ExternalEventId)` · upsert ใบงานจาก Booking job ด้วย `UQ_WO_BookingJob` + `ON CONFLICT` · API ที่เปลี่ยนสถานะรับ `Idempotency-Key` header (optional) |
| Race condition | row lock `DeviceState` ต่ออุปกรณ์ · compare-and-set (`WHERE Status = expected`) · optimistic `RowVersion` (`If-Match`) สำหรับ action ของคน · exclusion constraint |
| Duplicate event | observation ซ้ำไม่เปลี่ยน `StateSince` · GPS `ON CONFLICT DO NOTHING` · inbox dedupe · alert `DedupeKey` |
| Transaction | domain change + `WorkOrderEvents` ใน transaction เดียว · emit realtime **หลัง commit** เท่านั้น (บทเรียน `cutAllSessions` ของ reference) |
| Retry / backoff | BullMQ exponential + jitter (30s, 1m, 2m, 4m, 8m) · max 5 ครั้ง ⇒ Dead + alert · breaker 5 failures ⇒ เปิด 2 นาที ⇒ half-open 1 probe |
| Network failure recovery | level-triggered sweep (state ล่าสุดชนะ) · reconcile full window รายคืน + ตอน breaker ปิด · reconnect socket ฝั่ง client invalidate snapshot (pattern `useLivePositions`) |
| Observability | **pino structured log** (JSON) + `correlationId` ต่อ request/job (AsyncLocalStorage — ต่อยอด `common/context`) · Prometheus metrics (`/api/metrics`, ภายในเท่านั้น): sweep duration, devices online, sessions open, match results, booking sync lag, breaker state, queue depth, inbox dead · health `/api/health`, `/db`, `/redis`, `/integrations` · global exception filter (reference ไม่มี) |
