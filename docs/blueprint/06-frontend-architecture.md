# Part 6 — Frontend Architecture

> หลักการ: **รักษา design system และ interaction pattern ของ reference** (`client/DESIGN.md`, `client/src/styles/tailwind.css`) · port shell + primitives · เขียนใหม่เฉพาะหน้าที่ domain เปลี่ยน

---

## 6.1 Stack

| ส่วน | ใช้ | หมายเหตุ |
|---|---|---|
| Core | React 18.3 · Vite 6 · TypeScript 5.5 strict | ตาม reference |
| Styling | Tailwind 3.4 + `tailwindcss-animate` + shadcn (Radix) + lucide | copy `tailwind.config.cjs` + `src/styles/tailwind.css` (OKLCH tokens) |
| Routing | react-router-dom 7 (`createBrowserRouter` + route `lazy`) | เพิ่ม `errorElement` + 404 (reference ไม่มี) |
| Server state | TanStack Query 5 | |
| Client state | Zustand เฉพาะ auth (`stores/authStore.ts`) · Context สำหรับ Realtime/Theme/Language | ตาม reference |
| HTTP | axios + single-flight refresh (`lib/apiClient.ts`) | port ตรง |
| Realtime | socket.io-client 4 (`lib/socket.ts`, `providers/RealtimeProvider.tsx`) | port + event ใหม่ |
| Map | Leaflet 1.9 + react-leaflet 4 | เพิ่ม `leaflet.markercluster` (กล้อง 300 ตัว) · tile server ต้องเป็นของเราหรือผู้ให้บริการที่มี SLA ใน production (public OSM ไม่รองรับโหลด) |
| Video | hls.js (dynamic import) | port `StreamPlayer` |
| Talk | AudioWorklet + raw WebSocket | port `features/talk` |
| Auth SSO | `@azure/msal-browser` (lazy) | port `msalClient.ts` |
| Charts | echarts 6 (dashboard) | port `EChart.tsx` |
| i18n | custom (`src/i18n`, th/en) · default `th` | แยกไฟล์ locale ต่อ feature (reference เป็นไฟล์เดียว ~2.1k บรรทัด) |
| Quality | Vitest + Testing Library · **เพิ่ม ESLint + `tsc --noEmit` ใน build/CI** | reference build ไม่ typecheck |

---

## 6.2 Feature-based Folder Structure

