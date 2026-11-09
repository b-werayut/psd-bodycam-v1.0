# P0 Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `server/` NestJS foundation — two process entry points, DB + migrations, auth (password + Entra SSO), RBAC + department data scope, audit, settings, org/user admin APIs, realtime gateway skeleton, Docker and CI — so P1+ modules plug into a working, tested base.

**Architecture:** Modular monolith (NestJS 10) with `main.api.ts` (HTTP + Socket.IO) and `main.worker.ts` (no HTTP, roles from `WORKER_ROLES`). Global infra lives in `server/src/common/*`, ported from the reference `C:\Git\Internal-BodyCam\server\src\common\*` with company scope removed. Drizzle ORM on PostgreSQL 16; invariants in DB; reference data shipped only by idempotent data migrations.

**Tech Stack:** Node 22, TypeScript ^5.7.3, NestJS ^10.4.15, drizzle-orm ^0.45.2 + drizzle-kit ^0.31.10 + postgres ^3.4.9, redis ^4.7.1, socket.io ^4.8.1 + @socket.io/redis-adapter ^8.3.0 + @socket.io/redis-emitter ^5.1.0, jose ^5.10.0, @node-rs/argon2 ^2.0.2, class-validator ^0.14.1, @nestjs/swagger ^8.1.1, nestjs-pino ^4.1.0 + pino-http ^10.3.0 + pino ^9.5.0, vitest ^2.1.9 + unplugin-swc ^1.5.9 + supertest ^7.2.2, eslint ^9.14.0 + typescript-eslint ^8.13.0.

**Spec:** `docs/blueprint/README.md`, `docs/blueprint/02-system-architecture.md` (§2.3, §2.4, §2.8, §2.9), `docs/blueprint/04-database-design.md` (§4.1, §4.4 A, §4.7, §4.8, §4.9), `docs/blueprint/05-api-design.md` (§5.1, §5.2 Auth/Users/Org, §5.5, §5.7), `docs/blueprint/08-implementation-roadmap.md` (P0). Decision log: `docs/blueprint/09-risks-open-questions.md` §9.5.

## Global Constraints

- Reference project `C:\Git\Internal-BodyCam` is **read-only** — copy code out, never write there.
- All code under `server/`; run commands from `server/` unless stated.
- DB naming: tables/columns PascalCase quoted; PK `bigint GENERATED ALWAYS AS IDENTITY` (drizzle `mode: 'bigint'`); timestamps `timestamptz`; enums `smallint` append-only; JSON `jsonb`; soft delete (`IsDeleted`/`DeletedAt`/`DeletedBy`) only on master data with partial uniques `WHERE "IsDeleted" = false`.
- API: prefix `/api`; **all JSON camelCase** (request and response); ids serialized as strings; list envelope `{ data, page, pageSize, total }` (pageSize max 100); lookups `{ data, total }`.
- Error body: `{ statusCode, code, message, details?, correlationId }`; `message` Thai; out of data scope = **404**; state conflict = 409; `If-Match` mismatch = 412.
- Roles exactly `ADMIN`, `OPERATOR`, `VIEWER`. Scope kinds exactly `all` (ADMIN) and `department` (subtree). `ADMIN` bypasses permission and scope checks but is still audited.
- Every non-public endpoint has `@RequirePermission(...)` and every write has `@Audit(action, resourceType)`; secure by default (`@Public()` to open).
- Permissions, roles, role-permissions, settings defaults ship **only via custom data migrations** (`ON CONFLICT DO NOTHING`). `db:seed` is dev-only and refuses `NODE_ENV=production`.
- Adding a setting = `SETTING_DEFAULTS` + `SETTING_BOUNDS` + data migration.
- Emit realtime events only after the DB transaction commits.
- Tests: unit `src/**/*.test.ts` (vitest default config), integration `src/**/*.int-test.ts` (needs Postgres DB name ending `_test` + Redis).
- The user has been committing manually — **ask before each commit**, or batch commits at the end of a task if told to.

## Review Focus

1. **Two browser tabs refresh at the same moment with the same cookie** → second request must not trigger "reuse ⇒ revoke all"; user stays signed in. (Task 8: grace window test.)
2. **Username typed with different case or surrounding spaces** (`" Admin "`) → logs into the same account. (Task 8: normalization test.)
3. **Malformed JSON or oversized body** → 400/413 in the standard error envelope, never Express HTML. (Task 3: tests.)
4. **Deleting a department that still has child departments or employees** → 409 `DEPARTMENT_IN_USE`, nothing deleted. (Task 12: test.)
5. **Suspending a user who has an open socket** → that socket receives `session:revoked` and is disconnected; refresh tokens revoked. (Task 13: test.)

---

### Task 1: Server scaffold, health endpoint, lint

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/nest-cli.json`, `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `server/eslint.config.mjs`, `server/.gitignore`, `server/.env.example`
- Create: `server/src/common/bigint-json.ts`, `server/src/main.api.ts`, `server/src/app.module.ts`, `server/src/app.controller.ts`
- Test: `server/src/app.controller.test.ts`

**Interfaces:**
- Produces: `installBigIntJson(): void` (idempotent `BigInt.prototype.toJSON = () => this.toString()`), imported first by both entry points and by `src/test/int-setup.ts` (Task 4). `AppController` routes `GET /api/health` → `{ status: 'ok' }`.

