# P0 Server Foundation (ฉบับปรับใหม่ 2026-11-20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำ `server/` ของ P0 ให้ครบ — drift guard, permission catalog 24 ตัว + 4 role web, auth (password + Entra SSO), กติกา `COMPANY_ADMIN` / ซ่อนบัญชี `ADMIN`, audit, settings, API ผู้ใช้ / role / พนักงาน / ผู้ใช้จาก Entra และ realtime skeleton — ให้ client P0 ต่อ API จริงได้บนเครื่อง dev local และ P1 / P3a ต่อยอดได้ทันที

**Architecture:** NestJS modular monolith (`main.api.ts` + `main.worker.ts`) · infra กลางอยู่ `server/src/common/*` port จาก `C:\Git\Internal-BodyCam\server\src\common\*` (ตัด company / department) · domain module อยู่ `server/src/modules/*` · Drizzle บน PostgreSQL 16 · invariant อยู่ใน DB · reference data ส่งด้วย data migration เท่านั้น

**Tech Stack:** ของเดิมใน `server/package.json` (Node 22, NestJS ^10.4.15, drizzle-orm ^0.45.2, postgres ^3.4.9, redis ^4.7.1, socket.io ^4.8.1, jose ^5.10.0, @node-rs/argon2 ^2.0.2, nestjs-pino ^4.1.0, vitest ^2.1.9, supertest ^7.2.2) + เพิ่ม `cookie-parser ^1.4.7` / `@types/cookie-parser ^1.4.8` (Task 4) และ `helmet ^8.0.0` (Task 11)

**Spec:** `docs/blueprint/README.md` · Part 2 §2.3, §2.4, §2.8, §2.9 · Part 4 §4.1, §4.4 A + H, §4.7 · Part 5 §5.1, §5.2 (Auth, Users/Roles/Employees, System), §5.5, §5.7 · Part 8 P0 · decision log Part 9 §9.5 (โดยเฉพาะ DL50, DL51, DL53, DL55, DL60, DL63) · แผนนี้แทน `2026-11-04-p0-server-foundation.md`

## สถานะตั้งต้น (มีแล้วใน repo — ไม่ต้องทำซ้ำ)

- Scaffold + `GET /api/health`, ESLint, Vitest unit/int config
- `common/config/*` (cors, trust-proxy, prod-readiness, refresh-ttl, worker-roles), `common/context/*` (correlationId), `common/logging/*` (pino), `common/errors/*` (`AppException`, `GlobalExceptionFilter`, `ERROR_CODE_BY_STATUS`), `common/http/apply-http-basics.ts`, `bootstrap/configure-app.ts`
- `db/*`: `DbModule` (`DRIZZLE`), `DrizzleDB` / `DrizzleTx` / `DrizzleExecutor`, `columns.ts`, `schema.ts` (9 ตาราง P0), `schema.partitioned.ts` (`AuditLogs`), `migrate.entry.ts`, `migration-status.ts` + `migration-check.ts` (ยังไม่มี test และยังไม่ถูกเรียกตอน boot)
- migrations `0000_baseline`, `0001_extensions_partitions`, `0002_drop_departments`
- test harness: `src/test/int-setup.ts`, `int-helpers.ts` (`bootHttpContext`, `asUser`, `eventually`), `scripts/prepare-test-db.ts`
- unit test 46 ตัวผ่าน · `.github/workflows/ci.yml` มี job `client` และ `server` (Postgres 16 + Redis service, รัน `db:prepare:test` + `test:int`) แล้ว
- **ยังไม่เคยรัน integration test สำเร็จ**: ledger เดิม (`.superpowers/sdd/2026-11-04-p0-server-foundation/progress.md`) บันทึกว่า Task 4 ติด login role `bwc` · ตอนนี้ `server/.env` ตั้ง `DATABASE_URL_TEST` ชี้ DB `internal_bodycam` ⇒ harness ปฏิเสธ (ชื่อต้องลงท้าย `_test`) — ต้องแก้ก่อน Task 1
- กติกาจาก ledger เดิมที่ยังใช้: R8 (`refresh-ttl` อยู่ `common/config/` ห้ามสร้างซ้ำใน `modules/auth`) · R9 (`PATCH /employees/:id` รับ `status`) · lockfile ต้องผ่าน `npm ci` ของ npm 10 (Node 22) แม้เครื่อง dev ใช้ Node 24

## Global Constraints

- `C:\Git\Internal-BodyCam` อ่านได้อย่างเดียว — copy โค้ดออกมา ห้ามเขียนที่นั่น · ห้ามแก้ repo บน Azure (`psd-bwc-*`)
- โค้ดทั้งหมดอยู่ใต้ `server/` · รันคำสั่งจาก `server/` ยกเว้นระบุ
- **สภาพแวดล้อม dev = เครื่อง local (DL63)**: PostgreSQL 18 ที่ `localhost:5432` + Redis (container `redis` port 6379) บนเครื่อง · DB ของระบบนี้ต้องเป็น database ใหม่ (`bwc` / `bwc_test`) **ห้ามชี้ DB ของระบบเดิม** (`internal_bodycam` ฯลฯ) · ยังไม่ deploy Azure
- Role ใน P0 มี 4 ตัวพอดี: `ADMIN`, `COMPANY_ADMIN`, `OPERATOR`, `VIEWER` (`TEAM_LEADER` เพิ่มใน P5) · data scope มีแค่ `all` (scope `team` เพิ่มใน P5 · ไม่มี `department`)
- ของใน `common/*` ที่ Part 8 P0 ระบุแต่ **ยังไม่มีผู้ใช้ใน P0 จึงเลื่อนไป phase แรกที่ใช้**: `common/scope` (`DataScopeService` + predicate `team` — P5 · scope `all` ไม่ต้องกรอง), `common/queue` (BullMQ — P1 / P3a), `common/storage` (Local disk PVC — P4), `common/push` (FCM — P5)
- Permission catalog 24 ตัวตาม Part 5 §5.7 · permission สงวนของ `ADMIN` = `audit:view`, `settings:manage`, `roles:manage`
- `ADMIN` bypass permission แต่ยังถูก audit · `COMPANY_ADMIN` ไม่ bypass
- ผู้ใช้ที่ไม่ใช่ `ADMIN`: มองไม่เห็นบัญชี / role `ADMIN` (`/users/:id` ของบัญชี `ADMIN` ⇒ 404) · กำหนด role `ADMIN` ⇒ 403 `ADMIN_ACCOUNT_PROTECTED` · ให้ permission สงวนกับ role อื่น ⇒ 400 `PERMISSION_RESERVED_FOR_ADMIN` — บังคับใน service ไม่พึ่ง UI
- ทุก handler มี decorator สิทธิ์ **ตัวเดียวพอดี**: `@Public()` / `@LoginOnly()` / `@RequirePermission(...)` · ไม่มีเลย ⇒ guard ตอบ 403 และ test ครอบคลุมเส้นทาง fail · ทุก write มี `@Audit(action, resourceType)`
- API: prefix `/api` · JSON camelCase ทั้ง request / response · id เป็น string · list `{ data, page, pageSize, total }` (`pageSize` ≤ 100) · lookup `{ data, total }` · error `{ statusCode, code, message, details?, correlationId }` · `message` ภาษาไทย · นอก scope / ซ่อน = 404 · ขัดกัน = 409
- DB: ตาราง / คอลัมน์ PascalCase · PK bigint identity · `timestamptz` · enum `smallint` append-only · soft delete เฉพาะ master data · แผนนี้เพิ่ม migration ไฟล์ใหม่ต่อท้าย (`0003`, `0004`) ไม่แก้ไฟล์เดิม
- Role / permission / settings ส่งผ่าน custom data migration เท่านั้น (`ON CONFLICT DO NOTHING`) · `db:seed` ใช้เฉพาะ dev และปฏิเสธ `NODE_ENV=production`
- เพิ่ม setting = `SETTING_DEFAULTS` + `SETTING_BOUNDS` + data migration
- Emit realtime หลัง commit เท่านั้น
- Test: unit `src/**/*.test.ts` · integration `src/**/*.int-test.ts` (ต้องมี Postgres DB ชื่อลงท้าย `_test` + Redis)
- **ทำบน `main` และห้าม commit** (กติกาผู้ใช้ 2026-11-04): ห้าม `git add` / `commit` / `stash` / `reset` / `checkout` บน repo · ขั้น "Commit" ของแต่ละ task = เสนอ commit message ให้ผู้ใช้ commit เอง
- เมื่อโค้ดต่างจาก blueprint ให้แก้ blueprint ทุก Part ที่อ้างถึง (code = source of truth)