```
client/src/
  main.tsx
  app/
    router.tsx              # createBrowserRouter + lazy routes
    routeAccess.ts          # path → permission (port lib/routeAccess.ts)
    nav.ts                  # เมนู + กลุ่ม (port lib/nav.ts)
    providers.tsx           # QueryClient, Theme, Language, Realtime, Motion
    RequireAuth.tsx  RequirePermission.tsx  NotFoundPage.tsx  RouteErrorPage.tsx
  components/
    ui/                     # shadcn primitives (port ทั้งหมด)
    command-center/         # AsyncState, DataPagination, DataTableFrame, DataToolbar, PageHeader,
                            # RowActionsMenu, StatusBadge, ToolButton, MetricSummary, EntitySummary (port)
    layout/                 # AppLayout, AppHeader, AppSidebar, BranchedNav, Breadcrumb, ThemeToggle, LanguageSwitcher
    map/                    # MapCanvas, DeviceMarker, MarkerCluster, RoutePolyline
    status/                 # DeviceStateBadge, WorkOrderStatusBadge, SessionStateBadge (ใหม่ — รวมการ map สถานะ → tone ไว้ที่เดียว)
    charts/                 # EChart (port)
    booking/                # BookingJobCard, BookingStaleBanner (ใหม่ — ใช้ข้ามหลาย feature)
    evidence/               # EvidencePlaybackDialog, RecordingSegmentsPanel, useEvidenceDownload, evidenceExports.api.ts
                            # (port จาก features/evidence ของ reference — ใช้ร่วมกันระหว่าง evidence/ และ recordings/)
  features/
    auth/                   # LoginPage, msalClient, loginDestination, sessionRevoked (port)
    dashboard/
    tracking/               # LiveMapPage, useLivePositions, liveMerge (port + refactor)
    tracking-history/       # HistoryPage (port, ตัด roadMatch)
    live-wall/              # LiveWallPage (port)
    streaming/              # StreamPlayer, LiveStreamDialog, streamStops (port)
    talk/                   # (port)
    sessions/               # ActiveSessionsPage, SessionDetailDrawer, sessions.api.ts (อ่านอย่างเดียว)
    work-orders/            # WorkOrderListPage, WorkOrderDetailPage, workOrders.api.ts, workOrderActions.ts
                            # (อ่านอย่างเดียว — ใบงานและสถานะมาจาก Booking · DL33)
    evidence/               # EvidencePage, evidenceCameras.ts, evidenceRange.ts (port + refactor: กล้อง/ช่วงเวลาจาก sessions ของใบงาน · DL36)
    booking/                # BookingJobsPage, BookingJobDetailPage, booking.api.ts
    recordings/             # RecordingsPage (ค้นหา recording รายกล้อง + playback + export — รวม session ที่ไม่มีใบงาน)
    devices/                # DevicesPage, DeviceDetailPage, DeviceFormDialog, devices.api.ts (ไม่มีหน้าผูกทีม — ข้อมูลจาก Booking)
    teams/                  # TeamsPage, TeamDetailPage, MemberDialog, ChangeLeaderDialog
    employees/  users/      # (port, ตัด company)
    integration/            # IntegrationStatusPage, InboxTable, CallLogsTable, MappingIssues
    notifications/  audit/  settings/
  lib/                      # apiClient, apiError, authEndpoints, socket, realtimeUrl, queryClient,
                            # paged.ts (Paged<T>), usePermission.ts (ใหม่), time.ts, utils
  i18n/
    locales/th/*.ts  locales/en/*.ts     # แยกตาม feature
  styles/  tailwind.css  global.css
  test/    setup.ts  fixtures/
```

กติกาในแต่ละ feature (ตาม reference): `Page.tsx` · `x.api.ts` (query/mutation + query keys) · pure logic `*.ts` + unit test · `components/` · ไม่ import ข้าม feature ยกเว้นผ่าน `components/` หรือ `lib/`

---

## 6.3 Routing

| Path | หน้าจอ | Permission (`anyOf` / `allOf`) | Layout |
|---|---|---|---|
| `/login` | Login (password + Entra) | Public | auth |
| `/` | Dashboard Overview | `dashboard:view` (ไม่มี ⇒ redirect ไปเมนูแรกที่เห็น) | shell |
| `/tracking` | Live Bodycam Tracking Map | `tracking:view` | shell full-bleed |
| `/tracking/history` | Tracking History (`?deviceId&from&to`) | `tracking:history` | shell full-bleed |
| `/live-wall` | Live wall 1/4/6/9/16 (เมนูหลัก Live — DL36) | `streaming:live-wall` + `streaming:view-live` | shell full-bleed |
| `/evidence` | หลักฐาน — ตารางใบงานจาก Booking → เลือกกล้อง + ช่วงเวลา → ดูย้อนหลัง / ดาวน์โหลด MP4 (เมนูหลัก — DL36) | `playback:view` + `work-orders:read` (ปุ่ม export/download ต้องมี `evidence:export` / `evidence:download`) | shell |
| `/sessions` | Active Tracking Sessions (+ แท็บประวัติ) | `sessions:read` | shell |
| `/work-orders` | Work Order List | `work-orders:read` | shell |
| `/work-orders/by-booking/:externalJobId` | deep link จาก Booking app → redirect `/work-orders/:id` (DL31) | `work-orders:read` | shell |
| `/work-orders/:id` | Work Order Detail | `work-orders:read` | shell |
| `/booking-jobs` | Booking Reference List | `booking:read` | shell |
| `/booking-jobs/:id` | Booking Reference Detail | `booking:read` | shell |
| `/recordings` | บันทึกวิดีโอรายกล้อง — ค้นหาตามกล้อง + ช่วงเวลา / Playback / Export (ใช้กับ session ที่ไม่มีใบงาน) | `playback:view` | shell |
| `/devices` | Device Management | `devices:read` | shell |
| `/devices/:id` | Device Detail | `devices:read` | shell |
| `/teams`, `/teams/:id` | Teams | `teams:read` | shell |
| `/depots` | ฐาน/จุดชาร์จกล้อง (แผนที่ + รัศมี) | `devices:read` (แก้ไข `devices:manage`) | shell |
| `/employees` | Employees | `org:read` | shell |
| `/users` | Users & Roles | `users:read` | shell |
| `/integration` | Integration Status / Error Monitoring | `integration:view` | shell |
| `/notifications` | Notifications & Alerts | `notifications:read` หรือ `alerts:view` | shell |
| `/audit-logs` | Audit log | `audit:view` | shell |
| `/settings` | Settings (+ stream access ต่อ role) | `settings:manage` | shell |
| `*` | 404 | — | shell |