- [ ] **Step 1: Create config files.** Copy `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `vitest.integration.config.ts` from the reference server verbatim except: `tsconfig.json` `include: ["src/**/*", "scripts/**/*"]` (drop `prisma`); `vitest.integration.config.ts` keeps `fileParallelism: false`, `testTimeout: 30_000`, `hookTimeout: 60_000`, `setupFiles: ['src/test/int-setup.ts']`. `package.json` scripts = reference scripts minus `mock:*`, `dev:fleet`, `push:check`, `erd:build`, `sync:entra-users`, `db:baseline`, plus `"lint": "eslint src scripts"` and `"ci": "npm run lint && npm run typecheck && npm test && npm run test:int"`. Dependencies = Tech Stack line only (no bullmq, mqtt, minio, exceljs, ws, ioredis, morgan in P0). `engines.node: ">=22"`.
- [ ] **Step 2: Write the failing test**

```ts
// src/app.controller.test.ts
it('GET /api/health returns ok', async () => {
  const app = await NestFactory.create(AppModuleForTest, { logger: false }); // module with only AppController
  app.setGlobalPrefix('api'); await app.init();
  const res = await request(app.getHttpServer()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
  await app.close();
});
it('serializes bigint as string', () => {
  installBigIntJson();
  expect(JSON.stringify({ id: 12n })).toBe('{"id":"12"}');
});
```

- [ ] **Step 3: Run** `npx vitest run src/app.controller.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `installBigIntJson` in `src/common/bigint-json.ts`, `AppController` with `@Get('health')`, and `main.api.ts` bootstrap order: `dotenv/config` → `reflect-metadata` → `installBigIntJson()` → `NestFactory.create(AppModule, { rawBody: true, bufferLogs: true })` → global prefix `api` → `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` → `enableShutdownHooks()` → `listen(PORT ?? 3000)`. Later tasks insert steps into this sequence.
- [ ] **Step 5: Add ESLint flat config** (`typescript-eslint` recommended + `no-restricted-imports` rule placeholder array — Task 2 fills it). Run `npm run lint` — Expected: 0 errors.
- [ ] **Step 6: Run** `npx vitest run src/app.controller.test.ts && npm run typecheck` — Expected: PASS.
- [ ] **Step 7: Commit** `chore(server): scaffold NestJS app with health endpoint`

### Task 2: Config, CORS, trust proxy, prod check, worker roles

**Files:**
- Create: `server/src/common/config/cors.ts`, `trust-proxy.ts`, `redact-url.ts`, `prod-readiness.ts`, `worker-roles.ts`; `server/scripts/prod-check.ts`; `server/src/main.worker.ts`, `server/src/worker.module.ts`
- Test: `server/src/common/config/prod-readiness.test.ts`, `worker-roles.test.ts`, `cors.test.ts`, `trust-proxy.test.ts`

**Interfaces:**
- Produces:
  - `corsOrigins(): string[] | true`, `resolveTrustProxy(env): { value: number | string | string[] | false; error?: string }`, `redactUrl(url: string): string` — ported verbatim from reference `src/common/config/`.
  - `checkProdEnv(env: NodeJS.ProcessEnv): ReadinessCheck[]`, `summarizeReadiness(checks)`; `ReadinessCheck = { id: string; level: 'pass' | 'warn' | 'fail'; message: string }`.
  - `type WorkerRole = 'tracking' | 'integration' | 'media'`; `parseWorkerRoles(raw: string | undefined): WorkerRole[]`.
  - `WorkerModule.forRoles(roles: WorkerRole[]): DynamicModule` — imports `AppModule`; in P0 registers no role modules (later phases add `TrackingWorkerModule` etc. keyed by role).

- [ ] **Step 1: Write the failing tests**

```ts
// worker-roles.test.ts
expect(parseWorkerRoles(undefined)).toEqual(['tracking', 'integration', 'media']);
expect(parseWorkerRoles('')).toEqual(['tracking', 'integration', 'media']);
expect(parseWorkerRoles(' media, tracking ')).toEqual(['tracking', 'media']); // canonical order, trimmed
expect(() => parseWorkerRoles('tracking,video')).toThrow(/video/);
// prod-readiness.test.ts
const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db/app', JWT_ACCESS_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'https://bwc.example', COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'lax', TRUST_PROXY: '1',
  REDIS_URL: 'redis://r:6379', AZURE_AD_TENANT_ID: '00000000-0000-0000-0000-000000000001', AZURE_AD_CLIENT_ID: '00000000-0000-0000-0000-000000000002' };
expect(summarizeReadiness(checkProdEnv(base)).fail).toBe(0);
expect(checkProdEnv({ ...base, JWT_ACCESS_SECRET: 'short' }).find(c => c.id === 'JWT_ACCESS_SECRET')?.level).toBe('fail');
expect(checkProdEnv({ ...base, CORS_ORIGINS: '*' }).find(c => c.id === 'CORS_ORIGINS')?.level).toBe('fail');
expect(checkProdEnv(base).map(c => c.id)).not.toContain('ROAD_MATCH_DRIVER');
```

- [ ] **Step 2: Run** `npx vitest run src/common/config` — Expected: FAIL.
- [ ] **Step 3: Implement.** Port `cors.ts`, `trust-proxy.ts`, `redact-url.ts` and their reference tests verbatim. Port `prod-readiness.ts` keeping only check ids NODE_ENV, DATABASE_URL, JWT_ACCESS_SECRET, CORS_ORIGINS, COOKIE_SECURE, COOKIE_SAMESITE, TRUST_PROXY, REFRESH_TOKEN_TTL_HOURS, REFRESH_TOKEN_TTL_HOURS_DEVICE, REDIS_URL, AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, SEED_DEMO_PASSWORD (must be unset in prod). `scripts/prod-check.ts` prints the checks and exits 1 when `fail > 0`. `main.worker.ts`: `dotenv/config` → `reflect-metadata` → `installBigIntJson()` → `createApplicationContext(WorkerModule.forRoles(parseWorkerRoles(process.env.WORKER_ROLES)))` → `enableShutdownHooks()`. Wire `enableCors({ origin: corsOrigins(), credentials: true, exposedHeaders: ['Content-Disposition', 'X-Correlation-Id'] })` and trust proxy into `main.api.ts`. Fill ESLint `no-restricted-imports`: forbid importing `src/worker.module` and any `**/*.worker.module` from `src/app.module.ts` (Part 2 §2.4 rule 5).
- [ ] **Step 4: Run** `npx vitest run src/common/config && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): config helpers, prod check, worker roles`

### Task 3: Request context, correlation id, logging, error envelope

**Files:**
- Create: `server/src/common/context/request-context.ts`, `request-context.middleware.ts`; `server/src/common/errors/app-exception.ts`, `error-codes.ts`, `global-exception.filter.ts`; `server/src/common/logging/logger.module.ts`
- Modify: `server/src/app.module.ts`, `server/src/main.api.ts`
- Test: `server/src/common/errors/global-exception.filter.test.ts`, `server/src/common/context/request-context.middleware.test.ts`

**Interfaces:**
- Produces:
  - `RequestContext = { correlationId: string; userId?: bigint; user?: AuthUserLike; ip?: string; userAgent?: string }`; `requestContext: AsyncLocalStorage<RequestContext>`; `getContext(): RequestContext | undefined`; `getUserId(): bigint | undefined`; `getCurrentUser(): AuthUserLike | undefined`; `getCorrelationId(): string | undefined`. (`AuthUserLike` defined in Task 8; declare it here as `{ id: bigint; username: string; roleId: bigint; roleCode: string; departmentId: bigint | null }` in `src/common/auth/auth-user.ts` and let Task 8 extend that file.)
  - `RequestContextMiddleware` — reads `X-Correlation-Id` (accept `[A-Za-z0-9-]{8,64}`, else generate `randomUUID()`), sets response header `X-Correlation-Id`.
  - `class AppException extends HttpException` — `constructor(status: number, code: string, message: string, details?: Record<string, unknown>)`.
  - `ERROR_CODE_BY_STATUS: Record<number, string>` = `{400:'BAD_REQUEST', 401:'UNAUTHORIZED', 403:'FORBIDDEN', 404:'NOT_FOUND', 409:'CONFLICT', 412:'PRECONDITION_FAILED', 413:'PAYLOAD_TOO_LARGE', 429:'TOO_MANY_REQUESTS', 503:'SERVICE_UNAVAILABLE'}`.
  - `GlobalExceptionFilter` registered as `APP_FILTER`.

- [ ] **Step 1: Write the failing tests** (test controller throwing each kind; supertest)

```ts
// AppException → body passthrough
expect(res.body).toEqual({ statusCode: 409, code: 'DEPARTMENT_IN_USE', message: 'มีข้อมูลอ้างอิงอยู่', details: { children: 1 }, correlationId: expect.any(String) });
// class-validator failure (POST with { unknown: 1 })
expect(res.status).toBe(400); expect(res.body.code).toBe('VALIDATION_FAILED'); expect(res.body.details.messages).toBeInstanceOf(Array);
// malformed JSON body
expect(res.status).toBe(400); expect(res.body.code).toBe('BAD_REQUEST'); expect(res.headers['content-type']).toMatch(/json/);
// body over 1 MB
expect(res.status).toBe(413); expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
// unknown Error('boom')
expect(res.status).toBe(500); expect(res.body).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ', correlationId: expect.any(String) });
expect(JSON.stringify(res.body)).not.toContain('boom');
// correlation id echo
const r = await http.get('/api/health').set('X-Correlation-Id', 'abc12345-test');
expect(r.headers['x-correlation-id']).toBe('abc12345-test');
expect((await http.get('/api/health').set('X-Correlation-Id', 'bad id!')).headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
```

- [ ] **Step 2: Run** `npx vitest run src/common/errors src/common/context` — Expected: FAIL.
- [ ] **Step 3: Implement.** Port reference `request-context.ts` + middleware and add `correlationId`. Filter maps: `AppException` → its fields; `BadRequestException` from `ValidationPipe` → `VALIDATION_FAILED` with `details.messages`; body-parser `entity.parse.failed` → 400 `BAD_REQUEST`; `entity.too.large` → 413; other `HttpException` → `ERROR_CODE_BY_STATUS[status]` with its message; anything else → 500 and log stack with correlationId. Body limit `express.json({ limit: '1mb' })` in `main.api.ts`. `LoggerModule.forRoot` from nestjs-pino: JSON in production, pretty only when `NODE_ENV !== 'production'`; `genReqId` = correlation id; redact `req.headers.authorization`, `req.headers.cookie`. Apply middleware `forRoutes('*')`.
- [ ] **Step 4: Run** tests + `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): request context, correlation id, pino logging, error envelope`

### Task 4: DB module, P0 schema, migrations, test harness

**Files:**
- Create: `server/src/db/db.constants.ts`, `db.types.ts`, `db.module.ts`, `columns.ts`, `schema.ts`, `schema.partitioned.ts`, `migrate.entry.ts`; `server/drizzle.config.ts`; `server/drizzle/0000_baseline.sql` (generated), `server/drizzle/0001_extensions_partitions.sql` (custom)
- Create: `server/src/test/test-db-url.ts`, `int-setup.ts`, `int-helpers.ts`; `server/scripts/prepare-test-db.ts`; repo root `docker-compose.dev.yml`
- Test: `server/src/db/schema.int-test.ts`

**Interfaces:**
- Produces:
  - `DRIZZLE = Symbol('DRIZZLE')`; `DrizzleDB = PostgresJsDatabase<typeof schema>`; `DrizzleTx`; `DrizzleExecutor = DrizzleDB | DrizzleTx`. Inject with `@Inject(DRIZZLE) private readonly db: DrizzleDB`.
  - `columns.ts` exports (port of reference helpers): `pkId()`, `fk(name)`, `ref(name, target)`, `tstz(name)`, `createdAt()`, `updatedAt()`, `auditActor()` (`CreatedBy`, `UpdatedBy` → Users), `softDelete()`, `notDeleted(t)`.
  - Tables (exact columns from Part 4 §4.4 A): `Departments`, `Employees`, `Users`, `Roles`, `Permissions`, `RolePermissions`, `RefreshTokens`, `UserDevices`, `PushTokens`, `Settings`; `AuditLogs` in `schema.partitioned.ts` (columns per Part 4 §4.4 H incl. `CorrelationId varchar(64)`, PK `(OccurredAt, Id)`).
  - `Users.Username` stored lowercase; unique `UQ_Users_Username` on `lower("Username") WHERE "IsDeleted" = false`.
  - Test helpers: `resolveTestDbTarget(env)` (port; DB name must end `_test`); `bootHttpContext(): Promise<{ app: INestApplication; sql: TestSql; http: supertest.Agent; close(): Promise<void> }>`; `asUser<T>(user: AuthUserLike, fn: () => Promise<T>): Promise<T>`; `eventually(probe, timeoutMs = 3000, intervalMs = 50)`.

- [ ] **Step 1: Add `docker-compose.dev.yml`** at repo root: `postgres:16-alpine` (port 5432, db `bwc`, user/pass `bwc`) and `redis:7-alpine` (port 6379, `--appendonly yes`). `.env.example`: `DATABASE_URL=postgres://bwc:bwc@localhost:5432/bwc`, `DATABASE_URL_TEST=postgres://bwc:bwc@localhost:5432/bwc_test`, `REDIS_URL=redis://localhost:6379`.
- [ ] **Step 2: Write the failing integration test**

```ts
// src/db/schema.int-test.ts  (runs after prepare-test-db migrated the _test DB)
it('has btree_gist', async () => {
  expect(await ctx.sql`select 1 from pg_extension where extname = 'btree_gist'`).toHaveLength(1);
});
it('AuditLogs is partitioned with current, +1, +2 month and default partitions', async () => {
  const parts = await ctx.sql`select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
                               join pg_class p on p.oid = i.inhparent where p.relname = 'AuditLogs'`;
  expect(parts.map(p => p.relname)).toEqual(expect.arrayContaining(['AuditLogs_default', `AuditLogs_${yyyymm(0)}`, `AuditLogs_${yyyymm(1)}`, `AuditLogs_${yyyymm(2)}`]));
});
it('username is unique case-insensitively among live rows only', async () => {
  await insertUser('alice'); await expect(insertUser('ALICE')).rejects.toThrow(/UQ_Users_Username/);
  await softDeleteUser('alice'); await expect(insertUser('alice')).resolves.toBeDefined();
});
it('employee can link to at most one user', async () => { /* two employees same UserId → rejects UQ_Employees_User */ });
```

- [ ] **Step 3: Run** `npm run db:prepare:test && npx vitest run --config vitest.integration.config.ts src/db/schema.int-test.ts` — Expected: FAIL (no schema).
- [ ] **Step 4: Implement schema + migrations.** `drizzle.config.ts` `schema: './src/db/schema.ts'` only (partitioned file excluded on purpose). `npm run db:generate -- --name=baseline`. Then `npm run db:generate -- --custom --name=extensions_partitions` and write: `CREATE EXTENSION IF NOT EXISTS btree_gist;` → `CREATE TABLE "AuditLogs" (...) PARTITION BY RANGE ("OccurredAt")` → `CREATE TABLE IF NOT EXISTS "AuditLogs_default" PARTITION OF "AuditLogs" DEFAULT` → a `DO $$ ... $$` block creating `AuditLogs_YYYYMM` for `date_trunc('month', now())` and the next 2 months with `CREATE TABLE IF NOT EXISTS ... PARTITION OF ... FOR VALUES FROM (...) TO (...)` → indexes `IX_AuditLogs_Occurred (OccurredAt DESC)`, `IX_AuditLogs_User (UserId, OccurredAt DESC)`. Statements separated by `--> statement-breakpoint`. `DbModule` = reference `db.module.ts` (pool `max: 10`, `onApplicationShutdown` ends the client). `migrate.entry.ts` = reference version (advisory lock `728_401_991`, `DB_MIGRATE_LOCK_WAIT_SECONDS` default 120).
- [ ] **Step 5: Implement test harness.** `int-setup.ts`: set `DATABASE_URL` to the test URL, `installBigIntJson()`, `AUTH_PASSWORD_LOGIN_ENABLED=true`, fake `AZURE_AD_TENANT_ID`/`AZURE_AD_CLIENT_ID` GUIDs, all `*_RATE_LIMIT_PER_MIN=100000`. `prepare-test-db.ts`: create the `_test` DB via the admin URL if missing, then `drizzle-kit migrate` (no seed — tests seed their own rows). `bootHttpContext` builds the app exactly like `main.api.ts` (extract the shared setup into `src/bootstrap/configure-app.ts`: `configureApp(app: INestApplication): Promise<void>` and call it from both).
- [ ] **Step 6: Run** the int test — Expected: PASS. Also `npm run typecheck`.
- [ ] **Step 7: Commit** `feat(server): drizzle schema for P0 tables, partitioned audit log, test harness`

### Task 5: Migration drift guard

**Files:**
- Create: `server/src/db/migration-status.ts`, `migration-check.ts`, `assert-migrations.ts`
- Modify: `server/src/main.api.ts`, `server/src/main.worker.ts` (call guard first)
- Test: `server/src/db/migration-status.test.ts`, `server/src/db/migration-check.int-test.ts`

**Interfaces:**
- Produces (verbatim names from reference): `compareMigrations(files: MigrationRef[], applied: AppliedMigration[] | null): MigrationStatus`, `describeMigrationStatus(status): MigrationReport`, `resolveMigrationCheckMode(env): { mode: 'enforce' | 'warn' | 'off'; error?: string }`, `checkMigrationsForBoot(env)`, `guardMigrationsOrExit(env = process.env): Promise<void>`.

- [ ] **Step 1: Port the reference unit tests** for `compareMigrations` and `resolveMigrationCheckMode` (values: off = `off|false|no|0`; warn = `warn|warning`; enforce = `enforce|true|yes|1|strict`; empty ⇒ enforce; unknown ⇒ enforce + error).
- [ ] **Step 2: Write the failing integration test**

```ts
it('reports pending when a journal entry is not applied', async () => {
  const status = await checkMigrations(sqlAgainstEmptyTestDb, { DB_MIGRATIONS_DIR: 'drizzle' });
  expect(status.verdict).toBe('pending');
});
it('reports ok on the migrated test DB', async () => {
  expect((await checkMigrations(ctx.sql, process.env)).verdict).toBe('ok');
});
```

- [ ] **Step 3: Run** both — Expected: FAIL. **Step 4: Port** the three files from reference `server/src/db/`. **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): migration drift guard at boot`

### Task 6: Permission catalog, roles, reference-data migration, dev seed

**Files:**
- Create: `server/src/common/auth/permission-catalog.ts`; `server/drizzle/0002_reference_data.sql` (custom); `server/src/db/seed.ts`
- Test: `server/src/common/auth/permission-catalog.test.ts`, `server/src/db/reference-data.int-test.ts`

**Interfaces:**
- Produces:
  - `ROLE_CODES = ['ADMIN', 'OPERATOR', 'VIEWER'] as const`; `type RoleCode`.
  - `PERMISSION_CODES` (34 codes, exactly): `dashboard:view, tracking:view, tracking:history, sessions:read, sessions:classify, work-orders:read, work-orders:link, work-orders:void, work-orders:edit-note, booking:read, booking:refresh, integration:view, integration:manage, devices:read, devices:manage, devices:sync, teams:read, teams:manage, org:read, org:manage, users:read, users:manage, roles:manage, streaming:view-live, streaming:live-wall, streaming:talk, playback:view, evidence:export, evidence:download, notifications:read, alerts:view, alerts:manage, audit:view, settings:manage`.
  - `ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]>` — ADMIN = all 34; OPERATOR = `dashboard:view, tracking:view, tracking:history, sessions:read, sessions:classify, work-orders:read, work-orders:link, work-orders:edit-note, booking:read, booking:refresh, devices:read, teams:read, teams:manage, org:read, streaming:view-live, streaming:live-wall, streaming:talk, playback:view, evidence:export, evidence:download, notifications:read, alerts:view, alerts:manage` (23); VIEWER = `dashboard:view, tracking:view, tracking:history, sessions:read, work-orders:read, booking:read, devices:read, teams:read, org:read, notifications:read, alerts:view` (11).
  - `ROLE_SCOPE: Record<RoleCode, 'all' | 'department'>` = `{ ADMIN: 'all', OPERATOR: 'department', VIEWER: 'department' }`.
  - Settings rows for P0: `auth.max-failed-logins` = `5` (ValueType 2, Category `auth`), `auth.lockout-minutes` = `15` (ValueType 2, Category `auth`).

- [ ] **Step 1: Write the failing tests**

```ts
// permission-catalog.test.ts
expect(PERMISSION_CODES).toHaveLength(34);
expect(new Set(PERMISSION_CODES).size).toBe(34);
expect(ROLE_PERMISSIONS.ADMIN).toEqual(PERMISSION_CODES);
for (const role of ['OPERATOR', 'VIEWER'] as const) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSION_CODES).toContain(p);
expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('work-orders:void');
expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('audit:view');
expect(ROLE_PERMISSIONS.VIEWER).not.toContain('work-orders:link');
// reference-data.int-test.ts (after migrate)
expect((await sql`select "Code" from "Roles" order by "Code"`).map(r => r.Code)).toEqual(['ADMIN', 'OPERATOR', 'VIEWER']);
expect(await dbPermissionCodes()).toEqual([...PERMISSION_CODES].sort());
for (const role of ROLE_CODES) expect(await dbRolePermissions(role)).toEqual([...ROLE_PERMISSIONS[role]].sort());
expect(await settingValue('auth.max-failed-logins')).toBe('5');
// idempotent: run the 0002 SQL a second time → no error, same row counts
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the catalog file and generate `0002_reference_data` with `npm run db:generate -- --custom --name=reference_data`: inserts for Roles (`IsSystem = true`, Thai names `ผู้ดูแลระบบ`, `เจ้าหน้าที่ศูนย์ควบคุม`, `ผู้ดูข้อมูล`), Permissions (Resource/Action split at `:`), RolePermissions (join by codes), Settings — every statement `ON CONFLICT DO NOTHING`. The int test is the guard that SQL and catalog stay equal (later phases append new migrations and extend the catalog together).
- [ ] **Step 4: Implement `seed.ts`** (dev only): exit 1 with a message when `NODE_ENV === 'production'`; upsert departments `HQ` (root, `สำนักงานใหญ่`) and `OPS` (child of HQ, `ฝ่ายปฏิบัติการ`); users `admin` (ADMIN, no department, password `SEED_ADMIN_PASSWORD || 'Admin@12345'`), `operator1` (OPERATOR, OPS), `viewer1` (VIEWER, OPS) with `SEED_DEMO_PASSWORD || 'Demo@12345'`. Never touches RolePermissions or Settings.
- [ ] **Step 5: Run** tests + `npm run db:seed` against dev DB — Expected: PASS; seed run twice leaves 3 users.
- [ ] **Step 6: Commit** `feat(server): permission catalog and reference data migration`

