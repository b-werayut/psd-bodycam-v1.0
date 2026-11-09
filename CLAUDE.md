# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**psd-bodycam-v1.0** — a new Bodycam-only tracking and work-order system. It rebuilds the Bodycam part of the reference project `C:\Git\Internal-BodyCam` (with Dashcam and vehicles removed entirely) and links camera usage to work orders from an external **Booking** system.

## Language policy

- Talk to the user in **Thai**, keeping technical terms in English.
- Everything under `docs/` is Thai. UI strings default to Thai (i18n th/en).
- This file is in English only to save tokens.

## Current state: design only, no code yet

- `client/` and `server/` are empty. There is no `package.json`, so **there are no build, lint or test commands yet**. They are created in roadmap phase P0.
- The source of truth is **`docs/blueprint/`**. Read the relevant Part before designing or implementing anything:

| Part | Use it for |
|---|---|
| `README.md` | Summary, glossary, the recommended architecture/schema/plan |
| `01-existing-system-analysis.md` | What to reuse / refactor / remove / rebuild from the reference, with real paths |
| `02-system-architecture.md` | Modules, process roles, dependency rules, failure isolation, security |
| `03-business-workflows.md` | Session lifecycle, `decide()` decision table, matching algorithm, Booking-driven status, Settings keys |
| `04-database-design.md` | **Canonical names** for tables, columns, enums, constraints and indexes, plus retention and migration strategy |
| `05-api-design.md` | REST endpoints, error codes, mobile API, Socket.IO events, alert types, permission matrix |
| `06-frontend-architecture.md` | Folder structure, routes, screens, component reuse, status→tone mapping |
| `07-integration-strategy.md` | Booking port/adapters, pull-only sync, the API we ask Booking for, inbox, retry, idempotency, Confirmed vs Assumption |
| `08-implementation-roadmap.md` | Phases P0–P6 with dependencies and acceptance criteria |
| `09-risks-open-questions.md` | Risks, the Booking checklist, and the **decision log §9.5** (user decisions DL1–DL39) |

- Implement in roadmap order.
- P3c (the real Booking `http` adapter) is blocked until the Booking team provides a spec. Until then, build on the `mock` adapter (DL25).
- Once code exists, code is the truth. When docs disagree with code, fix the docs.

## Reference project (read-only)

- `C:\Git\Internal-BodyCam` is **reference only. Never create or modify files there** (user requirement). Reading it is fine.
- Its `CLAUDE.md` is about 400KB. Read it by offset or grep, never whole.
- Its code is more reliable than its docs.
- Main things to port (details and paths in Part 1 §1.5):
  - Server: `server/src/common/*`, `modules/auth`, `modules/realtime`, the GPS pipeline (`modules/tracking/tracking.service.ts`, `modules/scheduler/gps-poll.service.ts`), DSS providers, `modules/streaming` and `modules/talk`.
  - Client: `client/src/styles/tailwind.css` (OKLCH tokens), `client/DESIGN.md`, `components/ui`, `components/command-center`, the app shell, `lib/apiClient.ts`, `features/evidence` (DL36).
- Its `scheduler/camera-session.service.ts` is the **anti-pattern** being replaced: a pseudo work order plus reserved seed rows, `.limit(100)` with no `ORDER BY`, and a reopen loop.

## Planned commands (mirror the reference scripts in P0)

Server (NestJS):
- `npm run start:api:dev` / `npm run start:worker:dev` — two entry points, `main.api.ts` and `main.worker.ts`
- `npm run typecheck`
- `npm test` — Vitest unit tests, `*.test.ts`
- `npm run test:int` — integration tests, `*.int-test.ts`. They need a Postgres database whose name ends in `_test`, plus Redis.
- `npm run db:generate` / `npm run db:migrate` — drizzle-kit
- Single test: `npx vitest run path/to/file.test.ts -t "test name"`

Client (Vite):
- `npm run dev` / `npm run build` / `npm run typecheck` / `npm test`
- Planned change from the reference: `build` must also typecheck, and ESLint is added (Part 6 §6.1).

## Architecture (big picture)

**Process model**
- NestJS **modular monolith**. Two process types come from one codebase: `api` and `worker`.
- The worker is split by `WORKER_ROLES=tracking,integration,media`, so roles can become separate pods later without code changes.
- Redis provides the Socket.IO adapter/emitter, locks, rate limiting, BullMQ queues and the circuit-breaker state.

**Two paths that must stay isolated**
- *Real-time path*: DSS (GpsPoll) → `device-status` → `DeviceState` (internal, feeds the session engine) and `gps:batch` → Socket.IO. It **never calls Booking**.
  - No `device:status` push (DL35): screens that show camera status fetch it from DSS on open (`api` → DSS middleware). Other events (`gps:batch`, `session:*`, `workorder:changed`, `alert:new`, …) stay.