## Review Focus

1. **2 แท็บ refresh พร้อมกันด้วย cookie เดียวกัน** ⇒ คำขอที่สองต้องไม่ทำให้ "reuse ⇒ revoke ทั้งหมด" ผู้ใช้ยัง login อยู่ (Task 4: test race)
2. **พิมพ์ username ต่างตัวพิมพ์ / มีช่องว่าง** (`" Admin "`) ⇒ เข้าบัญชีเดียวกัน (Task 4: test normalize)
3. **`COMPANY_ADMIN` พยายามยกระดับสิทธิ์**: แก้ role ตัวเองเป็น `ADMIN`, ให้ `OPERATOR` ได้ `audit:view`, ยิง `PATCH /users/:id` ใส่ id ของบัญชี `ADMIN` ⇒ 403 / 400 / 404 และข้อมูลไม่เปลี่ยน (Task 7: test escalation)
4. **ระงับผู้ใช้ที่เปิด socket อยู่** ⇒ socket ได้ `session:revoked` แล้วถูกตัด, refresh token ถูก revoke (Task 10: test)
5. **Redis ล่มหรือยังไม่ได้เปิดบนเครื่อง dev** ⇒ login / refresh ยังใช้ได้ (rate limit นับในหน่วยความจำ, lock คืน `null` ไม่รันงาน) และ `/api/health/redis` ตอบ 503 (Task 3 + Task 11: test)

---

### Task 1: Drift guard ตอน boot + ต่อ `DbModule`

**Files:**
- Create: `server/src/db/assert-migrations.ts`
- Modify: `server/src/main.api.ts`, `server/src/main.worker.ts` (เรียก guard ก่อนสร้าง app), `server/src/app.module.ts` (import `DbModule`)
- Test: `server/src/db/migration-status.test.ts`, `server/src/db/migration-check.int-test.ts`

**Interfaces:**
- Consumes (มีแล้ว): `compareMigrations`, `describeMigrationStatus(status): MigrationReport` (`level: 'ok' | 'warn' | 'fail'`), `resolveMigrationCheckMode(env)`, `checkMigrations(sql, env)`, `resolveMigrationsFolder(env)` (อ่าน `DB_MIGRATIONS_DIR` ก่อน)
- Produces (port ตรงจาก reference `server/src/db/assert-migrations.ts`): `MigrationGuardResult = { blocked: boolean; report: MigrationReport }` · `checkMigrationsForBoot(env): Promise<MigrationGuardResult | null>` (`null` เมื่อ mode `off` · เปิด connection เองจาก `DATABASE_URL` แล้วปิด) · `guardMigrationsOrExit(env = process.env): Promise<void>` (blocked ⇒ log ไทย + `process.exit(1)`)

- [ ] **Step 0: เงื่อนไขก่อนเริ่ม (ผู้ใช้ทำ)** — `server/.env` ตั้ง `DATABASE_URL_TEST=postgres://<user>:<pass>@localhost:5432/bwc_test` · role ต่อ PostgreSQL ได้ · แล้วรัน `npm run db:prepare:test && npx vitest run --config vitest.integration.config.ts src/db/schema.int-test.ts` — Expected: PASS (ยืนยันงาน DB เดิมที่ยังไม่เคยรันกับ DB จริง · fail ⇒ แก้ schema / migration ก่อนไปต่อ)
- [ ] **Step 1: Port unit test** ของ reference `server/src/db/migration-status.test.ts` (`compareMigrations` ทุก verdict + `resolveMigrationCheckMode`: off = `off|false|no|0`, warn = `warn|warning`, enforce = `enforce|true|yes|1|strict`, ว่าง ⇒ enforce, ค่าแปลก ⇒ enforce + `error`)
- [ ] **Step 2: เขียน int test ที่ fail**

```ts
// migration-check.int-test.ts — tmp = copy ของ server/drizzle + journal entry เพิ่ม { idx: 99, tag: '9999_future', when: Date.now() } + ไฟล์ 9999_future.sql
it('ok on the migrated test DB', async () => {
  expect(await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'enforce' }))
    .toMatchObject({ blocked: false, report: { level: 'ok' } });
});
it('enforce blocks when a journal entry is not applied', async () => {
  expect(await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'enforce', DB_MIGRATIONS_DIR: tmp }))
    .toMatchObject({ blocked: true, report: { level: 'fail' } });
});
it('warn does not block', async () => {
  expect((await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'warn', DB_MIGRATIONS_DIR: tmp }))?.blocked).toBe(false);
});
it('off skips the check', async () => {
  expect(await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'off' })).toBeNull();
});
```