- ทุก route `lazy` + `HydrateFallback = LoadingSkeleton` (pattern เดิม) · `errorElement = RouteErrorPage`
- **ใช้ path จริงสำหรับ detail** (`/work-orders/:id`) — แทน `?open=<id>` dialog ของ reference เพื่อให้ deep link จาก push/alert/Booking app ใช้ได้
- `RequirePermission` แสดงการ์ด "ไม่มีสิทธิ์" พร้อมรายชื่อ permission (พฤติกรรมเดิม)

```mermaid
flowchart TB
  ROOT["/"] --> AUTH["RequireAuth"]
  AUTH --> SHELL["AppLayout<br/>Sidebar + Header + RealtimeProvider"]
  SHELL --> MAIN["เมนูหลัก<br/>Live (Live wall) · หลักฐาน (Evidence)"]
  SHELL --> OV["ภาพรวม<br/>Dashboard · Tracking · History"]
  SHELL --> OPS["ปฏิบัติงาน<br/>Sessions · Work orders · Booking jobs · Recordings"]
  SHELL --> AST["อุปกรณ์และทีม<br/>Devices · Teams · Employees · Depots"]
  SHELL --> SYS["ระบบ<br/>Integration · Notifications · Audit · Users · Settings"]
  LOGIN["/login"] -.-> AUTH
```

### Navigation groups (`app/nav.ts`)

| กลุ่ม | รายการ |
|---|---|
| **เมนูหลัก** (DL36 — อยู่บนสุดของ sidebar) | **Live** (`/live-wall` — สตรีมสด + talk · ดูสดรายกล้องจากหน้า Bodycam ด้วย) · **หลักฐาน** (`/evidence`) |
| ภาพรวม | Dashboard · แผนที่ติดตาม · ประวัติเส้นทาง |
| ปฏิบัติงาน | Tracking sessions · ใบงาน · งานจาก Booking · บันทึกวิดีโอรายกล้อง |
| อุปกรณ์และทีม | Bodycam · ทีม · พนักงาน · ฐาน/จุดชาร์จ |
| ระบบ | สถานะการเชื่อมต่อ (badge เมื่อ stale/dead) · การแจ้งเตือน · Audit · ผู้ใช้และสิทธิ์ · ตั้งค่า |

---

## 6.4 Screen List