- *Booking path* (worker `integration` role): `BookingProvider` port (`mock` | `http` | `csv`) → `IntegrationInbox` → `BookingJobs` (local projection) + its `WorkOrders` row (1:1 upsert by the inbox processor, DL33) → queue `matching` attaches sessions.
  - Matching reads only the projection; it never calls the Booking API live.
  - **Pull only (DL31)**: change feed every 2 min + nightly full reconcile + per-job refresh. No inbound Booking webhook, no write-back, no `IntegrationOutbox`. Booking links to us via `/work-orders/by-booking/{externalJobId}`.
  - `booking-integration` must not import `sessions` or the `work-orders` matcher; matching is handed over through the queue `matching` only. Single exception (Part 2 §2.4 rule 1): the inbox processor calls the `work-orders` writer to upsert the `WorkOrders` row in the same transaction as the projection.

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
- DSS middleware = `psd-bwc-dss-services` (FastAPI). It calls the Dahua DSS server and keeps the DSS tokens; HLS goes through its `/proxy`.

**Work order status follows Booking**
- A work order's department (data scope) comes from Booking (`departmentRef` → `Departments.BookingDepartmentRef`, DL38); unmapped ⇒ root department + `MappingIssues`.
- Statuses: `Planned` (synced, no check-in yet, DL37) → `Open` (check-in) → `Closed` (check-out, `BookingCheckout`); a new check-in reopens; a Booking cancel sets `Cancelled`.
- There is **no human close, reopen, link, unlink, merge or void** in this system.
- Open work orders with no check-out raise an alert 36h after check-in and close after 7 days (`SafetyTimeout`). `Planned` ones close only when Booking says so.
- `NeedsReview` is only an info badge + Admin alert. There is no review queue and no SLA.

**Unmatched sessions (DL33)**
- No candidate, or several candidates ⇒ the session stays `AwaitingMatch` (or `NoTeam`). No work order is created.
- It re-matches automatically when Booking data changes (`matching.rematch`, within `booking.rematch-horizon-hours`).
- No manual link, no human classify, no review queue. Sessions without a work order are viewed per camera in `/recordings`.

**Matching** (automatic only)
- Order: `BookingJobs.DeviceRefs` first, then the team ref, then the team-leader ref. Exactly one winning candidate ⇒ attach.
- **Camera↔job/team binding comes only from Booking.** There is no screen to bind cameras in this system.
- Every decision is recorded in `MatchAttempts`.

**Charging at base**
- A camera at a depot is not work: the system sets `Classification = IdleOrCharging` on its session. Detection uses the `Depots` radius plus the latest GPS fix.
- The vendor has no charging state.

**Evidence storage (DL34)**: exported MP4 files go to a local-disk PVC (`STORAGE_DRIVER=local`) shared by `api` and `worker-media`, and are deleted after 24h (`EvidenceCleanup`). No MinIO / object storage. Source video stays on the Dahua DSS server.

**Invariants live in the DB** (partial uniques, exclusion constraints, CHECKs):
- `UQ_TS_OpenPerDevice` and `EX_TS_NoOverlap`
- `UQ_WO_BookingJob` (plain unique; `BookingJobId` NOT NULL)
- The exclusion constraints need `btree_gist`.
- Removed enum values (e.g. WO `Voided` / `Merged`, `NoBookingData`) stay reserved: never reuse their numbers.

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
- Roles are `ADMIN`, `OPERATOR` and `VIEWER`.
  - `OPERATOR` replaces the reference's Supervisor and Dispatcher roles. It monitors (map, live, live wall, talk), plays back / exports evidence, manages teams and acks alerts. It has no link, classify or review duties (DL33).
  - There is no team-leader role: team leaders use the Booking app.
  - The mobile app is for Operator, Admin and Viewer.
- Scope levels are `all` and `department` (subtree).
- Every endpoint needs `@RequirePermission` + `@Audit` and applies data scope at the query layer.

**Reference data**
- Permissions, roles and Settings ship only through **idempotent data migrations**. Seed is for dev only.
- Adding a setting means updating `SETTING_DEFAULTS` + `SETTING_BOUNDS` + a data migration.

**Retention**: GPS 3 months · work orders 3 months · audit log 12 months · no archive.

**Frontend**: keep the reference design system (OKLCH tokens and the `client/DESIGN.md` rules). Use a real `/work-orders/:id` route, not the reference's `?open=` dialog.
- Main menus (DL36): **Live** (`/live-wall` + live from the device list) and **หลักฐาน** `/evidence` (work order → camera + time range from its sessions → playback / MP4 download; reuse an export with the same device + channel + exact start/end that is queued, processing or ready and unexpired). `/recordings` stays for per-camera search.

## Editing the blueprint

- Use the names from Part 4. A change that renames or adds a table, column, enum, permission, setting or alert must be applied to **every Part that mentions it**, including the README summary.
- Mark every fact about Booking as **[Assumption]** or **[Confirmed]**.
- Record each user decision in Part 9 §9.5 with its Q number.
- After editing diagrams, check that every Mermaid block still parses with Mermaid 11.