- [ ] **Step 3: Run** `npm run db:prepare:test && npx vitest run --config vitest.integration.config.ts src/db/migration-check.int-test.ts` — Expected: FAIL (`checkMigrationsForBoot` ไม่มี)
- [ ] **Step 4: Implement** port `assert-migrations.ts` · `main.api.ts` / `main.worker.ts` เรียก `await guardMigrationsOrExit()` เป็นบรรทัดแรกของ `bootstrap()` · `AppModule.imports` เพิ่ม `DbModule`
- [ ] **Step 5: Run** test ทั้งสองไฟล์ + `npm run typecheck` — Expected: PASS · รัน `npm run start:api:dev` กับ DB dev ที่ migrate แล้ว — Expected: log "migration ครบ" และ `/api/health` ตอบ 200
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): migration drift guard at boot`

### Task 2: Permission catalog, reference data migration, password / username helpers, dev seed

**Files:**
- Create: `server/src/common/auth/permission-catalog.ts`, `server/src/common/auth/password.ts`, `server/src/common/auth/username.ts`, `server/drizzle/0003_reference_data.sql` (`npm run db:generate -- --custom --name=reference_data`), `server/src/db/seed.ts`
- Modify: `server/.env.example` (`SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` แบบ comment)
- Test: `server/src/common/auth/permission-catalog.test.ts`, `server/src/common/auth/username.test.ts`, `server/src/db/reference-data.int-test.ts`

**Interfaces:**
- Produces:
  - `ROLE_CODES = ['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const` · `type RoleCode`
  - `ROLE_NAMES_TH: Record<RoleCode, string>` = `ผู้ดูแลระบบ`, `ผู้ดูแลบริษัท`, `ผู้ปฏิบัติการ`, `ผู้ดูข้อมูล`
  - `PERMISSION_CODES` (24 ตัว ตามลำดับ Part 5 §5.7): `dashboard:view, tracking:view, tracking:history, work-orders:read, work-orders:edit-note, booking:read, booking:refresh, devices:read, org:read, org:manage, users:read, users:manage, roles:manage, streaming:view-live, streaming:live-wall, streaming:talk, playback:view, evidence:export, evidence:download, notifications:read, alerts:view, alerts:manage, audit:view, settings:manage` · `type PermissionCode` · `isPermissionCode(x: string): x is PermissionCode`
  - `RESERVED_ADMIN_PERMISSIONS: readonly PermissionCode[] = ['audit:view', 'settings:manage', 'roles:manage']`
  - `ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]>` — `ADMIN` = ทั้ง 24 · `OPERATOR` (18) = `dashboard:view, tracking:view, tracking:history, work-orders:read, work-orders:edit-note, booking:read, booking:refresh, devices:read, org:read, streaming:view-live, streaming:live-wall, streaming:talk, playback:view, evidence:export, evidence:download, notifications:read, alerts:view, alerts:manage` · `COMPANY_ADMIN` (21) = `OPERATOR` + `org:manage, users:read, users:manage` · `VIEWER` (9) = `dashboard:view, tracking:view, tracking:history, work-orders:read, booking:read, devices:read, org:read, notifications:read, alerts:view`
  - `ROLE_SCOPE: Record<RoleCode, 'all'>` (P5 ขยาย type เป็น `'all' | 'team'`)
  - `hashPassword(plain: string): Promise<string>` / `verifyPassword(hash: string, plain: string): Promise<boolean>` (`@node-rs/argon2` ค่า default)
  - `normalizeUsername(raw: string): string` = trim + lowercase
  - Settings P0: `auth.max-failed-logins` = `3` (DL65), `auth.lockout-minutes` = `15` (`ValueType` 2 int, `Category` `auth`, คำอธิบายไทย) · ValueType: 1 string, 2 int, 3 bool
  - Dev seed users: `admin` (ADMIN · `SEED_ADMIN_PASSWORD || 'Admin@12345'`), `companyadmin1` (COMPANY_ADMIN), `operator1` (OPERATOR), `viewer1` (VIEWER) — 3 ตัวหลังใช้ `SEED_DEMO_PASSWORD || 'Demo@12345'` · employees `E0001` สมชาย ใจดี (ผูก `operator1`), `E0002` สมหญิง รักงาน (`BookingEmployeeRef = 'BK-EMP-0002'` — ใช้กับ booking-simulator ใน P3a)

- [ ] **Step 1: เขียน test ที่ fail**

```ts
// permission-catalog.test.ts
expect(PERMISSION_CODES).toHaveLength(24);
expect(new Set(PERMISSION_CODES).size).toBe(24);
expect(ROLE_PERMISSIONS.ADMIN).toEqual(PERMISSION_CODES);
expect(ROLE_PERMISSIONS.OPERATOR).toHaveLength(18);
expect(ROLE_PERMISSIONS.COMPANY_ADMIN).toEqual(expect.arrayContaining([...ROLE_PERMISSIONS.OPERATOR, 'org:manage', 'users:read', 'users:manage']));
expect(ROLE_PERMISSIONS.COMPANY_ADMIN).toHaveLength(21);
expect(ROLE_PERMISSIONS.VIEWER).toHaveLength(9);
for (const role of ['COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const)
  for (const p of RESERVED_ADMIN_PERMISSIONS) expect(ROLE_PERMISSIONS[role]).not.toContain(p);
// username.test.ts
expect(normalizeUsername('  Admin ')).toBe('admin');
// reference-data.int-test.ts (หลัง migrate)
expect((await sql`select "Code" from "Roles" order by "Code"`).map(r => r.Code)).toEqual(['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER']);
expect(await dbPermissionCodes()).toEqual([...PERMISSION_CODES].sort());
for (const role of ROLE_CODES) expect(await dbRolePermissions(role)).toEqual([...ROLE_PERMISSIONS[role]].sort());
expect(await settingValue('auth.max-failed-logins')).toBe('3');
expect(await settingValue('auth.lockout-minutes')).toBe('15');
// รัน SQL ของ 0003 ซ้ำอีกรอบ ⇒ ไม่ error และจำนวนแถวเท่าเดิม
```

- [ ] **Step 2: Run** `npx vitest run src/common/auth && npx vitest run --config vitest.integration.config.ts src/db/reference-data.int-test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** catalog + helpers · generate `0003_reference_data`: insert Roles (`IsSystem = true`, ชื่อไทย), Permissions (`Resource` / `Action` แยกที่ `:`), RolePermissions (join ด้วย code), Settings — ทุก statement `ON CONFLICT DO NOTHING` · int test นี้คือตัวกันไม่ให้ SQL กับ catalog เพี้ยนกัน (phase ถัดไปเพิ่ม migration ใหม่คู่กับแก้ catalog)
- [ ] **Step 4: Implement `seed.ts`** — `NODE_ENV === 'production'` ⇒ exit 1 พร้อมข้อความ · upsert users / employees ตาม Interfaces (username ผ่าน `normalizeUsername`, hash ผ่าน `hashPassword`) · ไม่แตะ RolePermissions / Settings
- [ ] **Step 5: Run** test ทั้งหมดของ step 2 — Expected: PASS · `npm run db:migrate && npm run db:seed` สองรอบบน DB dev — Expected: users 4 แถว, employees 2 แถว
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): permission catalog, reference data migration, dev seed`

### Task 3: Redis, locks, rate limiting

**Files:**
- Create: `server/src/common/redis/redis-connect.ts`, `redis.module.ts` · `server/src/common/lock/lock-key.ts`, `redis-lock.service.ts`, `lock.module.ts` · `server/src/common/rate-limit/rate-limit-specs.ts`, `rate-limit-plan.ts`, `fixed-window.ts`, `rate-limiter.service.ts`, `rate-limit.decorator.ts`, `rate-limit.guard.ts`, `rate-limit.module.ts`
- Test: `fixed-window.test.ts`, `rate-limit-specs.test.ts`, `lock-key.test.ts`, `server/src/common/lock/redis-lock.int-test.ts`, `server/src/common/rate-limit/rate-limit.int-test.ts`

**Interfaces:**
- Produces:
  - `REDIS_CLIENT` provider (`RedisClientType | null`) จาก `openOptionalRedis(logger, messages)` (port `common/realtime-bus/redis-connect.ts`) · `redisUrl(env)`, `redisConnectTimeoutMs(env)` (500–60000, default 5000)
  - `lockKey(key, env)` / `lockPrefix(env)` (port — prefix ต่อ environment)
  - `RedisLockService.withLock<T>(key: string, ttlSeconds: number, run: () => Promise<T>): Promise<T | null>` · `acquireLease(key, ttlSeconds, onLost?): Promise<LockLease | null>` · **ต่างจาก reference**: Redis ไม่พร้อม ⇒ `withLock` คืน `null` โดยไม่รัน `run` + log warn (fail-safe ของ sweep — Part 2 §2.6)
  - `type RateLimitName = 'auth-login' | 'auth-sso' | 'auth-refresh'` (phase ถัดไปต่อท้าย) · env `AUTH_LOGIN_RATE_LIMIT_PER_MIN` (60), `AUTH_SSO_RATE_LIMIT_PER_MIN` (60), `AUTH_REFRESH_RATE_LIMIT_PER_MIN` (120) · key ตาม IP
  - `RateLimiterService.hit(name, key)` — นับที่ Redis (Lua `incr` + `expire`) · Redis ไม่ได้ต่อ ⇒ นับในหน่วยความจำ · Redis error ระหว่างนับ ⇒ ปล่อยผ่าน + log warn (port พฤติกรรม reference)
  - `@RateLimit(name)` · `RateLimitGuard` (ลงทะเบียนเป็น `APP_GUARD` ใน Task 4) · เกิน ⇒ `AppException(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง')` + header `Retry-After`

- [ ] **Step 1: Port unit test** ของ reference `fixed-window.test.ts`, `rate-limit-specs.test.ts`, `lock-key.test.ts` (ตัด spec ที่ไม่ใช่ 3 ชื่อข้างบน) และเพิ่ม: `withLock` เมื่อ client เป็น `null` ⇒ คืน `null` และ `run` ไม่ถูกเรียก
- [ ] **Step 2: เขียน int test ที่ fail**

```ts
// redis-lock.int-test.ts — withLock 2 ตัวพร้อมกัน key เดียว ⇒ รันตัวเดียว
const runs: number[] = [];
await Promise.all([
  lock.withLock('t', 5, async () => { runs.push(1); await sleep(200); }),
  lock.withLock('t', 5, async () => { runs.push(2); }),
]);
expect(runs).toHaveLength(1);
// rate-limit.int-test.ts — controller ทดสอบ @Public() @RateLimit('auth-login') กับ AUTH_LOGIN_RATE_LIMIT_PER_MIN=2
// ⇒ ครั้งที่ 3 จาก IP เดียวกันได้ 429 code TOO_MANY_REQUESTS และมี Retry-After
// REDIS_URL ชี้ port ที่ไม่มีใคร listen ⇒ ครั้งที่ 1–2 ผ่าน, ครั้งที่ 3 ได้ 429 (นับในหน่วยความจำ)
```

- [ ] **Step 3: Run** — Expected: FAIL · **Step 4: Port / implement** · **Step 5: Run** — Expected: PASS
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): redis connection, locks, rate limiting`

### Task 4: Auth core — login, refresh rotation, logout, me, change-password, guards

**Files:**
- Modify: `server/src/common/auth/auth-user.ts` (เพิ่ม `AuthUser`, `JwtPayload`), `server/src/bootstrap/configure-app.ts` (`cookieParser()`), `server/src/db/schema.ts` (`RefreshTokens.ReplacedAt`), `server/.env.example` (`JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL`, `AUTH_PASSWORD_LOGIN_ENABLED`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `REFRESH_TOKEN_TTL_HOURS`), `docs/blueprint/04-database-design.md` (§4.4 A RefreshTokens เพิ่ม `ReplacedAt`)
- Create: `server/src/common/auth/public.decorator.ts`, `login-only.decorator.ts`, `require-permission.decorator.ts`, `current-user.decorator.ts`, `jwt-auth.guard.ts`, `permissions.guard.ts`, `permission-check.service.ts` · `server/src/modules/auth/jwt-access.module.ts`, `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `tokens.service.ts`, `lockout.ts`, `refresh-cookie.ts`, `refresh-reuse.ts`, `password-login.policy.ts`, `auth-settings.ts`, `auth.mapper.ts`, `dto/login.dto.ts`, `dto/change-password.dto.ts` · `server/drizzle/0004_refresh_replaced_at.sql` (`npm run db:generate -- --name=refresh_replaced_at`)
- Test: `lockout.test.ts`, `refresh-reuse.test.ts`, `refresh-cookie.test.ts`, `password-login.policy.test.ts`, `server/src/modules/auth/auth.int-test.ts`, `server/src/common/auth/route-guard-coverage.int-test.ts`