| หน้าจอ | เนื้อหาหลัก | Data | Realtime |
|---|---|---|---|
| **Dashboard Overview** | MetricSummary: กล้อง online / unknown / offline · session เปิดอยู่ · WO วันนี้ (เปิด / ปิด) · session รอจับคู่ · match rate วันนี้ · สถานะ Booking sync · alert ล่าสุด | `/dashboard/overview` | `session:*`, `workorder:changed`, `integration:status` |
| **Live Bodycam Tracking Map** | แผนที่ + cluster · marker 3 สถานะ (online/offline/unknown — ค่าจาก snapshot ตอนเปิดหน้า, DL35) + halo เมื่อมี session · panel รายการกล้อง (ค้นหา, filter สถานะ/ทีม/มีงาน) · คลิก = การ์ดกล้อง: ทีม, WO ปัจจุบัน, Booking, ปุ่ม Live / History · วงรัศมีสถานที่ Booking (ถ้ามีพิกัด) | `/tracking/positions` | `gps:batch` (ตำแหน่ง), `session:*` |
| **Bodycam Device Management** | ตาราง: รหัส, ชื่อ, ประเภท (หลัก/สำรอง), ทีมปัจจุบัน (จาก Booking), สถานะ platform (ดึงจาก DSS ตอนเปิดหน้า — DL35), fix ล่าสุด, อยู่ฐาน, สถานะอุปกรณ์ · tools: ดูสด, แก้ไข, `•••` (ปิดการดูภาพ, Retire) · ปุ่ม sync จาก vendor (dry-run preview) | `/devices` | — |
| **Bodycam Device Detail** | ข้อมูลอุปกรณ์ · สถานะ (ดึงจาก DSS ตอนเปิดหน้า — DL35) + timeline (`status-history`) · ประวัติผูกทีม (จาก Booking) · sessions ล่าสุด · recordings · ปุ่ม Live/Playback/History | `/devices/:id`, `/devices/:id/status-history`, `/devices/:id/assignments`, `/tracking-sessions?deviceId` | `session:*` |
| **Active Tracking Sessions** | ตาราง session เปิดอยู่: กล้อง, ทีม, เริ่มเมื่อ, ระยะเวลา (live), สถานะกล้อง, WO (เลข WO / Booking) · แท็บ "ยังไม่มีใบงาน" (AwaitingMatch/NoTeam) อ่านอย่างเดียว — แสดงเหตุผลจาก match attempts + ลิงก์ไป `/recordings` ของกล้อง (รอ Booking — DL33) · แท็บประวัติ | `/tracking-sessions` | `session:*` |
| **Work Order List** | อ่านอย่างเดียว (ใบงานมาจาก Booking — DL33) · ตาราง: เลข WO, ชื่องาน, ทีม/หัวหน้า, Booking no., Status, เริ่ม, ล่าสุด, กล้อง, ป้าย NeedsReview · filter: สถานะ, ทีม, ช่วงเวลา, ต้องตรวจสอบ · ค้นหาเลข WO/Booking | `/work-orders` | `workorder:changed` |
| **Work Order Detail** | อ่านอย่างเดียว — Header: เลข, สถานะ (ตาม Booking), ป้าย NeedsReview + เหตุผล (ข้อมูลเท่านั้น), ปุ่มตาม `availableActions` (หมายเหตุ, ไปหน้า หลักฐาน) · **Booking Reference panel** · Timeline (`events`) · Sessions (กล้อง, ช่วงเวลา, เหตุผลจบ) · แผนที่เส้นทางของช่วง WO · Recordings + ปุ่มดูย้อนหลัง/Export MP4 · Match attempts (เหตุผลที่ระบบผูก session) · หมายเหตุ · ไม่มี link / unlink / void (DL33) | `/work-orders/:id` + sub-resources | `workorder:changed`, `session:*` |
| **Booking Reference Information** | (1) panel ใน WO detail: เลข/ชื่องาน, สถานะ Booking (raw + canonical), **เวลา check-in / check-out** (เป็นตัวกำหนดสถานะใบงาน), กล้องที่ Booking ระบุ (`deviceRefs`), แผนเวลา, สถานที่, ทีม/หัวหน้าตาม Booking, `lastSyncedAt` + ป้าย stale, ปุ่ม refresh · (2) หน้า `/booking-jobs`: รายการ projection ที่ sync มา + ลิงก์ไปใบงาน + mapping issue | `/booking-jobs`, `/booking-jobs/:id` | `integration:status` |
| **Tracking History** | port HistoryPage: เลือกกล้อง + ช่วงวัน, polyline + จุดหยุด + gap, timeline คลิกโฟกัส · เพิ่ม: แถบ session/WO บน timeline · ตัด road-match | `/tracking/devices/:id/history` | — |
| **หลักฐาน (Evidence)** — เมนูหลัก DL36 | port `EvidencePage` ของ reference: (1) ตารางใบงานจาก Booking (ค้นหาเลข WO/Booking, ทีม, ช่วงเวลา) → (2) เลือกใบ → รายการกล้อง + ช่วงเวลาจาก sessions ของใบนั้น (`evidenceCameras`) → (3) ปรับช่วง (≤ 24 ชม., `evidenceRange`) → ดูย้อนหลัง หรือดาวน์โหลด MP4 (ใช้ export job เดิมเมื่อ device + channel + start/end ตรงกันและยังไม่หมดอายุ — ไม่งั้นสร้าง job ใหม่) | `/work-orders`, `/work-orders/:id/sessions`, `/streams/recordings?workOrderId`, `/streams/playback`, `/evidence-exports*` | `stream:status`, `workorder:changed` |
| **Recording / Playback** | ค้นหาตามกล้อง + ช่วงเวลา → `RecordingSegments` (รวม session ที่ไม่มีใบงาน — DL33) · เล่นย้อนหลัง (≤ 24 ชม.) · Export MP4 (policy, progress, download ticket) | `/streams/recordings`, `/streams/playback`, `/evidence-exports` | `stream:status` |
| **Live wall** — เมนูหลัก Live (DL36) | port ทั้งหน้า (1/4/6/9/16, drag-drop, slot ใน URL, talk) · รายการกล้องจัดกลุ่มตามทีม · สถานะกล้องดึงตอนเปิดหน้า (DL35) | `/streams/*`, `/devices` | `stream:status` |
| **Integration Status / Error Monitoring** | การ์ด breaker/lag/failures · inbox (Failed/Dead + retry) · call logs · mapping issues · ปุ่ม sync | `/integration/*` | `integration:status` |
| **Teams** | ตารางทีม (หัวหน้า, จำนวนสมาชิก, กล้องหลัก, `BookingTeamRef`) · detail: สมาชิก + ประวัติ, เปลี่ยนหัวหน้า, กล้องที่ผูก | `/teams/*` | — |
| **Users / Roles** | port `/users` (ตัด company) + role-permission matrix + ระงับบัญชี | `/users`, `/roles` | `session:revoked` |
| Notifications, Audit, Settings | port | | `alert:new` |

