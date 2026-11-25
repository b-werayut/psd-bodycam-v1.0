# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**PSD Body worn camera** (repo `psd-bodycam-v1.0`) — a new Bodycam-only tracking and work-order system. It rebuilds the Bodycam part of the reference project `C:\Git\Internal-BodyCam` (with Dashcam and vehicles removed entirely) and links camera usage to work orders from an external **Booking** system (named **Smart Booking** in the requirements).

Requirements: `docs/requirements/2026-11-12-body-camera-requirements.md`, adopted as a whole (DL48) with two overrides: role names stay generic (no "Safety"), and GPS history + talk are Must, not Optional.

## Language policy

- Talk to the user in **Thai**, keeping technical terms in English.
- Everything under `docs/` is Thai. UI strings default to Thai (i18n th/en).
- This file is in English only to save tokens.

## Current state: P0 done, P1 (devices & tracking) implemented

- Code exists in `server/` (NestJS) and `client/` (Vite + React). P0 task plans (2026-11-20, replace the 2026-11-04 ones): `docs/superpowers/plans/2026-11-20-p0-server-foundation.md` and `2026-11-20-p0-client-completion.md`. Check the code to see which tasks are done; the plan checkboxes are not kept up to date. The client plan is done (Tasks 1–4): the users page follows the server's `availableActions` / `reservedPermissions` (matrix read-only without `roles:manage`), ผู้ใช้จาก Entra at `/entra-users`, one `<Toaster />` in `app/providers.tsx`, logout clears locally first then revokes in the background, `api` drops 401s of an older session (epoch) and times out at 15 s. Open item: `entraLink.ts` is unused until `GET /users` also returns `azureObjectId`.
- Dev environment (DL63): this local machine — PostgreSQL + Redis installed locally (new DB `bwc` / `bwc_test`, never the old system's DB), DSS middleware reached over VPN, Booking stays mock/simulator. No Azure deploy until the user says so. Entra SSO on localhost needs redirect URI `http://localhost:5173` added to the dev app registration (it currently only has the deployed `psd-bwc-frontend` domain).
- DB so far: P0 + P1 tables (`server/src/db/schema.ts`, partitioned ones in `schema.partitioned.ts`) + migrations `0000_baseline`, `0001_extensions_partitions` (`btree_gist` + `AuditLogs`), `0002_drop_departments` (DL53: no `Departments` table, no `DepartmentId` columns), `0003_reference_data` (4 roles, the 24-permission catalog + grants, `auth.*` lockout settings; generated from `server/src/common/auth/permission-catalog.ts`, kept in sync by `reference-data.int-test.ts`) `0004_refresh_replaced_at`, `0005_p1_devices` (`Devices`, `DeviceState`, `DeviceStatusHistory`, `Teams`, `TeamMembers`, `Depots`, `Alerts`) and `0006_p1_tracking_custom` (`GpsLocations` partitioned by month + BRIN, `EX_TeamMembers_LeaderNoOverlap`, the 6 tracking settings).
- Local setup: `docs/runbooks/local-dev.md` (Thai). Swagger UI `http://localhost:3000/api/docs` (off in production unless `SWAGGER_ENABLED=true`), health `/api/health`, `/api/health/db`, `/api/health/redis` (503 when down). Unit tests that mount `AppController` need `HEALTH_STUB_PROVIDERS` from `src/test/health-stubs.ts`.
- Server P0 done so far: Tasks 1–11 of the server plan (Entra SSO `POST /api/auth/azure`: id_token verified against the tenant JWKS, account must already exist — matched by oid, else by email then linked; a password lockout does not block SSO; Entra directory / sync via Microsoft Graph: `GET /users/entra-directory`, `POST /users/sync-entra` — never creates accounts, hides SUPER_ADMIN accounts from non-SUPER_ADMIN callers; integration tests stub `fetch`, never call Microsoft; helmet + Swagger + health checks + runbook; drift guard, catalog + seed, Redis/locks/rate limit, password auth with refresh rotation + race grace + global guards, audit interceptor + `/audit-logs` + `/settings`, `/users` + `/roles` with the ADMIN / hidden-SUPER_ADMIN rules, realtime gateway `/realtime` with handshake auth (token + account still active) and `session:revoked` on suspend / delete / admin password reset). Push from any process through `RealtimeGateway.bus` (Socket.IO server in `api`, Redis emitter in `worker`). Integration tests create users with `createTestUsers` / `dropTestUsers` from `src/test/int-helpers.ts`. Real Microsoft sign-in on localhost still needs redirect URI `http://localhost:5173` in the app registration; until then use username/password (DL65). Lockout = 3 wrong passwords ⇒ 15 min, editable by SUPER_ADMIN (`auth.max-failed-logins` / `auth.lockout-minutes`). No data is ever copied from the old system (Part 4 §4.7, Q13): dev users come only from `npm run db:seed` (`admin`, `companyadmin1`, `operator1`, `viewer1`, `teamleader1`). Tables of later phases (`TrackingSessions`, `WorkOrders`, `BookingJobs`, `Notifications`, …) are not created yet.
- P1 done (plan `docs/superpowers/plans/2026-11-23-p1-devices-tracking.md`, decisions recorded in Part 9 §9.5): one `DssClient` (`common/dss/`, `DSS_DRIVER=mock` simulator by default — 100 cameras `SIM-0001`…; `dss` = `psd-bwc-dss-services` with a per-request HS256 JWT from `DSS_API_KEY`); worker role `tracking` = `TrackingWorkerModule` (DeviceSync hourly, GpsPoll every `gps.poll-interval-seconds` with no overlap and no cap, PartitionMaintenance daily); `DeviceStatusService` is the only writer of `DeviceState` status, `GpsIngestService` of GPS rows and the snapshot; `GET /api/devices` (screen status from the DSS device list cached in Redis `cache:{db}:device-status:{id}`, fail-open), `GET /api/tracking/positions`, `GET /api/tracking/devices/:id/history` (≤ 36 h, `INVALID_RANGE`, audited — DL77); rooms `tracking` / `alerts` from DB grants at handshake; alert 13 `DEVICE_VENDOR_MISSING` → `user:{id}` of every SUPER_ADMIN. Client: `/tracking` (Leaflet + markercluster) and `/tracking/history` (Bangkok start–end date + time, ≤ 36 h across days, loads only on Show route — DL77). Device integration tests start from `resetDevices()` and assert pushes with `recordingGateway()` (`src/test/int-helpers.ts`). Tested against the real DSS over VPN on 2026-11-24 (`DSS_DRIVER=dss` in the dev `server/.env`; DSS has 1 camera, `/location` ~300 ms); the simulator cameras `SIM-*` in the dev DB were soft-deleted for that switch.
- The design source of truth is **`docs/blueprint/`**. Read the relevant Part before designing or implementing anything:

| Part | Use it for |
|---|---|
| `README.md` | Summary, glossary, the recommended architecture/schema/plan |
| `01-existing-system-analysis.md` | What to reuse / refactor / remove / rebuild from the reference, with real paths |
| `02-system-architecture.md` | Modules, process roles, dependency rules, failure isolation, security |
| `03-business-workflows.md` | Session lifecycle, `decide()` decision table, matching algorithm, Booking-driven status, Settings keys |
| `04-database-design.md` | **Canonical names** for tables, columns, enums, constraints and indexes, plus retention and migration strategy |
| `05-api-design.md` | REST endpoints, error codes, the Booking inbound endpoint, team-leader mobile API, Socket.IO events, alert types, permission matrix |
| `06-frontend-architecture.md` | Folder structure, routes, screens, component reuse, status→tone mapping |
| `07-integration-strategy.md` | Booking push contract v1 (inbound endpoint, auth, responses), inbound mapper, optional read API, inbox, retry, idempotency, Confirmed vs Assumption |
| `08-implementation-roadmap.md` | Phases P0–P6 with dependencies and acceptance criteria |
| `09-risks-open-questions.md` | Risks, the Booking checklist, and the **decision log §9.5** (user decisions DL1–DL60) |

- Implement in roadmap order.
- P3c (Smart Booking go-live: agreed contract/auth, `smart-booking` mapper if their body is not our v1, optional read API adapter) is blocked until the Booking team provides a spec. Until then, build on our v1 contract, the `booking-simulator` and the `mock` driver (DL25, DL46).
- Once code exists, code is the truth. When docs disagree with code, fix the docs.

## Reference project (read-only)

- `C:\Git\Internal-BodyCam` is **reference only. Never create or modify files there** (user requirement). Reading it is fine.
- Its `CLAUDE.md` is about 400KB. Read it by offset or grep, never whole.
- Its code is more reliable than its docs.
- Main things to port (details and paths in Part 1 §1.5):
  - Server: `server/src/common/*`, `modules/auth`, `modules/realtime`, the GPS pipeline (`modules/tracking/tracking.service.ts`, `modules/scheduler/gps-poll.service.ts`), DSS providers, `modules/streaming` and `modules/talk`.
  - Client: `client/src/styles/tailwind.css` (OKLCH tokens), `client/DESIGN.md`, `components/ui`, `components/command-center`, the app shell, `lib/apiClient.ts`, `features/evidence` (DL36), `features/users/EntraUsersPage.tsx` (DL53).
- Its `scheduler/camera-session.service.ts` is the **anti-pattern** being replaced: a pseudo work order plus reserved seed rows, `.limit(100)` with no `ORDER BY`, and a reopen loop.
- The old system deployed in K8s `team3` is `C:\Git\psd-bwc-frontend` + `C:\Git\psd-bwc-web-backend` (Azure DevOps), with the same `src/` as the reference. It has no real users, and this system **replaces it in place** (DL60): it can be scaled to 0 now, and `server/` / `client/` replace those repos' content so the existing Azure pipelines, Harbor, gitops and Deployment/Service names are reused. Use a **new database**: the old DB's `drizzle.__drizzle_migrations` and table names clash with ours.
  - **This repo is the source of truth.** The Azure repos are only the pipeline input: the user copies committed files of `server/` / `client/` there themselves when deploying, keeping the Azure repos' own `azure-pipelines.yml`, `sonar-project.properties` (and the backend's `.dockerignore`). Never edit the Azure repos; change code here.

