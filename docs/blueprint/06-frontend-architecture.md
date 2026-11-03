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
    status/                 # DeviceStateBadge, WorkOrderStatusBadge, LinkStatusBadge, SessionStateBadge (ใหม่ — รวมการ map สถานะ → tone ไว้ที่เดียว)
    charts/                 # EChart (port)
    booking/                # BookingJobCard, BookingStaleBanner (ใหม่ — ใช้ข้ามหลาย feature)
  features/
    auth/                   # LoginPage, msalClient, loginDestination, sessionRevoked (port)
    dashboard/
    tracking/               # LiveMapPage, useLivePositions, liveMerge (port + refactor)
    tracking-history/       # HistoryPage (port, ตัด roadMatch)
    live-wall/              # LiveWallPage (port)
    streaming/              # StreamPlayer, LiveStreamDialog, streamStops (port)
    talk/                   # (port)
    sessions/               # ActiveSessionsPage, SessionDetailDrawer, sessions.api.ts
    work-orders/            # WorkOrderListPage, WorkOrderDetailPage, ReviewQueuePage,
                            # LinkBookingDialog, CloseWorkOrderDialog, VoidDialog, workOrders.api.ts, workOrderActions.ts
    booking/                # BookingJobsPage, BookingJobDetailPage, booking.api.ts
    recordings/             # RecordingsPage (playback + recording search + evidence export)
    devices/                # DevicesPage, DeviceDetailPage, DeviceFormDialog, AssignTeamDialog, devices.api.ts
    teams/                  # TeamsPage, TeamDetailPage, MemberDialog, ChangeLeaderDialog
    employees/  users/      # (port, ตัด company)
    integration/            # IntegrationStatusPage, InboxTable, OutboxTable, CallLogsTable, MappingIssues
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
| `/live-wall` | Live wall 1/4/6/9/16 | `streaming:live-wall` + `streaming:view-live` | shell full-bleed |
| `/sessions` | Active Tracking Sessions (+ แท็บประวัติ) | `sessions:read` | shell |
| `/work-orders` | Work Order List | `work-orders:read` | shell |
| `/work-orders/review` | Review queue (Suggested / Ambiguous / Unlinked / Pending / NeedsReview) | `work-orders:link` | shell |
| `/work-orders/:id` | Work Order Detail | `work-orders:read` | shell |
| `/booking-jobs` | Booking Reference List | `booking:read` | shell |
| `/booking-jobs/:id` | Booking Reference Detail | `booking:read` | shell |
| `/recordings` | Recording / Playback / Evidence export | `playback:view` | shell |
| `/devices` | Device Management | `devices:read` | shell |
| `/devices/:id` | Device Detail | `devices:read` | shell |
| `/teams`, `/teams/:id` | Teams | `teams:read` | shell |
| `/employees` | Employees | `org:read` | shell |
| `/users` | Users & Roles | `users:read` | shell |
| `/integration` | Integration Status / Error Monitoring | `integration:view` | shell |
| `/notifications` | Notifications & Alerts | `notifications:read` หรือ `alerts:view` | shell |
| `/audit-logs` | Audit log | `audit:view` | shell |
| `/settings` | Settings (+ stream access ต่อ role) | `settings:manage` | shell |
| `*` | 404 | — | shell |

- ทุก route `lazy` + `HydrateFallback = LoadingSkeleton` (pattern เดิม) · `errorElement = RouteErrorPage`
- **ใช้ path จริงสำหรับ detail** (`/work-orders/:id`) — แทน `?open=<id>` dialog ของ reference เพื่อให้ deep link จาก push/alert/Booking write-back ใช้ได้
- `RequirePermission` แสดงการ์ด "ไม่มีสิทธิ์" พร้อมรายชื่อ permission (พฤติกรรมเดิม)

```mermaid
flowchart TB
  ROOT["/"] --> AUTH["RequireAuth"]
  AUTH --> SHELL["AppLayout<br/>Sidebar + Header + RealtimeProvider"]
  SHELL --> OV["ภาพรวม<br/>Dashboard · Tracking · History · Live wall"]
  SHELL --> OPS["ปฏิบัติงาน<br/>Sessions · Work orders · Review queue · Booking jobs · Recordings"]
  SHELL --> AST["อุปกรณ์และทีม<br/>Devices · Teams · Employees"]
  SHELL --> SYS["ระบบ<br/>Integration · Notifications · Audit · Users · Settings"]
  LOGIN["/login"] -.-> AUTH
```

### Navigation groups (`app/nav.ts`)

| กลุ่ม | รายการ |
|---|---|
| ภาพรวม | Dashboard · แผนที่ติดตาม · ประวัติเส้นทาง · Live wall |
| ปฏิบัติงาน | Tracking sessions · ใบงาน · คิวตรวจสอบ (badge จำนวน) · งานจาก Booking · บันทึกวิดีโอ |
| อุปกรณ์และทีม | Bodycam · ทีม · พนักงาน |
| ระบบ | สถานะการเชื่อมต่อ (badge เมื่อ stale/dead) · การแจ้งเตือน · Audit · ผู้ใช้และสิทธิ์ · ตั้งค่า |