**Interfaces:**
- Consumes: `DRIZZLE`, `RoleCode` / `PermissionCode` / `ROLE_PERMISSIONS` / `RESERVED_ADMIN_PERMISSIONS` / `normalizeUsername` / `verifyPassword` (Task 2), `@RateLimit` + `RateLimitGuard` (Task 3), `resolveRefreshTtl` / `webRefreshTtlHours` (มีแล้วใน `common/config/refresh-ttl.ts`)
- Produces:
  - `JwtPayload = { sub: string; username: string; roleId: string; roleCode: RoleCode; permissions: PermissionCode[] }` · `AuthUser = AuthUserLike & { roleCode: RoleCode; permissions: PermissionCode[] }`
  - `@Public()`, `@LoginOnly()` (login แล้วไม่ต้องมี permission), `@RequirePermission(...codes: PermissionCode[])` (ต้องครบทุกตัว), `@CurrentUser()`
  - `APP_GUARD` เรียงตามนี้: `JwtAuthGuard` → `RateLimitGuard` → `PermissionsGuard` · `PermissionsGuard`: `ADMIN` ⇒ ผ่าน · handler ที่ไม่มี decorator สิทธิ์ ⇒ 403 `FORBIDDEN` (secure by default) · ไม่มี permission ⇒ 403 `FORBIDDEN` "ไม่มีสิทธิ์ใช้งานส่วนนี้"
  - `PermissionCheckService.roleGrants(roleId: bigint, roleCode: RoleCode): Promise<PermissionCode[]>` — `ADMIN` ⇒ ทั้ง catalog · role อื่น ⇒ แถว `RolePermissions` **ลบ `RESERVED_ADMIN_PERMISSIONS` ออกเสมอ** (กันแถวที่ถูกใส่ตรงใน DB) · `hasPermissionNow(user: AuthUserLike, code: PermissionCode): Promise<boolean>`
  - `AUTH_SETTINGS` token → `AuthSettings { getLockoutPolicy(): Promise<{ maxFailed: number; lockMinutes: number }> }` · ใน task นี้ bind `StaticAuthSettings` (`{ maxFailed: 3, lockMinutes: 15 }`) · Task 6 เปลี่ยนเป็น `SettingsService`
  - `USER_STATUS = { ACTIVE: 1, INACTIVE: 2 } as const` (3 สงวนไว้ — client มี `LOCKED: 3`)
  - `TokensService.signAccessToken(user: AuthUser): Promise<string>` (HS256 `JWT_ACCESS_SECRET` · dev fallback `'dev-insecure-jwt-secret-change-me'` · production ไม่ตั้ง ⇒ throw ตอน boot · `ACCESS_TOKEN_TTL` default `15m`) · `issueRefreshToken(userId: bigint, ip?: string, userAgent?: string): Promise<string>` · `rotate(raw: string, ip?: string, userAgent?: string): Promise<{ userId: bigint; newRaw: string }>` (`SELECT … FOR UPDATE` แถว token + ตั้ง `ReplacedAt`) · `revoke(raw: string): Promise<bigint | null>` · `revokeAllForUser(userId: bigint, tx?: DrizzleExecutor): Promise<number>`
  - `REFRESH_COOKIE = 'refresh_token'`, `REFRESH_COOKIE_PATH = '/api/auth'` · cookie `httpOnly`, `secure` = `COOKIE_SECURE === 'true'`, `sameSite` = `COOKIE_SAMESITE` (default `lax`), `maxAge` = `webRefreshTtlHours(env)` ชั่วโมง · P0 รับ refresh จาก cookie เท่านั้น (body สำหรับมือถือเพิ่มใน P5)
  - `REFRESH_REUSE_GRACE_SECONDS = 10` · `refreshTokenState(row: { RevokedAt: Date | null; ReplacedByTokenId: bigint | null; ReplacedAt: Date | null }, now: Date): 'live' | 'ended' | 'reuse' | 'race'`
  - `AuthUserView = { id: string; username: string; fullName: string; email: string | null; roleCode: RoleCode; roleName: string; permissions: PermissionCode[] }` (ตรงกับ `AuthUser` ของ client `client/src/stores/authStore.ts`)
  - HTTP: `POST /api/auth/login { username, password }` (`@Public`, `@RateLimit('auth-login')`, `@HttpCode(200)`) → `{ accessToken, user: AuthUserView }` + set cookie · `POST /api/auth/refresh` (`@Public`, `@RateLimit('auth-refresh')`, 200) → `{ accessToken, user }` + cookie ใหม่ · `POST /api/auth/logout` (`@Public`, 204 · revoke token ใน cookie + ล้าง cookie) · `GET /api/auth/me` (`@LoginOnly`) → `AuthUserView` · `POST /api/auth/change-password { oldPassword, newPassword }` (`@LoginOnly`, 204 · `newPassword` 10–200 ตัว · revoke refresh token อื่นทั้งหมดของผู้ใช้)
  - Error codes: `INVALID_CREDENTIALS` 401 · `ACCOUNT_LOCKED_TEMPORARY` 401 (`details.retryAfterMinutes`) · `ACCOUNT_DISABLED` 401 · `PASSWORD_LOGIN_DISABLED` 403 · `REFRESH_INVALID` 401 · `REFRESH_RACE` 401 (ไม่ revoke ทั้งหมด — client `apiClient.ts` retry เมื่อเจอ code นี้) · `INVALID_CURRENT_PASSWORD` 400 · `PASSWORD_NOT_SET` 400 (บัญชี SSO-only)

- [ ] **Step 1: Port unit test** ของ reference `lockout.test.ts`, `password-login.policy.test.ts`, `refresh-cookie.test.ts` (ตัด PIN / device / company) และเพิ่ม:

```ts
const t0 = new Date('2026-11-20T00:00:00Z');
expect(refreshTokenState({ RevokedAt: null, ReplacedByTokenId: null, ReplacedAt: null }, t0)).toBe('live');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, new Date(t0.getTime() + 5_000))).toBe('race');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, new Date(t0.getTime() + 11_000))).toBe('reuse');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: null, ReplacedAt: null }, t0)).toBe('ended');
```

- [ ] **Step 2: เขียน int test ที่ fail** (`auth.int-test.ts` สร้าง user ของตัวเองด้วย `hashPassword`)

```ts
it('logs in with case/space-insensitive username', async () => {
  const r = await http.post('/api/auth/login').send({ username: ' Admin ', password: 'Admin@12345' });
  expect(r.status).toBe(200); expect(r.body.user.username).toBe('admin');
  expect(r.body.user.permissions).toHaveLength(24);
  expect(r.headers['set-cookie'][0]).toMatch(/refresh_token=.*Path=\/api\/auth.*HttpOnly/);
});
it('COMPANY_ADMIN token never carries reserved permissions', async () => {
  await sql`insert into "RolePermissions" select r."Id", p."Id", now() from "Roles" r, "Permissions" p
            where r."Code" = 'COMPANY_ADMIN' and p."Code" = 'audit:view' on conflict do nothing`;
  const r = await login('companyadmin1');
  expect(r.body.user.permissions).not.toContain('audit:view');
});
it('locks after 3 wrong passwords and reports minutes', async () => { /* code ACCOUNT_LOCKED_TEMPORARY, details.retryAfterMinutes > 0 */ });
it('Status=2 cannot log in', async () => { /* 401 ACCOUNT_DISABLED */ });
it('rotates refresh token; reuse after grace revokes all', async () => {
  /* refresh ด้วย cookie A → ได้ B · update ReplacedAt ของ A = now() - 11s · refresh ด้วย A → 401 REFRESH_INVALID · refresh ด้วย B → 401 */
});
it('two concurrent refreshes with the same token keep the session', async () => {
  const [a, b] = await Promise.all([refreshWith(cookieA), refreshWith(cookieA)]);
  expect([a.status, b.status].sort()).toEqual([200, 401]);
  expect([a.body.code, b.body.code]).toContain('REFRESH_RACE');
  expect((await refreshWith(cookieOf(a.status === 200 ? a : b))).status).toBe(200);
});
it('guards: no token 401, missing permission 403, ADMIN bypass', async () => { /* test controller @RequirePermission('audit:view') */ });
it('handler without a permission decorator is 403 even when logged in', async () => { /* test controller ไม่มี decorator */ });
// route-guard-coverage.int-test.ts: ไล่ทุก controller ของ AppModule ด้วย DiscoveryService + MetadataScanner
// ⇒ ทุก handler มี @Public / @LoginOnly / @RequirePermission ตัวเดียวพอดี (fail พร้อมรายชื่อ handler ที่ผิด)
```