## Commands

Server (`cd server`, NestJS):
- `npm run start:api:dev` / `npm run start:worker:dev` — two entry points, `main.api.ts` and `main.worker.ts`
- `npm run lint` / `npm run typecheck`
- `npm test` — Vitest unit tests, `src/**/*.test.ts`
- `npm run test:int` — integration tests, `src/**/*.int-test.ts`, run serially. The test DB comes from `DATABASE_URL_TEST`, or `DATABASE_URL` + `_test`; its name must end in `_test`. `npm run db:prepare:test` creates it and runs the migrations.
- `npm run ci` — lint + typecheck + unit + integration
- `npm run db:generate` (custom SQL: `npm run db:generate -- --custom --name=<name>`) / `npm run db:migrate` — drizzle-kit
- Single test: `npx vitest run path/to/file.test.ts -t "test name"` (integration: add `--config vitest.integration.config.ts`)
- `npm run db:seed` (`src/db/seed.ts` → `dev-seed.ts`) — dev only (refuses `NODE_ENV=production`), run after `db:migrate`; re-running resets the demo accounts. Passwords: `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD` (fallback `Admin@12345` / `Demo@12345`).
- `coverage` / `test:ci:full` (`scripts/ci-coverage.js`) are in `package.json` but the script does not exist yet.