### Task 7: Redis, locks, rate limiting

**Files:**
- Create: `server/src/common/redis/redis-connect.ts`, `redis.module.ts`; `server/src/common/lock/lock-key.ts`, `redis-lock.service.ts`, `lock.module.ts`; `server/src/common/rate-limit/rate-limit-specs.ts`, `rate-limit-plan.ts`, `fixed-window.ts`, `rate-limiter.service.ts`, `rate-limit.decorator.ts`, `rate-limit.guard.ts`, `rate-limit.module.ts`
- Test: `fixed-window.test.ts`, `rate-limit-specs.test.ts`, `server/src/common/lock/redis-lock.int-test.ts`, `server/src/common/rate-limit/rate-limit.int-test.ts`

**Interfaces:**
- Produces:
  - `REDIS_CLIENT` provider (`RedisClientType | null`, from `openOptionalRedis`); `redisUrl(env)`, `redisConnectTimeoutMs(env)` (500–60000, default 5000).
  - `RedisLockService.withLock<T>(key: string, ttlSeconds: number, run: () => Promise<T>): Promise<T | null>`; `acquireLease(key, ttlSeconds, onLost?): Promise<LockLease | null>`; `lockKey(key, env)`. **Change from reference:** when Redis is unavailable, `withLock` returns `null` without running (fail-safe for sweeps, Part 2 §2.6), and logs a warning.
  - `type RateLimitName = 'auth-login' | 'auth-sso' | 'auth-refresh'` (P0; later phases append); env `AUTH_LOGIN_RATE_LIMIT_PER_MIN` (60), `AUTH_SSO_RATE_LIMIT_PER_MIN` (60), `AUTH_REFRESH_RATE_LIMIT_PER_MIN` (120), all keyed by IP, counter `local`.
  - `@RateLimit(name)`; `RateLimitGuard` registered as `APP_GUARD` (order fixed in Task 8). 429 → `AppException(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง')` with `Retry-After`.