- [ ] **Step 3: Run** — Expected: FAIL
- [ ] **Step 4: Implement** port reference `modules/auth` (ตัด PIN, `UserDevices`, Entra ไป Task 5, ตัด `employeeId` / `companyId` / department) · `normalizeUsername` ตอน login · migration `0004` เพิ่ม `ReplacedAt timestamptz` · ติดตั้ง `cookie-parser` · แก้ Part 4 §4.4 A ให้ตรงกับคอลัมน์ใหม่
- [ ] **Step 5: Run** — Expected: PASS · `npm run typecheck && npm run lint`
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): password auth, refresh rotation with race grace, guards`

### Task 5: Microsoft Entra SSO

**Files:**
- Create: `server/src/modules/auth/azure/azure-ad.config.ts`, `azure-claims.ts`, `entra-token.verifier.ts` · `server/src/modules/auth/dto/azure-login.dto.ts`
- Modify: `auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `server/.env.example` (`AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_ALLOWED_EMAIL_DOMAINS`)
- Test: `azure-ad.config.test.ts`, `azure-claims.test.ts`, `entra-token.verifier.test.ts`, `server/src/modules/auth/azure/azure-sso.int-test.ts`

**Interfaces:**
- Produces:
  - `AzureAdConfig = { enabled: boolean; tenantId: string; clientId: string; issuer: string; jwksUri: string; allowedEmailDomains: string[] }` · `readAzureAdConfig(env)` · `AZURE_AD_CONFIG` token
  - `class EntraTokenVerifier { constructor(config: AzureAdConfig, jwks?: JWTVerifyGetKey); verify(idToken: string): Promise<AzureIdentity> }` — jose `jwtVerify` RS256, issuer, audience = clientId, `clockTolerance` 60 · `jwks` default `createRemoteJWKSet(new URL(config.jwksUri))` (test ส่ง `createLocalJWKSet`)
  - `AzureIdentity = { objectId: string; email: string | null; displayName: string | null }`
  - `GET /api/auth/config` (`@Public`) → `{ sso: { enabled: false } | { enabled: true; clientId: string; tenantId: string; authority: string }; passwordLogin: { enabled: boolean } }` · `authority = https://login.microsoftonline.com/{tenantId}` (ตรงกับ `AuthConfig` ของ client)
  - `POST /api/auth/azure { idToken }` (`@Public`, `@RateLimit('auth-sso')`, 200) → เหมือน login · หา `Users.AzureObjectId = oid` ก่อน · ไม่เจอ ⇒ `lower(Email) = lower(email)` ที่ `AzureObjectId IS NULL` แล้วผูก `oid` · ไม่เจอ ⇒ 401 `SSO_ACCOUNT_NOT_FOUND` · `Status ≠ 1` ⇒ 401 `ACCOUNT_DISABLED` · SSO สำเร็จล้าง `FailedLoginCount` / `LockedUntil` เฉพาะเมื่อ lock เกิดจากรหัสผ่านผิด (`isPasswordAttemptLock`)
  - Boot throw เมื่อ SSO ปิด **และ** `AUTH_PASSWORD_LOGIN_ENABLED=false`

- [ ] **Step 1: Port test** ของ reference `azure-ad.config.test.ts`, `azure-claims.test.ts`
- [ ] **Step 2: เขียน test ที่ fail** — verifier กับ RS256 key pair ที่สร้างใน test: token ถูก ⇒ identity · `aud` ผิด ⇒ reject · หมดอายุเกิน 60s ⇒ reject · int: `oid` ที่ผูกแล้ว ⇒ 200 · email ตรงบัญชีที่ยังไม่ผูก ⇒ 200 และ `AzureObjectId` ถูกบันทึก · ไม่รู้จัก ⇒ 401 `SSO_ACCOUNT_NOT_FOUND` · `GET /api/auth/config` ⇒ `sso.enabled: true` ด้วย tenant ปลอมจาก `int-setup.ts`
- [ ] **Step 3: Run** — FAIL · **Step 4: Implement** (port) · **Step 5: Run** — PASS
- [ ] **Step 6: ทดสอบมือบนเครื่อง dev** — ต้องมี redirect URI `http://localhost:5173` (ชนิด SPA) ใน app registration ก่อน (DL63 · ตอนนี้ลงทะเบียนเฉพาะโดเมน frontend เดิม) · ถ้ายังไม่มี ให้บันทึกในรายงาน task ว่า "ทดสอบ SSO จริงค้างไว้" แล้วไปต่อ
- [ ] **Step 7: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): Microsoft Entra SSO login`

### Task 6: Audit log + settings

**Files:**
- Create: `server/src/common/audit/audit.decorator.ts`, `audit.interceptor.ts`, `audit-redact.ts`, `audit-writer.service.ts`, `audit.module.ts` · `server/src/modules/audit-logs/audit-logs.module.ts`, `audit-logs.controller.ts`, `audit-logs.service.ts`, `dto/query-audit-logs.dto.ts` · `server/src/common/settings/setting-spec.ts`, `settings.service.ts`, `settings.module.ts` · `server/src/modules/settings/settings-admin.module.ts`, `settings-admin.controller.ts`, `settings-admin.service.ts`, `dto/update-setting.dto.ts`
- Modify: `permissions.guard.ts` (audit การถูกปฏิเสธ), `auth.module.ts` (bind `AUTH_SETTINGS` → `SettingsService`), `auth.service.ts` (เขียน audit ของ login)
- Test: `audit-redact.test.ts`, `setting-spec.test.ts`, `server/src/common/audit/audit.int-test.ts`, `server/src/modules/settings/settings.int-test.ts`, `server/src/modules/audit-logs/audit-logs.int-test.ts`

**Interfaces:**
- Produces:
  - `@Audit(action: string, resourceType?: string)` · `AuditInterceptor` เป็น `APP_INTERCEPTOR` — เขียน `AuditLogs` (`Result` 1 สำเร็จ / 2 ล้มเหลว, `CorrelationId = getCorrelationId()`, `ActorUsername`, `ActorRole`, `HttpMethod`, `RequestPath`, `Ip`, `UserAgent`) · `ResourceId` = `result.id ?? params.id` · `Changes` = body ที่ redact แล้ว ตัดที่ 4000 ตัว · insert แบบไม่รอผล (error แค่ log ไม่ทำให้ request ล้ม)
  - `AuditWriterService.write(entry: { action: string; resourceType?: string; resourceId?: string; userId?: bigint | null; actorUsername?: string | null; result: 1 | 2; changes?: unknown }): void` — ใช้ใน `AuthService` สำหรับ `LOGIN`, `LOGIN_FAILED`, `LOGIN_SSO`, `LOGIN_SSO_DENIED`, `LOGOUT`, `CHANGE_PASSWORD` และใน `PermissionsGuard` สำหรับ `ACCESS_DENIED` (Result 2)
  - `redactBody(body: unknown): unknown` — key ที่ตรง `/pass(word)?|token|hash|secret|otp|pin/i` ⇒ `'[REDACTED]'` ทุกระดับ
  - `GET /api/audit-logs` (`audit:view`) query `{ page = 1, pageSize = 50 (≤ 100), search?, userId?, action?, resourceType?, result? (1|2), from?, to? }` → envelope ของ `{ id, occurredAt, userId, actorUsername, actorRole, action, resourceType, resourceId, result, httpMethod, requestPath, ip, correlationId }` เรียง `occurredAt` desc (ตรงกับ `AuditRow` ของ client) · `GET /api/audit-logs/actions` (`audit:view`) → `{ data: string[], total }`
  - `SETTING_DEFAULTS = { 'auth.max-failed-logins': 3, 'auth.lockout-minutes': 15 } as const` (DL65) · `type SettingKey` · `SETTING_BOUNDS = { 'auth.max-failed-logins': { min: 3, max: 20 }, 'auth.lockout-minutes': { min: 1, max: 1440 } }` · `checkSettingValue(key, valueType, raw): { ok: true; normalized: string } | { ok: false; message: string }`
  - `SettingsService.getInt(key)`, `getBool(key)`, `getString(key)`, `invalidate(key?)` — cache 30s, ไม่มีแถว ⇒ ใช้ `SETTING_DEFAULTS`
  - `GET /api/settings` (`settings:manage`) → `{ groups: [{ category, items: [{ key, value, valueType, description, min?, max? }] }], total }` · `PATCH /api/settings/:key { value }` (`settings:manage`, `@Audit('UPDATE_SETTING', 'Settings')`) → item · key ไม่รู้จัก ⇒ 404 · นอกช่วง ⇒ 400 `SETTING_OUT_OF_RANGE` (ข้อความไทยจาก `checkSettingValue`) (ตรงกับ `settings.api.ts` ของ client)

- [ ] **Step 1: เขียน test ที่ fail**

```ts
expect(redactBody({ username: 'a', password: 'p', nested: { refreshToken: 't' } }))
  .toEqual({ username: 'a', password: '[REDACTED]', nested: { refreshToken: '[REDACTED]' } });