Client (`cd client`, Vite):
- `npm run dev` / `npm run build` (typecheck + vite build) / `npm run typecheck` / `npm run lint` / `npm test`

## Architecture (big picture)

**Process model**
- NestJS **modular monolith**. Two process types come from one codebase: `api` and `worker`.
- The worker is split by `WORKER_ROLES=tracking,integration,media`, so roles can become separate pods later without code changes.
- Redis provides the Socket.IO adapter/emitter, locks, rate limiting, BullMQ queues, the circuit-breaker state and the screen camera-status cache (DL45). It is not a general data cache: external data is projected into PostgreSQL.

**Two paths that must stay isolated**
- *Real-time path*: DSS (GpsPoll) → `device-status` → `DeviceState` (internal, feeds the session engine) and `gps:batch` → Socket.IO. It **never calls Booking**.
  - No `device:status` push (DL35): screens that show camera status fetch it from DSS on open (`api` → DSS middleware), through a Redis cache `device-status:{deviceId}` with TTL `status.display-cache-seconds` = 10s, fail-open to DSS when Redis is down (DL45). Other events (`gps:batch`, `session:*`, `workorder:changed`, `alert:new`, …) stay.
- *Booking path*: Smart Booking **POSTs** jobs to `POST /api/integration/booking/jobs` (`api` process: HMAC or API-key guard, DTO check, insert raw into `IntegrationInbox` with `Channel = 1 Push`, reply `202 accepted` / `200 duplicate`) → queue `booking-inbox` → inbox processor (worker `integration` role) maps with `BookingInboundMapper` (`v1` | `smart-booking`) → `BookingJobs` (local projection) + its `WorkOrders` row (1:1 upsert, DL33) → queue `matching` attaches sessions.
  - **Push, not pull (DL46, replaces DL31)**: no change feed, no 2-min polling, no `Cursor`. The api never maps or writes `BookingJobs` / `WorkOrders` itself.
  - Optional read API only if Booking offers one: `BookingProvider` (`none` | `mock` | `http`, default `none`) for per-job refresh and a nightly reconcile. The circuit breaker covers only these outbound calls. `csv` import is a manual fallback.
  - Jobs carry DO / SH numbers (`BookingJobs.DoNo` / `ShNo`, meaning still an Assumption) for display and search only, plus check-in / check-out times.
  - Lost POSTs are invisible to us: rely on Booking retries, alert `BOOKING_INBOUND_SILENT`, and the optional reconcile.
  - A POST we received is never lost: its raw body stays in `IntegrationInbox.Payload`. Rows that end `Dead` (10 failed attempts) are reprocessed from that payload, never by asking Booking to resend (DL54): automatically after `re-resolve` and by a daily 03:00 job (rows ≤ 7 days old, `Attempts` reset), or by the SUPER_ADMIN's "ประมวลผลใหม่" button on alert `INTEGRATION_DEAD_LETTER` → `POST /integration/inbox/:id/retry` (`settings:manage`).
  - Matching reads only the projection; it never calls the Booking API live.
  - No write-back, no `IntegrationOutbox`. Booking links to us via `/work-orders/by-booking/{externalJobId}`.
  - `booking-integration` must not import `sessions` or the `work-orders` matcher; matching is handed over through the queue `matching` only. Single exception (Part 2 §2.4 rule 1): the inbox processor calls the `work-orders` writer to upsert the `WorkOrders` row in the same transaction as the projection.
  - Teams come from Booking (DL53, **[Assumption]** that every job carries team + leader refs): in the same transaction the inbox processor creates a `Teams` row for an unknown `teamRef` and moves the active leader in `TeamMembers` to the employee matched by `leaderRef` (`Users.BookingEmployeeRef`). There is no team management screen.