---

## 6.4 Screen List

| หน้าจอ | เนื้อหาหลัก | Data | Realtime |
|---|---|---|---|
| **Dashboard Overview** | MetricSummary: กล้อง online / unknown / offline · session เปิดอยู่ · WO วันนี้ (Linked / ต้องตรวจสอบ) · match rate วันนี้ · สถานะ Booking sync · รายการ "ต้องดำเนินการ" (review queue top 5, alerts) | `/dashboard/overview` | `device:status`, `session:*`, `workorder:changed`, `integration:status` |
| **Live Bodycam Tracking Map** | แผนที่ + cluster · marker 3 สถานะ (online/offline/unknown) + halo เมื่อมี session · panel รายการกล้อง (ค้นหา, filter สถานะ/ทีม/มีงาน) · คลิก = การ์ดกล้อง: ทีม, WO ปัจจุบัน, Booking, ปุ่ม Live / History · วงรัศมีสถานที่ Booking (ถ้ามีพิกัด) | `/tracking/positions` | `gps:batch`, `device:status`, `session:*` |
| **Bodycam Device Management** | ตาราง: รหัส, ชื่อ, ประเภท (หลัก/สำรอง), ทีมปัจจุบัน, สถานะ platform, fix ล่าสุด, สถานะอุปกรณ์ · tools: ดูสด, ผูกทีม, แก้ไข, `•••` (ปิดการดูภาพ, Retire) · ปุ่ม sync จาก vendor (dry-run preview) | `/devices` | `device:status` |
| **Bodycam Device Detail** | ข้อมูลอุปกรณ์ · สถานะ + timeline (`status-history`) · ประวัติผูกทีม · sessions ล่าสุด · recordings · ปุ่ม Live/Playback/History | `/devices/:id`, `/devices/:id/status-history`, `/devices/:id/assignments`, `/tracking-sessions?deviceId` | `device:status`, `session:*` |
| **Active Tracking Sessions** | ตาราง session เปิดอยู่: กล้อง, ทีม, เริ่มเมื่อ, ระยะเวลา (live), สถานะกล้อง, WO + LinkStatus · แท็บ "ยังไม่ผูกใบงาน" (AwaitingMatch/NoTeam) พร้อมปุ่ม attach/classify · แท็บประวัติ | `/tracking-sessions` | `session:*`, `device:status` |
| **Work Order List** | ตาราง: เลข WO, ชื่องาน, ทีม/หัวหน้า, Booking no., Status, LinkStatus, เริ่ม, ล่าสุด, กล้อง · filter: สถานะ, การเชื่อม Booking, ทีม, ช่วงเวลา, ต้องตรวจสอบ · ค้นหาเลข WO/Booking | `/work-orders` | `workorder:changed` |
| **Review Queue** | ใบงานที่ต้องการคนตัดสิน: Suggested (ปุ่มยืนยัน 1 คลิก), Ambiguous (เลือก candidate), Unlinked (ค้นหา Booking), Pending (รอ sync — แสดงเหตุผล), NeedsReview (เหตุผล + ปุ่มล้าง) | `/work-orders/review-queue` | `workorder:changed` |
| **Work Order Detail** | Header: เลข, สถานะ, LinkStatus, primary action ตาม `availableActions` · **Booking Reference panel** · Timeline (`events`) · Sessions (กล้อง, ช่วงเวลา, เหตุผลจบ) · แผนที่เส้นทางของช่วง WO · Recordings + ปุ่มดูย้อนหลัง/Export MP4 · Match attempts (เหตุผลที่ระบบ link) · หมายเหตุ | `/work-orders/:id` + sub-resources | `workorder:changed`, `session:*` |
| **Booking Reference Information** | (1) panel ใน WO detail: เลข/ชื่องาน, สถานะ Booking (raw + canonical), แผนเวลา, สถานที่, ทีม/หัวหน้าตาม Booking, `lastSyncedAt` + ป้าย stale, ปุ่ม refresh · (2) หน้า `/booking-jobs`: รายการ projection ที่ sync มา + สถานะ link + mapping issue | `/booking-jobs`, `/booking-jobs/:id` | `integration:status` |
| **Tracking History** | port HistoryPage: เลือกกล้อง + ช่วงวัน, polyline + จุดหยุด + gap, timeline คลิกโฟกัส · เพิ่ม: แถบ session/WO บน timeline · ตัด road-match | `/tracking/devices/:id/history` | — |
| **Recording / Playback** | ค้นหาตามกล้อง/WO/ช่วงเวลา → `RecordingSegments` · เล่นย้อนหลัง (≤ 24 ชม.) · Export MP4 (policy, progress, download ticket) | `/streams/recordings`, `/streams/playback`, `/evidence-exports` | `stream:status` |
| **Live wall** | port ทั้งหน้า (1/4/6/9/16, drag-drop, slot ใน URL, talk) · รายการกล้องจัดกลุ่มตามทีม | `/streams/*` | `stream:status`, `device:status` |
| **Integration Status / Error Monitoring** | การ์ด breaker/lag/failures · inbox/outbox (Failed/Dead + retry) · call logs · mapping issues · ปุ่ม sync | `/integration/*` | `integration:status` |
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
| Feature-level port | StreamPlayer, LiveStreamDialog, live wall, talk, evidence export flow, HistoryPage, useLivePositions/liveMerge | reference | port + ตัด dashcam |
| ใหม่ | `status/*Badge`, `booking/BookingJobCard`, `BookingStaleBanner`, `LinkBookingDialog`, `CandidateList`, `SessionTimeline`, `WorkOrderTimeline`, `MarkerCluster`, `usePermission()` | — | เขียนใหม่ตาม DESIGN.md |