---

## 6.5 Component Reuse Strategy

| ระดับ | Component | ที่มา | การกระทำ |
|---|---|---|---|
| Tokens & base CSS | `tailwind.css`, `tailwind.config.cjs`, `global.css` (`.tracking-marker*`, `.route-*`, `.stream-stage`, `.voice-pill*`, `.branched-nav*`) | reference | copy · ลบ `.nwl-*` prefix เก่า · ลบ font ที่ไม่ใช้ |
| Primitives | `components/ui/*` (button, dialog, dropdown-menu, search-select, table, tabs, field, form-field, confirm-dialog, skeleton, sonner …) | reference | copy ทั้งชุด · ใช้ toast ระบบเดียว (sonner) |
| Composites | `components/command-center/*` | reference | copy · `DeviceIdentity` ปรับให้แสดงทีม |
| Shell | AppLayout, AppHeader, AppSidebar, BranchedNav, Breadcrumb, ThemeToggle, LanguageSwitcher | reference | copy · nav ใหม่ |
| Infra | apiClient, apiError, authEndpoints, socket, realtimeUrl, RealtimeProvider, authStore, msalClient | reference | copy |
| Feature-level port | StreamPlayer, LiveStreamDialog, live wall, talk, evidence (`EvidencePage` + export flow), HistoryPage, useLivePositions/liveMerge | reference | port + ตัด dashcam / vehicle |
| ใหม่ | `status/*Badge`, `booking/BookingJobCard`, `BookingStaleBanner`, `SessionTimeline`, `WorkOrderTimeline`, `MarkerCluster`, `usePermission()` | — | เขียนใหม่ตาม DESIGN.md |

### Status → tone (ไว้ที่ `components/status/` ที่เดียว)