expect(checkSettingValue('auth.max-failed-logins', 2, '0')).toMatchObject({ ok: false });
expect(checkSettingValue('auth.max-failed-logins', 2, '7')).toEqual({ ok: true, normalized: '7' });
// int: ADMIN PATCH /api/settings/auth.max-failed-logins {value:'7'} ⇒ 200 · AuditLogs มีแถว UPDATE_SETTING, Result 1, CorrelationId = header X-Correlation-Id
// int: COMPANY_ADMIN GET /api/settings ⇒ 403 และ AuditLogs มีแถว ACCESS_DENIED Result 2
// int: PATCH เป็น '3' แล้วรหัสผิด 3 ครั้ง ⇒ บัญชีถูกล็อก (AUTH_SETTINGS ใช้ SettingsService)
// int: GET /api/audit-logs โดย COMPANY_ADMIN ⇒ 403 · โดย ADMIN ⇒ envelope มีแถวข้างบน + LOGIN
```

- [ ] **Step 2: Run** — FAIL · **Step 3: Implement** (port reference `common/audit`, `common/settings`, `modules/audit-logs`, `modules/settings` · ตัด company scope) · **Step 4: Run** — PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): audit interceptor, audit log API, settings`

### Task 7: Users + roles API พร้อมกติกา `COMPANY_ADMIN` / ซ่อนบัญชี `ADMIN`

**Files:**
- Create: `server/src/common/http/paged.ts`, `server/src/common/http/page-query.dto.ts`, `server/src/common/pipes/parse-bigint.pipe.ts` · `server/src/modules/users/users.module.ts`, `users.controller.ts`, `users.service.ts`, `users.mapper.ts`, `user-access-rules.ts`, `admin-protection.ts`, `session-revocation.notifier.ts`, `roles.controller.ts`, `roles.service.ts`, `dto/create-user.dto.ts`, `dto/update-user.dto.ts`, `dto/query-users.dto.ts`, `dto/set-user-access.dto.ts`, `dto/set-role-permissions.dto.ts`
- Test: `user-access-rules.test.ts`, `admin-protection.test.ts`, `server/src/modules/users/users.int-test.ts`, `server/src/modules/users/company-admin.int-test.ts`, `server/src/modules/users/roles.int-test.ts`

**Interfaces:**
- Consumes: `TokensService.revokeAllForUser` (Task 4), `hashPassword` / `normalizeUsername` / `ROLE_CODES` / `RESERVED_ADMIN_PERMISSIONS` (Task 2), `@Audit` (Task 6), `getCurrentUser()`
- Produces:
  - `paged<T>(data: T[], total: number, page: number, pageSize: number)` · `PageQueryDto { page = 1; pageSize = 20 (1–100); q? }` · `ParseBigIntPipe` (`/^\d{1,19}$/` ไม่ตรง ⇒ 400)
  - `admin-protection.ts` (pure): `canSeeUser(actorRole: RoleCode, targetRole: RoleCode): boolean` · `assertAssignableRole(actorRole: RoleCode, roleCode: RoleCode): void` (ไม่ใช่ `ADMIN` แล้วกำหนด `ADMIN` ⇒ `AppException(403, 'ADMIN_ACCOUNT_PROTECTED', 'กำหนดบทบาทผู้ดูแลระบบได้เฉพาะผู้ดูแลระบบ')`) · `assertGrantablePermissions(roleCode: RoleCode, codes: PermissionCode[]): void` (role ไม่ใช่ `ADMIN` + มี code สงวน ⇒ `AppException(400, 'PERMISSION_RESERVED_FOR_ADMIN', 'สิทธิ์นี้สงวนไว้สำหรับผู้ดูแลระบบ', { permissions })`)
  - `type UserAction = 'edit' | 'suspend' | 'restore' | 'delete'` · `availableUserActions(actor: { id: bigint; roleCode: RoleCode; permissions: PermissionCode[] }, target: { id: bigint; status: number }): UserAction[]` — ไม่มี `users:manage` (และไม่ใช่ `ADMIN`) ⇒ `[]` · `edit` เสมอ · `suspend` เมื่อ status 1 และไม่ใช่ตัวเอง · `restore` เมื่อ status ≠ 1 · `delete` เมื่อไม่ใช่ตัวเอง
  - `userAccessBlockerOf(targetId, actorId, enabled)` + `planUserAccessChange(current, enabled)` (port ตรง)
  - `SessionRevocationNotifier.notify(userId: bigint, payload: { scope: 'account'; reason: string }): void` — token `SESSION_REVOCATION_NOTIFIER`, ใน task นี้ bind no-op (Task 10 เปลี่ยนเป็น gateway)
  - `UsersService.cutAllSessions(userId: bigint, reason: string): Promise<{ revokedSessions: number; revokedPushTokens: number }>` — transaction เดียว revoke `RefreshTokens` + `PushTokens` แล้ว **หลัง commit** เรียก notifier
  - `UserRow = { id, username, fullName, email, roleId, roleCode, roleName, status, lastLoginAt, azureLinked, availableActions }` (ตรงกับ client + `availableActions`)
  - `GET /api/users` (`users:read`) query `PageQueryDto & { roleCode?, status? }` → envelope · ผู้เรียกไม่ใช่ `ADMIN` ⇒ ไม่มีแถว role `ADMIN` (กรองใน SQL — `total` ไม่นับด้วย)
  - `GET /api/users/:id` (`users:read`) · `POST /api/users` (`users:manage`, `@Audit('CREATE_USER', 'Users')`) `{ username, fullName, roleCode, email?, password?, azureObjectId? }` (ไม่มี password ⇒ SSO-only) · `PATCH /api/users/:id` (`users:manage`, `@Audit('UPDATE_USER', 'Users')`) `{ fullName?, email?, roleCode?, password?, azureObjectId? }` (มี password ⇒ `cutAllSessions`) · `PATCH /api/users/:id/access { enabled }` (`users:manage`, `@Audit('SET_USER_ACCESS', 'Users')`) → `{ userId, username, enabled, changed, revokedSessions, revokedPushTokens }` · `DELETE /api/users/:id` (`users:manage`, `@Audit('DELETE_USER', 'Users')`) → soft delete + ล้าง `Employees.UserId` ที่ชี้บัญชีนี้ + `cutAllSessions`
  - กติกา: ผู้เรียกไม่ใช่ `ADMIN` + เป้าหมายเป็นบัญชี `ADMIN` ⇒ 404 `NOT_FOUND` ทุก route ของ `/users/:id` · `roleCode = 'ADMIN'` โดยผู้ที่ไม่ใช่ `ADMIN` ⇒ 403 · errors: `USERNAME_TAKEN` 409, `EMAIL_TAKEN` 409, `AZURE_ACCOUNT_TAKEN` 409, `UNKNOWN_ROLE` 400, `CANNOT_SUSPEND_SELF` 400, `CANNOT_DELETE_SELF` 400 · password 10–200 ตัว
  - `GET /api/roles` (`users:read`) → `{ data: [{ id, code, name, isSystem }], total, reservedPermissions: PermissionCode[] }` (ไม่ใช่ `ADMIN` ⇒ ไม่มี role `ADMIN`) · `GET /api/roles/:id/permissions` (`users:read`) → `{ data: PermissionCode[], total }` (role `ADMIN` โดยผู้ที่ไม่ใช่ `ADMIN` ⇒ 404) · `PUT /api/roles/:id/permissions { permissions }` (`roles:manage`, `@Audit('SET_ROLE_PERMISSIONS', 'Roles')`) — role `ADMIN` ⇒ 400 `ROLE_IMMUTABLE` · code ไม่อยู่ใน catalog ⇒ 400 `UNKNOWN_PERMISSION` · code สงวน ⇒ 400 `PERMISSION_RESERVED_FOR_ADMIN`