### Status → tone (ไว้ที่ `components/status/` ที่เดียว)

| ค่า | Tone (`StatusBadge`) | ข้อความ (th) |
|---|---|---|
| Device online / offline / unknown | success / neutral / `unknown` token | ออนไลน์ / ออฟไลน์ / ไม่ทราบสถานะ |
| WO Open / Closed / Cancelled / Voided / Merged | info / success / neutral / neutral / neutral | กำลังดำเนินการ / ปิดแล้ว / ยกเลิกโดย Booking / ไม่ใช่งานจริง / รวมกับใบงานอื่น |
| Link Linked / Suggested / Ambiguous / Unlinked / Pending | success / info / warning / warning / neutral | เชื่อม Booking แล้ว / ระบบแนะนำ / มีหลายงานที่เป็นไปได้ / ยังไม่พบงาน Booking / รอข้อมูล Booking |
| Session open / closed / awaiting / no team | info / neutral / warning / warning | กำลังใช้งาน / สิ้นสุด / รอจับคู่ใบงาน / กล้องยังไม่ผูกทีม |

กติกาจาก `client/DESIGN.md` ที่ต้องรักษา: สีคู่ข้อความเสมอ · cobalt เฉพาะ action/selection/link/focus · 1 primary action ต่อหน้า · ปุ่ม disabled ต้องบอกเหตุผล · row tools 3+ ยุบ `•••` · ตาราง scroll ในกรอบ · skeleton ตาม layout จริง · empty ≠ filtered-empty · สำเร็จ = toast, ล้มเหลว = toast + Alert ค้าง · target ≥ 44px

---

## 6.6 State & Data Fetching

- Query keys แบบ root ตาม feature: `['work-orders', 'list', filters]`, `['work-orders', 'detail', id]`, `['work-orders', 'review-queue']`, `['sessions', 'open']`, `['booking-jobs', ...]`, `['integration', 'status']`
- Mutation ที่ต้องใช้ `If-Match` อ่าน `rowVersion` จาก cache ของ detail · 412 ⇒ toast "ข้อมูลถูกแก้โดยผู้อื่น" + refetch
- `availableActions` จาก server เป็นตัวกำหนดปุ่ม (ไม่คำนวณกติกาซ้ำที่ client)
- `usePermission(code | code[])` + `<Can permission>` แทน `permissions.includes()` กระจาย (refactor จาก reference)
- `Paged<T>` ย้ายไป `lib/paged.ts`

## 6.7 Realtime ฝั่ง client

- `RealtimeProvider` เดียว (port) · event ใหม่ `session:opened/closed`, `workorder:changed`, `integration:status`
- แผนที่: queue `gps:batch`/`device:status` flush ทุก 1s (pattern `liveMerge.ts`) · REST snapshot เมื่อ reconnect · poll 60s เฉพาะตอน socket หลุด
- WO/Session list: event ⇒ `invalidateQueries` (debounce 800ms) — ไม่ patch cache เอง ลดความเสี่ยงข้อมูลเพี้ยน
- `integration:status` ⇒ `BookingStaleBanner` ทุกหน้าที่แสดงข้อมูล Booking

## 6.8 i18n

- key แบบ namespace ต่อ feature (`workOrders.linkStatus.suggested`) · ข้อความไทยเป็นภาษาหลัก · ข้อความ error จาก backend แสดงตามที่ส่งมา (ภาษาไทย)
- ลบ key vehicle/dashcam ทั้งหมด (~110 ต่อภาษาใน reference)

## 6.9 Testing

- Unit: pure logic ทุกไฟล์ (`workOrderActions.ts`, status mapping, filters) · component test ด้วย Testing Library (pattern เดิม, `src/test/setup.ts` บล็อก XHR จริง)
- Design guard tests ของ reference (`design-foundation.test.ts`, `design-system-source-rules.test.ts`) — port มาด้วยเพื่อกันการหลุด design rules
- E2E (Playwright) ชุดเล็กเฉพาะ flow หลัก: login → map → WO detail → link Booking → close