| ค่า | Tone (`StatusBadge`) | ข้อความ (th) |
|---|---|---|
| Device online / offline / unknown | success / neutral / `unknown` token | ออนไลน์ / ออฟไลน์ / ไม่ทราบสถานะ |
| WO Planned / Open / Closed / Cancelled | neutral / info / success / neutral | รอเริ่ม / กำลังดำเนินการ / ปิดแล้ว / ยกเลิกโดย Booking |
| Session open / closed / awaiting / no team / charging | info / neutral / warning / warning / neutral | กำลังใช้งาน / สิ้นสุด / รอข้อมูล Booking / กล้องยังไม่ผูกทีม / ชาร์จที่ฐาน |

กติกาจาก `client/DESIGN.md` ที่ต้องรักษา: สีคู่ข้อความเสมอ · cobalt เฉพาะ action/selection/link/focus · 1 primary action ต่อหน้า · ปุ่ม disabled ต้องบอกเหตุผล · row tools 3+ ยุบ `•••` · ตาราง scroll ในกรอบ · skeleton ตาม layout จริง · empty ≠ filtered-empty · สำเร็จ = toast, ล้มเหลว = toast + Alert ค้าง · target ≥ 44px

---

## 6.6 State & Data Fetching

- Query keys แบบ root ตาม feature: `['work-orders', 'list', filters]`, `['work-orders', 'detail', id]`, `['sessions', 'open']`, `['devices', 'list', filters]`, `['booking-jobs', ...]`, `['evidence-exports', id]`, `['integration', 'status']`
- Mutation ที่ต้องใช้ `If-Match` อ่าน `rowVersion` จาก cache ของ detail · 412 ⇒ toast "ข้อมูลถูกแก้โดยผู้อื่น" + refetch
- `availableActions` จาก server เป็นตัวกำหนดปุ่ม (ไม่คำนวณกติกาซ้ำที่ client)
- `usePermission(code | code[])` + `<Can permission>` แทน `permissions.includes()` กระจาย (refactor จาก reference)
- `Paged<T>` ย้ายไป `lib/paged.ts`

## 6.7 Realtime ฝั่ง client

- `RealtimeProvider` เดียว (port) · event ใหม่ `session:opened/closed`, `workorder:changed`, `integration:status`
- แผนที่: queue `gps:batch` flush ทุก 1s (pattern `liveMerge.ts`) · REST snapshot เมื่อ reconnect · poll 60s เฉพาะตอน socket หลุด
- **ไม่มี `device:status`** (DL35) — ไม่ subscribe สถานะ online/offline · หน้า device list / device detail / ก่อนเปิด live ดึงสถานะจาก API ตอนเปิดหน้า (`GET /devices`, `GET /devices/:id` — api ถาม DSS ผ่าน cache Redis 10s, DL45) · แสดงเวลาอัปเดตจาก `platformStatusFetchedAt`
- WO/Session list: event ⇒ `invalidateQueries` (debounce 800ms) — ไม่ patch cache เอง ลดความเสี่ยงข้อมูลเพี้ยน
- `integration:status` ⇒ `BookingStaleBanner` ทุกหน้าที่แสดงข้อมูล Booking

## 6.8 i18n

- key แบบ namespace ต่อ feature (`workOrders.status.open`) · ข้อความไทยเป็นภาษาหลัก · ข้อความ error จาก backend แสดงตามที่ส่งมา (ภาษาไทย)
- ลบ key vehicle/dashcam ทั้งหมด (~110 ต่อภาษาใน reference)

## 6.9 Testing

- Unit: pure logic ทุกไฟล์ (`workOrderActions.ts`, `evidenceCameras.ts`, `evidenceRange.ts`, status mapping, filters) · component test ด้วย Testing Library (pattern เดิม, `src/test/setup.ts` บล็อก XHR จริง)
- Design guard tests ของ reference (`design-foundation.test.ts`, `design-system-source-rules.test.ts`) — port มาด้วยเพื่อกันการหลุด design rules
- E2E (Playwright) ชุดเล็กเฉพาะ flow หลัก: login → map → (mock Booking check-in) → WO detail แสดง session ที่ระบบผูก → หน้า หลักฐาน เลือกกล้อง + ช่วงเวลา → ดูย้อนหลัง / export → (mock Booking check-out) → ใบงานปิด