- [ ] **Step 1: Port unit test** `user-access-rules.test.ts` + เขียน `admin-protection.test.ts` (ครบทุกกิ่งของ 4 ฟังก์ชันข้างบน)
- [ ] **Step 2: เขียน int test ที่ fail** — อย่างน้อย:
  - `users.int-test.ts`: สร้าง `' Bob '` ⇒ เก็บ `bob` · username ซ้ำ ⇒ 409 · ระงับตัวเอง ⇒ 400 · ระงับคนอื่น ⇒ `RefreshTokens.RevokedAt` ถูกตั้งและ refresh ครั้งต่อไป 401 · ลบผู้ใช้ที่ผูกพนักงาน ⇒ `Employees.UserId` เป็น null · envelope `{ data, page, pageSize, total }` id เป็น string · แถวของตัวเองไม่มี `suspend` / `delete` ใน `availableActions` · `VIEWER` ⇒ `GET /users` 403
  - `company-admin.int-test.ts` (Review Focus 3): `COMPANY_ADMIN` `GET /users` ไม่มีบัญชี `admin` และ `total` ไม่นับ · `GET/PATCH/DELETE /users/{adminId}` และ `/access` ⇒ 404 และแถวไม่เปลี่ยน · `POST /users { roleCode: 'ADMIN' }` ⇒ 403 `ADMIN_ACCOUNT_PROTECTED` · `PATCH /users/{selfId} { roleCode: 'ADMIN' }` ⇒ 403 · `GET /roles` ไม่มี `ADMIN` และมี `reservedPermissions` 3 ตัว · `PUT /roles/{operatorId}/permissions` ⇒ 403 (ไม่มี `roles:manage`) · สร้าง / ระงับ `OPERATOR` ได้
  - `roles.int-test.ts`: `ADMIN` `PUT` ให้ `OPERATOR` มี `audit:view` ⇒ 400 `PERMISSION_RESERVED_FOR_ADMIN` และแถวเดิมไม่เปลี่ยน · `PUT` role `ADMIN` ⇒ 400 `ROLE_IMMUTABLE` · `'x:y'` ⇒ 400 `UNKNOWN_PERMISSION` · `PUT` ถูกต้อง ⇒ `GET` คืนชุดใหม่
- [ ] **Step 3: Run** — FAIL · **Step 4: Implement** (port reference `modules/users` ตัด company / department / devices · map แถว DB → camelCase ใน `users.mapper.ts`) · **Step 5: Run** — PASS + route-guard-coverage ยังผ่าน
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): users and roles admin APIs with COMPANY_ADMIN rules`

### Task 8: Employees API

**Files:**
- Create: `server/src/modules/employees/employees.module.ts`, `employees.controller.ts`, `employees.service.ts`, `employees.mapper.ts`, `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`, `dto/query-employees.dto.ts`
- Test: `server/src/modules/employees/employees.int-test.ts`

**Interfaces:**
- Consumes: `paged`, `PageQueryDto`, `ParseBigIntPipe`, `canSeeUser` (Task 7)
- Produces:
  - `EmployeeRow = { id, employeeCode, firstName, lastName, phone, userId, bookingEmployeeRef, status }` (ตรงกับ client) · status 1 ทำงาน, 2 พักงาน, 3 ลาออก
  - `GET /api/employees` (`org:read`) query `PageQueryDto & { status? }` (`q` ค้น code / ชื่อ / นามสกุล / bookingEmployeeRef) · `POST` / `PATCH /:id` / `DELETE /:id` (`org:manage`, `@Audit('CREATE_EMPLOYEE' | 'UPDATE_EMPLOYEE' | 'DELETE_EMPLOYEE', 'Employees')`) · `PATCH` รับ `status` (1 | 2 | 3) ด้วย (ฟอร์มของ client ส่งมา — R9) · DELETE = soft delete
  - errors: `EMPLOYEE_CODE_TAKEN` 409 · `BOOKING_REF_TAKEN` 409 · `USER_ALREADY_LINKED` 409 · `userId` ไม่มีอยู่ หรือเป็นบัญชี `ADMIN` ขณะผู้เรียกไม่ใช่ `ADMIN` ⇒ 404 `NOT_FOUND`

- [ ] **Step 1: เขียน int test ที่ fail** — CRUD ครบ · code ซ้ำ ⇒ 409 · `bookingEmployeeRef` ซ้ำ ⇒ 409 · ผู้ใช้เดียวผูก 2 พนักงาน ⇒ 409 · `COMPANY_ADMIN` ผูก `userId` ของบัญชี `admin` ⇒ 404 · `VIEWER` อ่านได้ / เขียน ⇒ 403 · ลบแล้วสร้าง code เดิมได้ (partial unique)
- [ ] **Step 2: Run** — FAIL · **Step 3: Implement** (port reference `modules/employees` ตัด department) · **Step 4: Run** — PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): employees API`

### Task 9: ผู้ใช้จาก Entra — directory + sync ผ่าน Microsoft Graph

