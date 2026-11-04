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
| `07-integration-strategy.md` | Booking port/adapters, sync, inbox/outbox, retry, idempotency, Confirmed vs Assumption |
| `08-implementation-roadmap.md` | Phases P0–P6 with dependencies and acceptance criteria |
| `09-risks-open-questions.md` | Risks, the Booking checklist, and the **decision log §9.5** (user decisions DL1–DL28) |

- Implement in roadmap order.
- P3c (the real Booking `http` adapter) is blocked until the Booking team provides a spec. Until then, build on the `mock` adapter (DL25).
- Once code exists, code is the truth. When docs disagree with code, fix the docs.

## Reference project (read-only)

- `C:\Git\Internal-BodyCam` is **reference only. Never create or modify files there** (user requirement). Reading it is fine.
- Its `CLAUDE.md` is about 400KB. Read it by offset or grep, never whole.
- Its code is more reliable than its docs.
- Main things to port (details and paths in Part 1 §1.5):
  - Server: `server/src/common/*`, `modules/auth`, `modules/realtime`, the GPS pipeline (`modules/tracking/tracking.service.ts`, `modules/scheduler/gps-poll.service.ts`), DSS providers, `modules/device-status-mq/brms-mq.service.ts`, `modules/streaming` and `modules/talk`, webhook HMAC (`modules/tracking/webhook-auth.ts`).
  - Client: `client/src/styles/tailwind.css` (OKLCH tokens), `client/DESIGN.md`, `components/ui`, `components/command-center`, the app shell, `lib/apiClient.ts`.
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
- *Real-time path*: DSS / BRMS → `device-status` → `DeviceState` → Socket.IO. It **never calls Booking**.
- *Booking path* (worker `integration` role): `BookingProvider` port (`mock` | `http` | `csv`) → `IntegrationInbox` → `BookingJobs` (local projection) → queue `matching` → `WorkOrders`.
  - Matching reads only the projection; it never calls the Booking API live.
  - `booking-integration` must not import `sessions` or `work-orders`. It hands work over through the queue only.

**Core domain**
- `TrackingSessions` record observed camera use. `WorkOrders` are business records linked to 0..1 Booking job. **There are no pseudo work orders.**
- A session is one camera continuously on and attached to one work order. One work order holds many sessions; one Booking job maps to one work order.

**Session engine** (`sessions` module, worker `tracking` role)
- Runs as a level-triggered sweep every 30s over **all** devices, ordered by `Id`.
- For each device it locks `DeviceState` with `SELECT … FOR UPDATE`, runs a pure `decide()`, then applies the result. Time comes from the DB `now()`.
- It is the **only writer of session lifecycle** (open, close, split).
- Global lock order: `DeviceState` (by `DeviceId` ascending) → `WorkOrders` (by `Id` ascending) → `TrackingSessions`.

**Device status**
- UNKNOWN is computed from how stale `LastObservedAt` is. **Never write null on an MQ reset.**
- Source priority: BRMS MQ > DSS device list > `/location` > webhook.
- "Camera on" comes from platform status, not GPS: most cameras have no GPS fix indoors.

**Work order status follows Booking**
- Check-out closes the work order (`BookingCheckout`); a new check-in reopens it.
- There is **no human close or reopen** in this system.
- Void is `ADMIN`-only and only for work orders not linked to Booking.

**Work orders not linked to Booking (Part 3 §3.3.4)**
- They collect into one open work order per team, or per device when the team is unknown.
- If no Booking data matches within 240 minutes, the system closes it (`NoBookingData`) and it goes to the review queue.
- Linked work orders with no check-out raise an alert after 36h and close after 7 days (`SafetyTimeout`).
- The review queue SLA is 36h.

**Matching**
- Order: `BookingJobs.DeviceRefs` first, then the team ref, then the team-leader ref.
- **Camera↔job/team binding comes only from Booking.** There is no screen to bind cameras in this system.
- A manual link always wins over an automatic one.
- Every decision is recorded in `MatchAttempts`.

**Charging at base**
- A camera charging at a depot creates no work order. Detection uses the `Depots` radius plus the latest GPS fix.
- Work orders not linked to Booking that have no recordings at all are auto-voided.
- The vendor has no charging state.

**Invariants live in the DB** (partial uniques, exclusion constraints, CHECKs):
- `UQ_TS_OpenPerDevice` and `EX_TS_NoOverlap`
- `UQ_WO_BookingJob`
- `UQ_WO_OpenUnlinkedPerTeam` and `UQ_WO_OpenUnlinkedPerDevice`
- `CK_WO_LinkConsistency`
- The exclusion constraints need `btree_gist`.

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
  - `OPERATOR` replaces the reference's Supervisor and Dispatcher roles.
  - There is no team-leader role: team leaders use the Booking app.
  - The mobile app is for Operator, Admin and Viewer.
- Scope levels are `all` and `department` (subtree).
- Every endpoint needs `@RequirePermission` + `@Audit` and applies data scope at the query layer.

**Reference data**
- Permissions, roles and Settings ship only through **idempotent data migrations**. Seed is for dev only.
- Adding a setting means updating `SETTING_DEFAULTS` + `SETTING_BOUNDS` + a data migration.

**Retention**: GPS 3 months · work orders 3 months · audit log 12 months · no archive.

**Frontend**: keep the reference design system (OKLCH tokens and the `client/DESIGN.md` rules). Use a real `/work-orders/:id` route, not the reference's `?open=` dialog.

## Editing the blueprint

- Use the names from Part 4. A change that renames or adds a table, column, enum, permission, setting or alert must be applied to **every Part that mentions it**, including the README summary.
- Mark every fact about Booking as **[Assumption]** or **[Confirmed]**.
- Record each user decision in Part 9 §9.5 with its Q number.
- After editing diagrams, check that every Mermaid block still parses with Mermaid 11.