- [ ] **Step 1: Port reference unit tests** for `hitFixedWindow` and `rateLimitSpec`; add: `withLock` with Redis down → returns `null` and `run` not called.
- [ ] **Step 2: Write int tests**

```ts
// two concurrent withLock on same key: exactly one runs
const runs: number[] = [];
await Promise.all([lock.withLock('t', 5, async () => { runs.push(1); await sleep(200); }), lock.withLock('t', 5, async () => { runs.push(2); })]);
expect(runs).toHaveLength(1);
// rate limit: AUTH_LOGIN_RATE_LIMIT_PER_MIN=2 → third POST /api/auth/login from same IP is 429 with Retry-After
```

- [ ] **Step 3: Run** — FAIL. **Step 4: Port/implement.** **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(server): redis connection, locks, rate limiting`

### Task 8: Auth core — login, refresh rotation, logout, me, guards

**Files:**
- Create: `server/src/common/auth/auth-user.ts` (extend), `public.decorator.ts`, `require-permission.decorator.ts`, `current-user.decorator.ts`, `jwt-auth.guard.ts`, `permissions.guard.ts`, `permission-check.service.ts`
- Create: `server/src/modules/auth/jwt-access.module.ts`, `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `tokens.service.ts`, `lockout.ts`, `refresh-ttl.ts`, `refresh-cookie.ts`, `refresh-reuse.ts`, `refresh-token-source.ts`, `password-login.policy.ts`, `username.ts`, `dto/*.ts`, `auth.mapper.ts`
- Test: `lockout.test.ts`, `refresh-reuse.test.ts`, `username.test.ts`, `server/src/modules/auth/auth.int-test.ts`