**Core domain**
- `TrackingSessions` record observed camera use. `WorkOrders` come **only from Booking** (DL33): one per `BookingJobs` row, `BookingJobId` NOT NULL. **This system never creates a work order**, and there are no pseudo work orders.
- A session is one camera continuously on, attached to 0..1 work order. One work order holds many sessions; one Booking job maps to one work order.

**Session engine** (`sessions` module, worker `tracking` role)
- Runs as a level-triggered sweep every 30s over **all** devices, ordered by `Id`.
- For each device it locks `DeviceState` with `SELECT … FOR UPDATE`, runs a pure `decide()`, then applies the result. Time comes from the DB `now()`.
- It is the **only writer of session lifecycle** (open, close, split).
- Global lock order: `DeviceState` (by `DeviceId` ascending) → `WorkOrders` (by `Id` ascending) → `TrackingSessions`.

**Device status**
- UNKNOWN is computed from how stale `LastObservedAt` is. **Never write null on a reconnect or worker restart.**
- Camera status comes only from GpsPoll: DSS `/location` returns GPS + online/offline in one call (DL32). No StatusPoll, no BRMS MQ (DL30), no device webhook. `StateSource` values 1, 3 and 4 stay reserved.
- "Camera on" comes from platform status, not GPS: most cameras have no GPS fix indoors.
- DSS middleware = `psd-bwc-dss-services` (FastAPI). It calls the **Dahua DSS Platform** (Dahua's camera VMS) and keeps the DSS tokens; HLS goes through its `/proxy`.
- `Devices` are created/updated only by the worker job `DeviceSync` (DSS device list + `device-sync.plan.ts`, on start + hourly; never deletes, sets `VendorMissingSince` + alert `DEVICE_VENDOR_MISSING`). No device CRUD, manual sync, retire or per-device streaming toggle screen (DL53).

**Work order status follows Booking**
- There are **no departments** (DL53, replaces DL38): no `Departments` table, no `DepartmentId` column anywhere, no Booking `departmentRef`.
- Statuses: `Planned` (synced, no check-in yet, DL37) → `Open` (check-in) → `Closed` (check-out, `BookingCheckout`); a new check-in reopens; a Booking cancel sets `Cancelled`.
- There is **no human close, reopen, link, unlink, merge or void** in this system.
- Open work orders with no check-out get the `NeedsReview` badge 36h after check-in (no alert) and close after 7 days (`SafetyTimeout`). `Planned` ones close only when Booking says so.
- `NeedsReview` is only an info badge, with no alert. There is no review queue and no SLA.
- Alerts are about cameras and video, not work-order management (DL58): web users get only `CAMERA_ACTIVE_NO_TEAM` and `RECORDING_OUTSIDE_WORK` (≥ 30 min); `SUPER_ADMIN` keeps the integration / device alerts. Alerts have "รับทราบ" and "ปิดเรื่อง" (DL57).

**Unmatched sessions (DL33)**
- No candidate, or several candidates ⇒ the session stays `AwaitingMatch` (or `NoTeam`). No work order is created.
- It re-matches automatically when Booking data changes (`matching.rematch`, within `booking.rematch-horizon-hours`).
- No manual link, no human classify, no review queue. Video of a camera without a work order is played back on วิดีโอย้อนหลัง, which searches per camera + day (DL59), and watched live on the live wall while online.

**Matching** (automatic only)
- Order: `BookingJobs.DeviceRefs` first, then the team ref, then the team-leader ref. Exactly one winning candidate ⇒ attach.
- **Camera↔job/team binding comes only from Booking.** There is no screen to bind cameras in this system.
- Every decision is recorded in `MatchAttempts`.

**Charging at base**
- A camera at a depot is not work: the system sets `Classification = IdleOrCharging` on its session. Detection uses the `Depots` radius plus the latest GPS fix.
- The vendor has no charging state.
- There is no depot screen in the first phase (DL53), so `Depots` stays empty in production and this rule does not fire yet (dev seed has mock depots).

**Evidence storage (DL34)**: exported MP4 files go to a local-disk PVC (`STORAGE_DRIVER=local`) shared by `api` and `worker-media`, and are deleted after 24h (`EvidenceCleanup`). No MinIO / object storage. Source video stays on the Dahua DSS Platform.

**Invariants live in the DB** (partial uniques, exclusion constraints, CHECKs):
- `UQ_TS_OpenPerDevice` and `EX_TS_NoOverlap`
- `UQ_WO_BookingJob` (plain unique; `BookingJobId` NOT NULL)
- The exclusion constraints need `btree_gist`.
- Removed enum values (e.g. WO `Voided` / `Merged`, `NoBookingData`, `MappingIssues` 1 `UnknownTeamRef` / 6 `UnknownDepartmentRef`) stay reserved: never reuse their numbers.

Emit realtime events **only after commit**.

## Conventions

**Database**
- Tables and columns are PascalCase and quoted.
- Primary keys are `bigint` identity, serialized as strings in JSON.
- Timestamps are `timestamptz` in UTC and displayed in Asia/Bangkok.
- Enums are `smallint`, append-only: never renumber them.
- JSON columns use `jsonb`.
- Soft delete applies to master data only.
- `GpsLocations` and `AuditLogs` are partitioned by month. They are declared in `schema.partitioned.ts`, which is kept outside drizzle-kit's schema path, and their DDL is written as custom SQL.
- Dev phase (until the first production go-live, DL50): DB data is disposable. Migrations may be edited, squashed or regenerated, and the DB dropped and recreated. After go-live, migrations are append-only.
- The same DB also holds schema `dss` (table `dss."RequestLogs"`). The DSS middleware (`psd-bwc-dss-services`, env `REQUEST_LOG_DATABASE_URL`) creates and writes it, and re-creates it after a DB reset. It is not one of our tables and Nest never reads it. drizzle-kit leaves it alone because `drizzle.config.ts` has no `schemaFilter` (so only `public` is managed). Never add `dss` to a `schemaFilter`, or push/generate will offer to drop it. See `04-database-design.md` §4.4 I.

**API**
- Prefix is `/api`. All JSON is camelCase.
- List responses use the envelope `{ data, page, pageSize, total }`.
- Errors are `{ statusCode, code, message, details?, correlationId }`.
- Status codes:
  - out of data scope = **404**
  - state conflict = 409
  - `If-Match` / `RowVersion` mismatch = 412
- `availableActions` are computed on the server.

**Access**
- Roles are `SUPER_ADMIN`, `ADMIN`, `OPERATOR` and `VIEWER` (web), plus `TEAM_LEADER` (mobile only, DL47). Never add "Safety" to role names (DL48).
  - `SUPER_ADMIN`: super admin for our dev/ops team, not a customer role (DL55). Bypasses permission and scope checks (still audited). Customer-facing material (Paper brief, diagrams) shows only the 4 customer roles and never the SUPER_ADMIN-only pages (audit log, system settings).
  - `ADMIN` (DL51): company admin, scope `all`, no bypass. Has `OPERATOR`'s permissions plus `org:manage`, `users:read`, `users:manage`. Manages users of every role except `SUPER_ADMIN`. `SUPER_ADMIN` accounts are hidden from every non-`SUPER_ADMIN` caller (DL55): `GET /users`, the Entra page, the employee account picker and `GET /roles` leave them out, and `/users/:id` on an `SUPER_ADMIN` account returns 404. Assigning role `SUPER_ADMIN` ⇒ 403 `SUPER_ADMIN_ACCOUNT_PROTECTED`. Can never hold the `SUPER_ADMIN`-reserved permissions (`audit:view`, `settings:manage`, `roles:manage` — DL53); granting them to any non-`SUPER_ADMIN` role ⇒ 400 `PERMISSION_RESERVED_FOR_SUPER_ADMIN`. Enforce both in the service, not only in the UI.
  - `OPERATOR` replaces the reference's Supervisor and Dispatcher roles (the requirement's department/division manager). It monitors (map, live wall, live dialogs from work orders and the map, talk in every live view — DL62), plays back / exports evidence and acks alerts. It has no link, classify, review or team-management duties (DL33, DL53).
  - `TEAM_LEADER`: field team leader. The mobile app is for this role only: live of their own camera + Booking job details (`/mobile/me`, `/mobile/jobs`, `/streams/live`). No web UI, no playback, GPS, camera-status or user management. Check-in / check-out still happens in the Booking app.
  - Team leaders log in with Entra SSO if they have an Entra account, otherwise with username/password like the reference (`/auth/login`, lockout, refresh rotation) (DL49).
  - The mobile app is built by our own team. Live + job details is the starting scope; the team may add or remove features by adding `/api/mobile/*` endpoints and `TEAM_LEADER` permissions through a data migration (DL49).