**Files:**
- Create: `server/src/modules/users/graph-users.client.ts`, `entra-user-sync.plan.ts`, `entra-user-sync.service.ts`, `dto/sync-entra-users.dto.ts`
- Modify: `users.controller.ts`, `users.module.ts`, `server/.env.example` (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_ALLOWED_DOMAINS`)
- Test: `entra-user-sync.plan.test.ts`, `graph-users.filter.test.ts`, `server/src/modules/users/entra-user-sync.int-test.ts`

**Interfaces:**
- Produces (port reference `modules/users/entra-user-sync.*`, `graph-users.client.ts` · ตัด `Phone` เพราะ `Users` ไม่มีคอลัมน์นี้ · `MAX` = `Email` 200, `FullName` 200):
  - `planEntraUserSync(entra: EntraUser[], local: LocalUserRow[], options?: { matchByUsername?: boolean }): EntraSyncPlan` — จับคู่ `AzureObjectId` → email = UPN → (ถ้า `matchByUsername`) username = ส่วนหน้า `@` · เติมเฉพาะช่องที่ว่าง
  - `EntraSyncResult` (camelCase · ตรงกับ type ของ reference client): `{ dryRun, entraTotal, entraFetched, entraDroppedByDomain, filteredAtGraph, allowedDomains, domainFilteredAtGraph, domainField, applied, unchanged, updates, missingInSystem, notInEntra, conflicts, entraUsers, entraFields }` · `updates[].userId` เป็น string
  - `GET /api/users/entra-directory` (`users:manage`, `@Audit('LIST_ENTRA_USERS', 'Users')`) = sync แบบ `dryRun` · `POST /api/users/sync-entra { dryRun = true, matchByUsername? }` (`users:manage`, `@Audit('SYNC_ENTRA_USERS', 'Users')`) — ไม่สร้างบัญชีเอง
  - ผู้เรียกไม่ใช่ `ADMIN`: ตัดบัญชี role `ADMIN` ออกจาก `local` **และ** ตัด Entra user ที่ตรงบัญชี `ADMIN` (oid / UPN = email / username) ออกจาก `entra` **ก่อน** เรียก planner ⇒ ผลไม่มีร่องรอยบัญชี `ADMIN` และ apply ไม่แตะบัญชี `ADMIN`
  - env ไม่ครบ ⇒ 400 `GRAPH_NOT_CONFIGURED` ข้อความไทยระบุชื่อ env ที่ขาด

- [ ] **Step 1: Port unit test** ของ reference `entra-user-sync.plan.test.ts`, `graph-users.filter.test.ts` (ตัดกรณี Phone)
- [ ] **Step 2: เขียน int test ที่ fail** — stub `globalThis.fetch` (token endpoint `login.microsoftonline.com` + `graph.microsoft.com/v1.0/users`) · `dryRun` ไม่แก้แถวใด · `dryRun: false` ผูก `AzureObjectId` + เติม email ที่ว่างเท่านั้น · `COMPANY_ADMIN` เรียกเมื่อ Entra มี UPN ตรง email ของบัญชี `admin` ⇒ ไม่มี UPN นั้นใน `updates` / `missingInSystem` / `entraUsers` และบัญชี `admin` ไม่ถูกแก้ · ไม่ตั้ง `GRAPH_*` ⇒ 400 `GRAPH_NOT_CONFIGURED`
- [ ] **Step 3: Run** — FAIL · **Step 4: Implement** (port) · **Step 5: Run** — PASS
- [ ] **Step 6: ทดสอบมือ** เมื่อผู้ใช้ตั้ง `GRAPH_*` บนเครื่อง dev (app registration แยกจาก SSO · application permission `User.Read.All` + admin consent) — ถ้ายังไม่มี บันทึกว่าค้างไว้
- [ ] **Step 7: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): Entra directory and sync via Microsoft Graph`

### Task 10: Realtime gateway skeleton + ตัด session ทันที

**Files:**
- Create: `server/src/common/realtime-bus/realtime-bus.types.ts`, `redis-io.adapter.ts`, `realtime-emitter.service.ts` · `server/src/modules/realtime/realtime.module.ts`, `realtime.gateway.ts`, `realtime-rooms.ts`
- Modify: `server/src/main.api.ts` (ใช้ `RedisIoAdapter`), `server/src/modules/users/users.module.ts` (bind notifier → gateway), `server/src/worker.module.ts` (`RealtimeEmitterService`)
- Test: `realtime-rooms.test.ts`, `server/src/modules/realtime/realtime.int-test.ts`

**Interfaces:**
- Produces:
  - `REALTIME_NAMESPACE = '/realtime'`, `REALTIME_REDIS_KEY = 'socket.io'`, `REALTIME_UNAUTHORIZED = 'unauthorized'` (ตรงกับ `client/src/lib/socket.ts`)
  - `roomsForClient(identity: { sub: string }): string[]` → `['org', 'user:{sub}']` (P1 เพิ่ม `tracking`, P2 เพิ่ม `alerts`, P5 เพิ่ม `team:{id}`)
  - `RealtimeGateway.revokeUserSessions(userId: bigint, payload: { scope: 'account'; reason: string }): void` — emit `session:revoked` `{ scope, reason }` เข้า `user:{id}` แล้ว `disconnectSockets(true)`
  - `RedisIoAdapter(app).connect(): Promise<boolean>` — Redis ไม่พร้อม ⇒ ใช้ adapter ในหน่วยความจำ + log warn
  - `RealtimeEmitterService.bus` (worker emit ผ่าน `@socket.io/redis-emitter`, namespace / key ต้องตรงกับ api)
  - Auth ที่ handshake: `socket.handshake.auth.token` = access token · ผิด / หมดอายุ ⇒ `connect_error` message `unauthorized`

- [ ] **Step 1: เขียน test ที่ fail** — unit: `roomsForClient({ sub: '7' })` = `['org', 'user:7']` · int (socket.io-client กับ `bootHttpContext` บน port สุ่ม): ไม่มี token ⇒ `connect_error` `unauthorized` · token ถูก ⇒ เชื่อมได้ · `ADMIN` `PATCH /api/users/:id/access { enabled: false }` ⇒ socket ของเป้าหมายได้ `session:revoked` `scope: 'account'` แล้ว `disconnect` (Review Focus 4)
- [ ] **Step 2: Run** — FAIL · **Step 3: Implement** (port reference gateway / adapter / emitter · ตัด room tracking / alerts / dept / company) · **Step 4: Run** — PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(server): realtime gateway with auth and session revocation`

### Task 11: Swagger, health, helmet, คู่มือรันบนเครื่อง dev

**Files:**
- Modify: `server/src/bootstrap/configure-app.ts` (Swagger + helmet), `server/src/app.controller.ts` (health), `server/.env.example` (ครบทุก env ของ P0 พร้อมคำอธิบายไทย), `server/package.json` (`helmet`)
- Create: `docs/runbooks/local-dev.md` (ไทย)
- Test: `server/src/app.health.int-test.ts`

**Interfaces:**
- Produces: `GET /api/health` (`@Public`) `{ status: 'ok' }` · `GET /api/health/db` (`@Public`) → 200 `{ status: 'ok' }` หรือ 503 `SERVICE_UNAVAILABLE` · `GET /api/health/redis` (`@Public`) → แบบเดียวกัน · Swagger UI `/api/docs`, JSON `/api/docs-json` (`addBearerAuth()`, **ห้าม** `addServer('/api')`) · `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })`
- คู่มือ `docs/runbooks/local-dev.md`: สร้าง DB `bwc` / `bwc_test` บน PostgreSQL ของเครื่อง (ห้ามใช้ DB ของระบบเดิม) · ตั้ง `server/.env` (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `AZURE_AD_*`, `GRAPH_*`) · `npm run db:migrate && npm run db:seed` · รัน `npm run start:api:dev`, `npm run start:worker:dev` และ `client/` `npm run dev` · Entra บน local ต้องมี redirect URI `http://localhost:5173` · DSS middleware ใช้ผ่าน VPN (เริ่มใช้ใน P1) · คำสั่ง `npm run ci`

- [ ] **Step 1: เขียน int test ที่ fail** — `/api/health/db` 200 บน test DB · app อีกตัวที่ `DATABASE_URL` ชี้ host ที่ต่อไม่ได้ ⇒ `/api/health/db` 503 `{ code: 'SERVICE_UNAVAILABLE' }` · `REDIS_URL` ชี้ port ว่าง ⇒ `/api/health/redis` 503 และ `POST /api/auth/login` ยัง 200 (Review Focus 5) · `/api/docs-json` มี path `/api/auth/login` · response มี header `x-content-type-options: nosniff`
- [ ] **Step 2: Run** — FAIL · **Step 3: Implement** · **Step 4: Run** — PASS
- [ ] **Step 5: ทำตามคู่มือบนเครื่อง dev จริงตั้งแต่ DB ว่าง** — Expected: login `admin` ผ่าน `http://localhost:5173` ได้ · แก้คู่มือตามที่เจอจริง
- [ ] **Step 6: Run** `npm run ci` — Expected: lint + typecheck + unit + integration ผ่านทั้งหมด · job `server` ใน `.github/workflows/ci.yml` ยังตรงกับคำสั่งที่ใช้ (เพิ่ม env ที่ test ต้องใช้ถ้ามี)
- [ ] **Step 7: Commit** (เสนอ message — ผู้ใช้ commit เอง) `chore(server): swagger, health checks, helmet, local dev runbook`

### Task 12: เตรียม deploy Azure (ทำเมื่อผู้ใช้สั่งเท่านั้น — DL63)

> ข้ามได้ระหว่าง dev บน local · ต้องทำก่อน deploy ทับระบบเดิม (DL60)

**Files:**
- Create: `server/Dockerfile` (port จาก `C:\Git\psd-bwc-web-backend\Dockerfile`: stage `deps` → `builder` → `prod-deps` → `runner` + ffmpeg, `npm ci --legacy-peer-deps`, copy `drizzle/`, `USER node`, `CMD ["node", "dist/main.api.js"]` · worker / migrate ใช้ command override `node dist/main.worker.js` / `node dist/db/migrate.entry.js`), `server/.dockerignore`, `server/scripts/ci-coverage.js` (port จาก `psd-bwc-web-backend/scripts/ci-coverage.js`)

- [ ] **Step 1:** `npm ci --legacy-peer-deps` ใน clean checkout **ภายใน container `node:22-slim`** (npm 10 — pipeline Azure ใช้คำสั่งนี้) — Expected: สำเร็จ · ไม่ผ่านเพราะ lockfile เขียนด้วย npm 11 ⇒ `npm install --package-lock-only` ใน container เดียวกันแล้วรันซ้ำ
- [ ] **Step 2:** `npm run coverage` และ `npm run test:ci:full` — Expected: ผ่าน และสร้าง `coverage/` + `test-results/`
- [ ] **Step 3:** `docker build --target runner server` — Expected: สำเร็จ · `docker run` ด้วย env ของ DB / Redis บนเครื่อง ⇒ `/api/health` 200
- [ ] **Step 4: Commit** (เสนอ message — ผู้ใช้ commit เอง) `chore(server): Dockerfile and CI coverage scripts for the Azure pipeline`

---

## Done when

- `npm run ci` ใน `server/` ผ่านกับ PostgreSQL + Redis บนเครื่อง dev
- Acceptance P0 ฝั่ง server (Part 8): login password ทำงานบนเครื่อง dev (Entra ทำงานเมื่อมี redirect URI localhost) · refresh rotation / reuse / race มี integration test · handler ไม่มี decorator สิทธิ์ ⇒ test fail · migrate รันซ้ำได้ผลเดิม · drift guard หยุด process เมื่อ migration ค้าง · กติกา `COMPANY_ADMIN` / ซ่อน `ADMIN` ผ่าน integration test · `entra-directory` / `sync-entra` แบบ `dryRun` ไม่แก้ข้อมูล และไม่ตั้ง `GRAPH_*` ⇒ 400
- client P0 (`2026-11-20-p0-client-completion.md`) ต่อ API จริงได้ครบทุกหน้า