**Interfaces:**
- Consumes: `DRIZZLE`, `SettingsService` is **not** available yet — read thresholds through `AuthSettings` port `getLockoutPolicy(): Promise<{ maxFailed: number; lockMinutes: number }>` implemented in Task 11 by `SettingsService`; in this task provide `StaticAuthSettings` returning `{ maxFailed: 5, lockMinutes: 15 }` bound to token `AUTH_SETTINGS`.
- Produces:
  - `JwtPayload = { sub: string; username: string; roleId: string; roleCode: RoleCode; departmentId: string | null; permissions: string[] }`; `AuthUser = { id: bigint; username: string; roleId: bigint; roleCode: RoleCode; departmentId: bigint | null; permissions: string[] }`; `AuthUserLike = Omit<AuthUser, 'permissions'>`.
  - `@Public()`, `@RequirePermission(...codes: PermissionCode[])` (requires all), `@CurrentUser()`.
  - `PermissionCheckService.roleGrants(roleId: bigint, codes: string[]): Promise<Set<string>>`, `hasPermissionNow(user: { id: bigint; roleId: bigint; roleCode: string }, code: PermissionCode): Promise<boolean>` (ADMIN ⇒ true). **No temporary grants** (table removed).
  - Guard order as `APP_GUARD`: `JwtAuthGuard` → `RateLimitGuard` → `PermissionsGuard`.
  - `TokensService.signAccessToken(user: AuthUser): Promise<string>`; `issueRefreshToken(userId: bigint, ip?: string, userAgent?: string, userDeviceId: bigint | null = null): Promise<string>`; `rotate(raw: string, ip?: string, userAgent?: string): Promise<{ userId: bigint; newRaw: string; userDeviceId: bigint | null }>`; `revoke(raw: string): Promise<bigint | null>`; `revokeAllForUser(userId: bigint): Promise<void>`.
  - `normalizeUsername(raw: string): string` = trim + lowercase.
  - `REFRESH_COOKIE = 'refresh_token'`, `REFRESH_COOKIE_PATH = '/api/auth'`, `REFRESH_HEADER = 'x-refresh-token'`, `DEFAULT_REFRESH_TTL_HOURS = 8`.
  - `REFRESH_REUSE_GRACE_SECONDS = 10`; `refreshTokenState(row: { RevokedAt: Date | null; ReplacedByTokenId: bigint | null; ReplacedAt?: Date | null }, now: Date): 'live' | 'ended' | 'reuse' | 'race'` — `race` = replaced within grace.
  - HTTP (camelCase bodies): `POST /api/auth/login { username, password }` → 201 `{ accessToken, user: AuthUserView }` (+ refresh cookie, or `refreshToken` in body when the request sent the `x-refresh-token` header or body field); `POST /api/auth/refresh` → `{ accessToken, user }`; `POST /api/auth/logout` → 204; `GET /api/auth/me` → `AuthUserView`; `POST /api/auth/change-password { oldPassword, newPassword }` (10–200 chars) → 204.
  - `AuthUserView = { id: string; username: string; fullName: string; email: string | null; roleCode: RoleCode; roleName: string; departmentId: string | null; departmentName: string | null; permissions: string[] }`.
  - Error codes: `INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED_TEMPORARY` (401, `details.retryAfterMinutes`), `ACCOUNT_DISABLED` (401), `REFRESH_INVALID` (401), `REFRESH_RACE` (401, no revoke-all).