- Scope levels are only `all` (every web role: `SUPER_ADMIN`, `ADMIN`, `OPERATOR`, `VIEWER`) and `team` (`TEAM_LEADER`: the team the user's employee currently leads; jobs by `BookingJobs.TeamId` / `LeaderUserId`, cameras of that team or in its open jobs' `DeviceRefs`). No `department` scope (DL53).
- The permission catalog has exactly 24 codes (DL53, Part 5 §5.7). Removed: `sessions:read`, `teams:read`, `teams:manage`, `devices:manage`, `devices:sync`, `integration:view`, `integration:manage`.
- Socket.IO rooms: `org`, `user:{id}`, `tracking` (needs `tracking:view`), `alerts` (needs `alerts:view`), `team:{id}`. No `dept:*` rooms.
- Every endpoint needs `@RequirePermission` + `@Audit` and applies data scope at the query layer.

**Reference data**
- Permissions, roles and Settings ship only through **idempotent data migrations**. Seed is for dev only.
- Adding a setting means updating `SETTING_DEFAULTS` + `SETTING_BOUNDS` + a data migration.

**Retention**: GPS 3 months · work orders 3 months · audit log 12 months · no archive.

**Frontend**: keep the reference design system (OKLCH tokens and the `client/DESIGN.md` rules). Use a real `/work-orders/:id` route, not the reference's `?open=` dialog.
- UI text (web and mobile) never names the data source (DL64): no "จาก / โดย / ใน Booking" or "Smart Booking" in statuses, titles, descriptions, reasons or alerts — e.g. WO `Cancelled` = "ยกเลิก", `AwaitingMatch` = "รอข้อมูลใบงาน", panel "ข้อมูลงาน". Only reference-number labels keep the word: "เลข Booking", "รหัสอ้างอิง Booking" and the search hint "เลขใบงาน / Booking / DO / SH". Code and blueprint names (`Booking*`) stay.
- The web menu is exactly 11 items in 4 groups (DL53, replaces the DL36 main menus):
  - ภาพรวม: แดชบอร์ด `/`
  - ปฏิบัติงาน: ภาพสดหลายจอ `/live-wall`, ใบงาน `/work-orders` (+ `/work-orders/:id`), วิดีโอย้อนหลัง `/evidence` (the old หลักฐาน page), แผนที่ติดตาม `/tracking`, ประวัติเส้นทาง `/tracking/history`
  - ผู้ใช้และสิทธิ์: ผู้ใช้ระบบ `/users`, ผู้ใช้จาก Entra `/entra-users` (port of the reference page: `GET /users/entra-directory`, `POST /users/sync-entra` `{ dryRun, matchByUsername? }`, create accounts from Entra rows one by one or in bulk with one role; needs `users:manage`; `ADMIN` cannot assign `SUPER_ADMIN`)
  - ระบบ: แจ้งเตือน `/notifications`, ประวัติการใช้งาน `/audit-logs`, ตั้งค่าระบบ `/settings`