- Note: add column `RefreshTokens.ReplacedAt timestamptz` in this task's migration (`npm run db:generate -- --name=refresh_replaced_at`) — needed for the grace window.

- [ ] **Step 1: Port reference unit tests** for `checkLoginGate`, `decideFailure`, `isPasswordAttemptLock`, `resolveRefreshTtl`, `refreshCookieOptions`, `resolveRefreshToken`; add:

```ts
expect(normalizeUsername('  Admin ')).toBe('admin');
const t0 = new Date('2026-11-04T00:00:00Z');
expect(refreshTokenState({ RevokedAt: null, ReplacedByTokenId: null }, t0)).toBe('live');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, new Date(t0.getTime() + 5_000))).toBe('race');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, new Date(t0.getTime() + 11_000))).toBe('reuse');
expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: null }, t0)).toBe('ended');
```

- [ ] **Step 2: Write the failing integration tests** (`auth.int-test.ts`, seeding its own department + users)

```ts
it('logs in with case/space-insensitive username', async () => {
  const r = await http.post('/api/auth/login').send({ username: ' Admin ', password: 'Admin@12345' });
  expect(r.status).toBe(201); expect(r.body.user.username).toBe('admin');
  expect(r.headers['set-cookie'][0]).toMatch(/refresh_token=.*Path=\/api\/auth.*HttpOnly/);
});
it('locks after 5 wrong passwords and reports minutes', async () => {
  for (let i = 0; i < 5; i++) await http.post('/api/auth/login').send({ username: 'viewer1', password: 'x' });
  const r = await http.post('/api/auth/login').send({ username: 'viewer1', password: 'Demo@12345' });
  expect(r.status).toBe(401); expect(r.body.code).toBe('ACCOUNT_LOCKED_TEMPORARY'); expect(r.body.details.retryAfterMinutes).toBeGreaterThan(0);
});
it('Status=2 cannot log in', async () => { /* code ACCOUNT_DISABLED */ });
it('rotates refresh token; reuse after grace revokes all', async () => { /* refresh with cookie A → B; advance ReplacedAt by -11s in DB; refresh with A → 401 REFRESH_INVALID; refresh with B → 401 */ });
it('two concurrent refreshes with same token keep the session', async () => {
  const [a, b] = await Promise.all([refreshWith(cookieA), refreshWith(cookieA)]);
  expect([a.status, b.status].sort()).toEqual([200, 401]);
  expect([a.body.code, b.body.code]).toContain('REFRESH_RACE');
  expect((await refreshWith(cookieOf(a.status === 200 ? a : b))).status).toBe(200); // winner's token still live
});
it('guards: no token 401, missing permission 403, ADMIN bypass', async () => { /* test-only controller with @RequirePermission('audit:view') */ });
```

- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** by porting reference `modules/auth` (drop PIN, Entra parts go to Task 9, drop `employeeId`/`companyId`), with `normalizeUsername` in login and user create, `rotate` doing `SELECT … FOR UPDATE` on the token row and setting `ReplacedAt`, and the `race` branch returning `REFRESH_RACE` without `revokeAllForUser`. `AuthModule` imports `JwtAccessModule` only (RealtimeModule hookup comes in Task 13). `JWT_ACCESS_SECRET` required when `NODE_ENV=production` (dev fallback `'dev-insecure-jwt-secret-change-me'`), `ACCESS_TOKEN_TTL` default `15m`.
- [ ] **Step 5: Run** — PASS; `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(server): password auth, refresh rotation with race grace, guards`

### Task 9: Microsoft Entra SSO

**Files:**
- Create: `server/src/modules/auth/azure/azure-ad.config.ts`, `azure-ad.tokens.ts`, `azure-claims.ts`, `entra-token.verifier.ts`; `dto/azure-login.dto.ts`
- Modify: `auth.controller.ts`, `auth.service.ts`, `auth.module.ts`
- Test: `azure-claims.test.ts`, `entra-token.verifier.test.ts`, `server/src/modules/auth/azure-login.int-test.ts`

**Interfaces:**
- Produces:
  - `AzureAdConfig = { enabled: boolean; tenantId: string; clientId: string; issuer: string; jwksUri: string; allowedEmailDomains: string[] }`; `readAzureAdConfig(env)` (env `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_ALLOWED_EMAIL_DOMAINS`); `AZURE_AD_CONFIG = 'AZURE_AD_CONFIG'`.
  - `class EntraTokenVerifier { constructor(config: AzureAdConfig, jwks?: JWTVerifyGetKey); verify(idToken: string): Promise<AzureIdentity> }` — jose `jwtVerify` RS256, issuer, audience = clientId, clockTolerance 60; `jwks` defaults to `createRemoteJWKSet(new URL(config.jwksUri))` (the parameter exists so tests inject `createLocalJWKSet`).
  - `AzureIdentity = { objectId: string; email: string | null; displayName: string | null }`.
  - `GET /api/auth/config` (`@Public`) → `{ sso: { enabled: false } | { enabled: true; clientId: string; tenantId: string; authority: string }; passwordLogin: { enabled: boolean } }` (`authority = https://login.microsoftonline.com/{tenantId}`).
  - `POST /api/auth/azure { idToken }` (`@Public`, `@RateLimit('auth-sso')`) → same response as login. Match `Users.AzureObjectId = oid`, else `lower(Email) = lower(email)` with `AzureObjectId IS NULL` (then bind `oid`); no match → 401 `SSO_ACCOUNT_NOT_FOUND`; Status ≠ 1 → `ACCOUNT_DISABLED`. Successful SSO sets `Status=1`, clears `FailedLoginCount`/`LockedUntil` only when the lock was a password-attempt lock (`isPasswordAttemptLock`).
  - Boot throws when SSO is disabled **and** `AUTH_PASSWORD_LOGIN_ENABLED=false`.

- [ ] **Step 1: Port reference tests** for `extractAzureIdentity` and `readAzureAdConfig`.
- [ ] **Step 2: Write failing tests** — verifier with a locally generated RS256 key pair: valid token → identity; wrong `aud` → rejects; expired beyond 60s → rejects. Int: token for `oid` already linked → 201; token whose email matches an unlinked user → 201 and `AzureObjectId` now set; unknown → 401 `SSO_ACCOUNT_NOT_FOUND`; `GET /api/auth/config` shows `sso.enabled: true` with the fake tenant from `int-setup.ts`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** (port). **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(server): Microsoft Entra SSO login`

### Task 10: Department data scope

**Files:**
- Create: `server/src/common/scope/scope.types.ts`, `data-scope.service.ts`, `scope.predicates.ts`, `scope-write.service.ts`, `scope.module.ts`
- Test: `scope.predicates.test.ts`, `server/src/common/scope/data-scope.int-test.ts`

**Interfaces:**
- Produces:
  - `type ScopeKind = 'all' | 'department'`; `DataScope = { kind: ScopeKind; userId: bigint; departmentIds: bigint[] }` (`departmentIds` = user's department + all descendants; empty for a non-ADMIN user without department ⇒ sees nothing).
  - `DataScopeService.current(): Promise<DataScope>`; `forUser(user: AuthUserLike): Promise<DataScope>`; `departmentSubtree(rootId: bigint): Promise<bigint[]>` (recursive CTE over `Departments.ParentId` excluding `IsDeleted`, 60s in-memory cache); `invalidateDepartmentTree(): void`.
  - `scopeByDepartment(scope: DataScope, col: PgColumn): SQL | undefined` (undefined for `all`; `inArray(col, ids)` else; `sql\`false\`` when empty).
  - `ScopeWriteService.assertDepartmentWritable(departmentId: bigint): Promise<void>` → `AppException(404, 'NOT_FOUND', 'ไม่พบข้อมูล')` when outside scope.

- [ ] **Step 1: Write failing tests** — unit: `scopeByDepartment` returns `undefined` for `all`, renders `in (...)` for ids, `false` for empty. Int: tree HQ → OPS → OPS-N; OPERATOR in OPS has `departmentIds` = [OPS, OPS-N]; after `invalidateDepartmentTree()` a newly added grandchild appears; OPERATOR with `DepartmentId = null` → `[]`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** using `ROLE_SCOPE` from Task 6. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): department subtree data scope`

### Task 11: Audit log + settings

**Files:**
- Create: `server/src/common/audit/audit.decorator.ts`, `audit.interceptor.ts`, `audit-redact.ts`; `server/src/modules/audit-logs/*` (module, controller, service, dto); `server/src/common/settings/setting-spec.ts`, `settings.service.ts`, `settings.module.ts`; `server/src/modules/settings/*` (admin controller + service)
- Modify: `permissions.guard.ts` (audit denials), `auth.module.ts` (bind `AUTH_SETTINGS` to `SettingsService`)
- Test: `audit-redact.test.ts`, `setting-spec.test.ts`, `server/src/common/audit/audit.int-test.ts`, `server/src/modules/settings/settings.int-test.ts`

**Interfaces:**
- Produces:
  - `@Audit(action: string, resourceType?: string)`; `AuditInterceptor` as `APP_INTERCEPTOR` — writes `AuditLogs` (Result 1 success / 2 failure) with `CorrelationId = getCorrelationId()`; ResourceId from result `id` ?? `params.id`; body redacted by `/pass(word)?|token|hash|secret|otp|pin/i`, sliced to 4000 chars; insert is fire-and-forget (errors logged, never fail the request).
  - `redactBody(body: unknown): unknown`.
  - `GET /api/audit-logs` (`audit:view`) query `{ page=1, pageSize=50 (≤100), search?, userId?, action?, resourceType?, result? (1|2), from?, to? }` → envelope of `{ id, occurredAt, userId, actorUsername, actorRole, action, resourceType, resourceId, result, httpMethod, requestPath, ip, correlationId }`; `GET /api/audit-logs/actions` → `{ data: string[], total }`.
  - `SETTING_DEFAULTS = { 'auth.max-failed-logins': 5, 'auth.lockout-minutes': 15 } as const`; `SETTING_BOUNDS = { 'auth.max-failed-logins': { min: 3, max: 20 }, 'auth.lockout-minutes': { min: 1, max: 1440 } }`; `checkSettingValue(key, valueType, raw): { ok: true; normalized: string } | { ok: false; message: string }`; `SETTING_PAIR_RULES = []` (P0).
  - `SettingsService.getInt(key: SettingKey)`, `getBool`, `getString`, `preload(keys)`, `invalidate(key?)` — 30s cache, fallback to `SETTING_DEFAULTS`.
  - `GET /api/settings` (`settings:manage`) → `{ groups: [{ category, items: [{ key, value, valueType, description, min?, max? }] }], total }`; `PATCH /api/settings/:key { value }` (`settings:manage`, `@Audit('UPDATE_SETTING', 'Settings')`) → item; unknown key → 404; out of bounds → 400 `SETTING_OUT_OF_RANGE` with Thai message from `checkSettingValue`.

- [ ] **Step 1: Write failing tests**

```ts
expect(redactBody({ username: 'a', password: 'p', nested: { refreshToken: 't' } })).toEqual({ username: 'a', password: '[REDACTED]', nested: { refreshToken: '[REDACTED]' } });
expect(checkSettingValue('auth.max-failed-logins', 2, '0')).toMatchObject({ ok: false });
expect(checkSettingValue('auth.max-failed-logins', 2, '7')).toEqual({ ok: true, normalized: '7' });
// int: PATCH /api/settings/auth.max-failed-logins {value:'7'} as admin → 200; AuditLogs row Action UPDATE_SETTING, Result 1, CorrelationId = response header
// int: OPERATOR calling GET /api/settings → 403 and AuditLogs row Result 2, Action 'ACCESS_DENIED'
// int: after PATCH to '3', third wrong password locks the account (AUTH_SETTINGS bound to SettingsService)
// int: GET /api/audit-logs as OPERATOR → 403; as ADMIN → envelope with the rows above
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (port reference audit + settings, drop company scope; audit list visible to ADMIN only per matrix). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): audit interceptor, audit log API, settings`

### Task 12: Org and user administration APIs

**Files:**
- Create: `server/src/common/http/paged.ts`, `page-query.dto.ts`, `parse-bigint.pipe.ts`; `server/src/modules/departments/*`, `server/src/modules/employees/*`, `server/src/modules/users/*` (incl. `user-access-rules.ts`), `server/src/modules/roles/*`
- Test: `user-access-rules.test.ts`, `departments.int-test.ts`, `employees.int-test.ts`, `users.int-test.ts`, `roles.int-test.ts`

**Interfaces:**
- Consumes: `DataScopeService`, `ScopeWriteService`, `TokensService.revokeAllForUser`, `@Audit`, `normalizeUsername`, `AuthService.hashPassword`.
- Produces:
  - `paged<T>(data: T[], total: number, page: number, pageSize: number): { data: T[]; page: number; pageSize: number; total: number }`; `PageQueryDto { page = 1; pageSize = 20 (1–100); q? }`; `ParseBigIntPipe` (`/^\d{1,19}$/`, else 400).
  - Departments (`org:read` / `org:manage`): `GET /api/departments` → envelope `{ id, code, name, parentId, isActive }`; `GET /api/departments/tree` → `{ data: DepartmentNode[], total }` with `children`; `POST`, `PATCH /:id`, `DELETE /:id` (soft). Delete with live children or employees → 409 `DEPARTMENT_IN_USE` `details: { children, employees }`. Parent cycles → 400 `DEPARTMENT_CYCLE`. Writes call `invalidateDepartmentTree()`. Audit actions `CREATE_DEPARTMENT` / `UPDATE_DEPARTMENT` / `DELETE_DEPARTMENT`.
  - Employees (`org:read` / `org:manage`): envelope of `{ id, employeeCode, firstName, lastName, phone, departmentId, departmentName, userId, bookingEmployeeRef, status }`; filters `departmentId?`, `status?`, `q`; duplicate code → 409 `EMPLOYEE_CODE_TAKEN`; user already linked → 409 `USER_ALREADY_LINKED`. Audit `CREATE_EMPLOYEE` / `UPDATE_EMPLOYEE` / `DELETE_EMPLOYEE`.
  - Users (`users:read` / `users:manage`): envelope of `{ id, username, fullName, email, roleId, roleCode, roleName, departmentId, departmentName, status, lastLoginAt, azureLinked }`; `POST { username, fullName, email?, password?, roleCode, departmentId? }` (password optional ⇒ SSO-only; non-ADMIN role requires `departmentId`; duplicate → 409 `USERNAME_TAKEN`); `PATCH /:id`; `PATCH /:id/access { enabled }` (`@Audit('SET_USER_ACCESS', 'Users')`); `DELETE /:id`. `userAccessBlockerOf(targetId, actorId, enabled)` → self-suspend 400 `CANNOT_SUSPEND_SELF`; `planUserAccessChange(current, enabled)` ported. `cutAllSessions(userId: bigint, reason: string): Promise<{ revokedSessions: number; revokedPushTokens: number }>` — one transaction revoking `RefreshTokens` + `PushTokens`, then (after commit) `RealtimeGateway.revokeUserSessions` — the gateway call is added in Task 13; here call an injected `SessionRevocationNotifier.notify(userId: bigint, payload: { scope: 'account'; reason: string }): void` port bound to a no-op.
  - Roles (`users:read` for read, `roles:manage` for write): `GET /api/roles` → `{ data: [{ id, code, name, isSystem }], total }`; `GET /api/roles/:id/permissions` → `{ data: string[], total }`; `PUT /api/roles/:id/permissions { permissions: string[] }` — ADMIN role → 400 `ROLE_IMMUTABLE`; codes not in catalog → 400 `UNKNOWN_PERMISSION`; `@Audit('SET_ROLE_PERMISSIONS', 'Roles')`.
  - All rows filtered by `scopeByDepartment` (users with `DepartmentId = null` visible only to ADMIN); out-of-scope `:id` → 404.

- [ ] **Step 1: Port `user-access-rules` unit tests.**
- [ ] **Step 2: Write failing int tests** (one per bullet above, at least): department delete with child → 409 `DEPARTMENT_IN_USE` and row still live; cycle → 400; OPERATOR in OPS lists only OPS-subtree employees and gets 404 for an HQ employee id; create user `' Bob '` stores `bob`; suspend self → 400; suspend other → refresh tokens revoked (`RevokedAt` set) and next refresh 401; PUT permissions on ADMIN → 400; PUT with `'x:y'` → 400; envelope shape `{ data, page, pageSize, total }` with string ids.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** (port reference services, delete company logic, map DB rows to camelCase in each module's `*.mapper.ts`). **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(server): departments, employees, users, roles admin APIs`

### Task 13: Realtime gateway skeleton

**Files:**
- Create: `server/src/common/realtime-bus/realtime-bus.types.ts`, `redis-io.adapter.ts`; `server/src/modules/realtime/realtime.module.ts`, `realtime.gateway.ts`, `realtime-rooms.ts`, `realtime-emitter.service.ts`, `session-revocation.notifier.ts`
- Modify: `server/src/bootstrap/configure-app.ts` (adapter), `server/src/modules/users/users.module.ts` (bind notifier)
- Test: `realtime-rooms.test.ts`, `server/src/modules/realtime/realtime.int-test.ts`

**Interfaces:**
- Produces:
  - `REALTIME_NAMESPACE = '/realtime'`, `REALTIME_REDIS_KEY = 'socket.io'`, `REALTIME_UNAUTHORIZED = 'unauthorized'`.
  - `roomsForClient(identity: { sub: string; roleCode: RoleCode; departmentIds: string[] }): string[]` → always `org`, `user:{sub}`; ADMIN adds `dept:*`; others add `dept:{id}` for each id in their scope subtree.
  - `RealtimeGateway.revokeUserSessions(userId: string, payload: { scope: 'account'; reason: string; at: string }): void` — emits `session:revoked` to `user:{id}` then `disconnectSockets(true)`; `get bus(): BroadcastBus` (server when in API, `RealtimeEmitterService.bus` in worker).
  - `RedisIoAdapter(app).connect(): Promise<boolean>` — falls back to in-memory adapter when Redis is unavailable.
  - `SessionRevocationNotifier` implementation calling the gateway.

- [ ] **Step 1: Write failing tests** — unit: rooms for ADMIN contain `org`, `user:1`, `dept:*`; OPERATOR with subtree `[2, 3]` → `dept:2`, `dept:3`, no `dept:*`. Int (socket.io-client against `bootHttpContext` server on a random port): no token → `connect_error` message `unauthorized`; valid token connects; `PATCH /api/users/:id/access { enabled: false }` by admin → the target's socket receives `session:revoked` with `scope: 'account'` and then `disconnect`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (port reference gateway/adapter; drop tracking/alert rooms — later phases add them). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): realtime gateway with auth, rooms and session revocation`

### Task 14: Swagger, health checks, Docker images, CI

**Files:**
- Modify: `server/src/bootstrap/configure-app.ts` (Swagger), `server/src/app.controller.ts` (health)
- Create: `server/Dockerfile`, `server/.dockerignore`, `.github/workflows/ci.yml`
- Test: `server/src/app.health.int-test.ts`

**Interfaces:**
- Produces: `GET /api/health` (`@Public`) `{ status: 'ok' }`; `GET /api/health/db` (`@Public`) → 200 `{ status: 'ok' }` or 503 `SERVICE_UNAVAILABLE`; `GET /api/health/redis` (`@Public`) → same shape. Swagger UI at `/api/docs`, JSON at `/api/docs-json` (`addBearerAuth()`, **no** `addServer('/api')`).
- Dockerfile stages: `build` (node:22-slim, `npm ci`, `npm run build`), `api` (`CMD ["node", "dist/main.api.js"]`), `worker` (adds `ffmpeg` via apt, `CMD ["node", "dist/main.worker.js"]`), `migrate` (`CMD ["node", "dist/db/migrate.entry.js"]`); all copy `drizzle/`.
- CI `.github/workflows/ci.yml`: job `server` on `ubuntu-latest`, Node 22, services `postgres:16-alpine` (db `bwc_test`) and `redis:7-alpine`, steps `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run db:prepare:test` → `npm run test:int` → `npm run build`. Job `client` is added by the client plan's last task.

- [ ] **Step 1: Write failing int test** — `/api/health/db` 200 on the test DB; with the DB pool pointed at an unreachable URL (separate app instance) → 503 `{ code: 'SERVICE_UNAVAILABLE' }`; `/api/docs-json` lists `/api/auth/login`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `docker build --target api server` succeeds (if Docker is available; otherwise note it in the hand-off).
- [ ] **Step 5: Commit** `chore(server): swagger, health checks, Dockerfile, CI workflow`

---

## Done when

- `npm run ci` passes in `server/` against `docker-compose.dev.yml` services.
- P0 server acceptance from Part 8: password + Entra login work; refresh rotation/reuse covered; an endpoint without `@RequirePermission` fails the guard test; migrations re-run cleanly; the drift guard stops a process with pending migrations.