- Removed, menus and code (DL53): departments, Bodycam device pages, teams, depots, the integration status page (only `SUPER_ADMIN` alerts + the stale banner remain), tracking sessions, the `/recordings` route (per-camera playback now lives in วิดีโอย้อนหลัง, DL59), the per-camera Live menu, `/booking-jobs`.
- ใบงาน `/work-orders` = table of Booking work orders (status tabs, the job's cameras with a live button when online, a playback button for checked-in jobs only, whose dialog lists only recordings inside the job's `workWindow`, DL59). `VIEWER` is read-only.
- วิดีโอย้อนหลัง `/evidence` = per-camera search (DL59): pick a camera + day (≤ 24h per search) → every recorded segment, each tagged with its work order (from that camera's attached session) or "ไม่ผูกใบงาน" → playback / MP4 download; needs `playback:view`. The work-order dialog (ใบงาน list and detail) lists only segments inside the job's `workWindow` (Booking check-in → check-out, computed by the server) and clips playback to it; the "อยู่ในช่วงใบงาน" badge is gone. Reuse an export with the same device + channel + exact start/end that is queued, processing or ready and unexpired.

## Editing the blueprint

- Use the names from Part 4. A change that renames or adds a table, column, enum, permission, setting or alert must be applied to **every Part that mentions it**, including the README summary.
- Mark every fact about Booking as **[Assumption]** or **[Confirmed]**.
- Record each user decision in Part 9 §9.5 with its Q number.
- After editing diagrams, check that every Mermaid block still parses with Mermaid 11.
