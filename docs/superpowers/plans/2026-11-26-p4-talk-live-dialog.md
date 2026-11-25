# P4 Talk + Live Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way talk with a body camera from every live view on the web (live wall, map camera card, work-order list and detail), by porting the reference talk feature onto our streaming module.

**Architecture:** Browser opens `POST /api/talk/sessions` with the token of its own active live session, gets a one-time ticket, opens raw WS `/api/talk/ws?ticket=`; the `api` process relays PCM16LE 8 kHz both ways to the DSS middleware WS `/api/v1/talk/{talkId}/audio`. Call state lives in `TalkSessions` (1 open call per camera and per user, enforced by partial unique indexes). Client side is the reference AudioWorklet stack plus `LiveStreamDialog`.

**Tech Stack:** NestJS 10 + Drizzle + PostgreSQL, `ws` raw WebSocket, Vitest; React 18 + TanStack Query, AudioWorklet, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-26-p4-talk-live-dialog-design.md` (read it first; §-numbers below refer to it).
**Reference source (read-only):** `C:\Git\Internal-BodyCam` — `server/src/modules/talk/**`, `client/src/features/talk/**`, `client/src/test/talkFakes.ts`, `client/src/test/workletScope.ts`, `client/src/features/streaming/components/LiveStreamDialog.tsx` (+ `.test.tsx`), talk parts of `client/src/features/streaming/LiveWallPage.tsx` (+ test `describe('LiveWallPage — คุยผ่านกล้อง')`). Reference spec: `docs/superpowers/specs/2026-09-24-bodycam-talk-design.md`.

## Global Constraints

- Never create or modify files in `C:\Git\Internal-BodyCam`, `C:\Git\psd-bwc-dss-services` or the Azure repos. Copy into this repo, then adapt.
- **No git commits.** The user commits. Every "Commit" step in this plan = leave the change in the working tree; never `git add` / `commit` / `stash` / `reset`.
- Reference enum numbers are frozen (they go into the DB): `TALK_STATUS` 1 REQUESTED · 2 ACTIVE · 3 ENDED · 4 FAILED; `TALK_END_REASON` 1 USER_STOPPED · 2 EXPIRED · 3 VENDOR_ERROR · 4 POLICY_DISABLED · 5 MAX_DURATION · 6 DISCONNECTED · 7 VENDOR_ENDED; close codes 1000/1001/1008/4001/4002/4003/4004/4005/4006/4401.
- Reference timing constants unchanged: ticket TTL 30 000 ms · revalidate 15 000 ms · idle expire 60 000 ms · start timeout 30 000 ms · max WS payload 4096 B · ≤ 75 uplink frames per 1 000 ms.
- Server errors are `AppException(status, code, message, details?)` → `{ statusCode, code, message, details?, correlationId }`. JSON is camelCase. Ids are strings in JSON.
- No new env vars. Talk REST base = `${DSS_BASE_URL}/api/v1/talk`; audio WS = same with `http→ws`, `https→wss`. Auth = `dssAuthorizationHeader(apiKey)` on every REST call and the WS handshake. Driver follows `DSS_DRIVER` (`mock` = echo, automated tests only).
- Never log or store audio, tickets, JWTs or a full `talkId`.
- UI text Thai default with English parity (i18n th/en); never name the data source (DL64). Follow `client/DESIGN.md`.
- Users have `FirstName` + `LastName` (no `FullName`). Active user = `Users.Status = 1`. Only `SUPER_ADMIN` bypasses permissions (`PermissionCheckService.roleGrants` already returns the full catalog for it).
- The worker process also imports `AppModule`: anything that needs the HTTP server must no-op when `HttpAdapterHost.httpAdapter` is absent.

## Review Focus

1. **Tab closed / network drop mid-call** — row ends `ENDED` + `DISCONNECTED`, middleware `stop` is called, and the same user can start a new call on that camera right away (no stuck 409). Test owner: Task 5.
2. **Dialog closed during the ~11 s connect** — the `start` response arrives after unmount; the client must stop that call and never open the WS. Test owner: Task 7.
3. **Middleware down or slow at start** (refused / >30 s) — 502 `TALK_START_FAILED`, row `FAILED`, and the camera is not left blocked for the next try. Test owner: Task 4.
4. **Same user, second camera in another tab** — 409 `TALK_USER_BUSY`; after the first call ends, the second start works. Test owner: Task 4.
5. **Microphone permission denied** — Thai notice shown and no server call left open. Test owner: Task 7.

---

### Task 1: `TalkSessions` table, setting, `ws` dependency

**Files:**
- Modify: `server/src/db/schema.ts` (add `TalkSessions` right after `StreamingSessions`, ~line 585)
- Create: `server/drizzle/0014_p4_talk.sql` (+ `server/drizzle/meta/0014_snapshot.json`, `_journal.json` via drizzle-kit)
- Modify: `server/src/common/settings/setting-spec.ts:6-36`
- Modify: `server/package.json` (`ws` `8.21.3` dependency, `@types/ws` `8.18.2` devDependency — exact pins, no `^`)
- Modify: `server/src/test/int-helpers.ts` (`dropTestUsers` and `resetDevices` delete `TalkSessions` rows before `StreamingSessions` / `Users` / `Devices`)
- Test: `server/src/modules/talk/talk-sessions-schema.int-test.ts` (port reference), `server/src/common/settings/setting-spec.test.ts`

**Interfaces:**
- Produces: `TalkSessions` (Drizzle table) with columns exactly as spec §5.5 / reference `schema.ts:843-871`: `Id`, `DeviceId`→Devices, `UserId`→Users, `StreamingSessionId`→StreamingSessions (all NOT NULL), `VendorTalkId varchar(64)`, `UplinkSampleRate integer`, `FrameMs smallint`, `TicketHash varchar(64)`, `TicketExpiresAt`, `Status smallint NOT NULL default 1`, `EndReason smallint`, `RequestedAt NOT NULL default now()`, `StartedAt`, `LastAccessAt`, `EndedAt`, `DurationSeconds integer`, `ErrorMessage varchar(500)`, `CreatedAt`. Indexes `IX_Talk_Device (DeviceId, RequestedAt)`, `IX_Talk_User (UserId, RequestedAt)`, unique `UX_Talk_Device_Open (DeviceId) WHERE Status IN (1,2)`, unique `UX_Talk_User_Open (UserId) WHERE Status IN (1,2)`, unique `UX_Talk_Ticket (TicketHash)`.
- Produces: setting key `'streaming.talk-max-seconds'` (default `600`, bounds `{ min: 60, max: 3600 }`).

- [ ] **Step 1: Write the failing tests**

Port the reference `talk-sessions-schema.int-test.ts` (cases: defaults · 1 open call per device · ended/failed rows do not block · `TicketHash` unique but many NULLs · FK to a missing live session fails), using `bootHttpContext`, `createTestUsers`, a `Devices` row by `DeviceCode` and a `StreamingSessions` row inserted by SQL. Add:

```ts
it('1 open call per user (UX_Talk_User_Open): a second REQUESTED/ACTIVE row for the same user on another device fails', async () => {
  await insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 2 });
  await expect(insertTalk({ deviceId: deviceB, userId, liveId: liveB, status: 1 })).rejects.toThrow(/UX_Talk_User_Open/);
});
it('an ended call does not block the same user', async () => {
  await insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 3 });
  await expect(insertTalk({ deviceId: deviceB, userId, liveId: liveB, status: 1 })).resolves.toBeDefined();
});
```

In `setting-spec.test.ts` add: `expect(SETTING_DEFAULTS['streaming.talk-max-seconds']).toBe(600)` and `expect(SETTING_BOUNDS['streaming.talk-max-seconds']).toEqual({ min: 60, max: 3600 })`.

- [ ] **Step 2: Run to verify they fail**

Run (in `server/`): `npx vitest run src/common/settings/setting-spec.test.ts` → FAIL (key missing). `npx vitest run --config vitest.integration.config.ts src/modules/talk/talk-sessions-schema.int-test.ts` → FAIL (`relation "TalkSessions" does not exist`).

- [ ] **Step 3: Implement**

Add the table to `schema.ts` with the existing helpers (`pkId`, `ref`, `tstz`, `createdAt`, `uniqueIndex(...).where(sql\`${t.Status} in (1, 2)\`)`). Run `npm run db:generate -- --name=p4_talk`, then append to `0014_p4_talk.sql` after a `--> statement-breakpoint`:

```sql
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('streaming.talk-max-seconds', '600', 2, 'streaming', 'ระยะเวลาคุยผ่านกล้องสูงสุดต่อสาย (วินาที)')
ON CONFLICT ("SettingKey") DO NOTHING;
```

Add the key to `SETTING_DEFAULTS` / `SETTING_BOUNDS`. Add the two packages with exact versions (`npm install ws@8.21.3 --save-exact` and `npm install -D @types/ws@8.18.2 --save-exact`). Update `dropTestUsers` / `resetDevices`. Run `npm run db:migrate` (dev DB) and `npm run db:prepare:test`.

- [ ] **Step 4: Run to verify they pass**

Run: the two commands of Step 2 → PASS; also `npx vitest run --config vitest.integration.config.ts src/db` (drift guard + `reference-data.int-test.ts`) → PASS; `npm run typecheck` → no errors.

- [ ] **Step 5: Commit** — leave uncommitted (Global Constraints).

---

### Task 2: Talk constants, frames, tickets

**Files:**
- Create: `server/src/modules/talk/talk-constants.ts`, `talk-frames.ts`, `talk-ticket.ts`
- Test: `server/src/modules/talk/talk-constants.test.ts`, `talk-frames.test.ts`, `talk-ticket.test.ts` (port reference)

**Interfaces:**
- Consumes: `TalkSessions` (Task 1), `DrizzleDB`.
- Produces (names as in the reference): `TALK_STATUS`, `TALK_END_REASON`, `TalkEndReason`, `TALK_OPEN_STATUSES`, `TALK_CLOSE_CODE`, `closeReasonFor(code)`, `browserCodeForUpstreamClose(code)`, `upstreamCodeForBrowserClose(code)`, `endReasonForBrowserClose(code)`, `endReasonForUpstreamClose(code)`, `TALK_VENDOR_CODE` (1000/1001/1002/1003/1004), `TALK_WS_PATH = '/api/talk/ws'`, the timing constants, `TALK_MESSAGE`, `talkBusyMessage(name: string | null)`; `UplinkFrameGuard`, `isValidDownlinkFrame`, `rawDataToBuffer`, `uplinkFrameBytes`; `TalkSessionRow`, `TALK_TICKET_PATTERN`, `createTalkTicket()`, `hashTalkTicket(v)`, `talkTicketExpiresAt(now)`, `talkWsUrl(ticket)`, `isTalkWsRequest(url)`, `talkTicketFromUrl(url)`, `consumeTalkTicket(db, ticket)`.
- Adds to `TALK_MESSAGE`: `USER_BUSY: 'คุณมีสายที่คุยอยู่กับกล้องอื่น — วางสายนั้นก่อน'`. Drop `NO_LIVE`'s reference wording only if it names a data source (it does not; keep).

- [ ] **Step 1: Copy the three reference test files; add** `expect(TALK_MESSAGE.USER_BUSY).toBe('คุณมีสายที่คุยอยู่กับกล้องอื่น — วางสายนั้นก่อน')`.
- [ ] **Step 2: Run** `npx vitest run src/modules/talk` → FAIL (modules missing).
- [ ] **Step 3: Copy the three reference source files**; fix imports to our paths (`../../db/db.types`, `../../db/schema`). No behavior change.
- [ ] **Step 4: Run** `npx vitest run src/modules/talk` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 3: Talk providers (DSS + mock)

**Files:**
- Create: `server/src/modules/talk/provider/talk-provider.interface.ts`, `dss-talk.provider.ts`, `mock-talk.provider.ts`, `talk-provider.module.ts`
- Test: `provider/dss-talk.provider.test.ts`, `provider/mock-talk.provider.test.ts` (port reference)

**Interfaces:**
- Consumes: Task 2 constants; `readDssConfig(env)` (`common/dss/dss-config.ts`), `dssAuthorizationHeader(apiKey)` and `dssRequest(url, init, timeoutMs)` (`common/dss/dss-auth.ts`); test helper `verifyDssBearer` (`server/src/test/dss-token.ts`).
- Produces: `TALK_PROVIDER` token; `TalkProvider { start({ vendorDeviceId, maxSeconds }): Promise<{ talkId; uplinkSampleRate; downlinkSampleRate; frameMs }>; stop(talkId): Promise<void>; openAudio(talkId): Promise<TalkAudioChannel> }`; `TalkAudioChannel`; `TalkProviderError(userMessage, vendorCode, detail?)`; `TalkProviderModule` providing `TALK_PROVIDER` = `DssTalkProvider` when `readDssConfig(process.env).driver === 'dss'`, else `MockTalkProvider`.

Adaptations from the reference `DssTalkProvider`:
- REST: `POST ${baseUrl}/api/v1/talk/start` (timeout `TALK_START_TIMEOUT_MS`) and `/stop` (timeout `config.timeoutMs`) through `dssRequest`, header `Authorization: await dssAuthorizationHeader(apiKey)`; success = `code === 1000`; vendor codes mapped to `TalkProviderError` exactly as the reference.
- WS: `${baseUrl.replace(/^http/, 'ws')}/api/v1/talk/${encodeURIComponent(talkId)}/audio`, `handshakeTimeout: config.timeoutMs`, same header.
- Remove `DssAuth`, `dssRequireEnv`, `trimEndChar`, `TALK_API_URL`, `STREAM_API_TIMEOUT_MS`.
- Error `message` / logs never include URLs with tokens or response bodies (same as `live-stream.provider.ts`).

- [ ] **Step 1: Port the two reference tests**; change env setup to `DSS_DRIVER=dss`, `DSS_BASE_URL=http://127.0.0.1:<port>`, `DSS_API_KEY=<test key>`; assert the fake server receives paths `/api/v1/talk/start`, `/api/v1/talk/stop`, `/api/v1/talk/<id>/audio` and a bearer that `verifyDssBearer(<test key>)` accepts on both REST and the WS upgrade. Add: `TalkProviderModule picks MockTalkProvider when DSS_DRIVER=mock`.
- [ ] **Step 2: Run** `npx vitest run src/modules/talk/provider` → FAIL.
- [ ] **Step 3: Implement** the four files per the adaptations.
- [ ] **Step 4: Run** `npx vitest run src/modules/talk/provider` → PASS; typecheck clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 4: `TalkService`, controller, module, TalkIdle

**Files:**
- Create: `server/src/modules/talk/talk.service.ts`, `talk.controller.ts`, `talk.module.ts`, `dto/start-talk.dto.ts`
- Modify: `server/src/app.module.ts` (import `TalkModule` after `StreamingModule`)
- Test: `server/src/modules/talk/talk.int-test.ts`, `talk-http.int-test.ts`, `talk-permission.int-test.ts`, `talk-idle.int-test.ts` (port reference)

**Interfaces:**
- Consumes: Tasks 1–3; `AuthUser` + `@CurrentUser()`; `@LoginOnly()` (`common/auth/login-only.decorator.ts`); `PermissionCheckService.roleGrants(roleId, roleCode)`; `SettingsService.getInt/getBool`; `AuditWriterService.insert(entry: AuditEntry)` (`common/audit/audit-writer.service.ts`, pass `userId`, `actorUsername`, `actorRole` explicitly — no request context on the relay path; column is `Changes`).
- Produces:
  - `StartTalkDto { streamSessionToken: string }` (class-validator: string, 43 chars `/^[A-Za-z0-9_-]{43}$/`).
  - `TalkService.start(user: AuthUser, streamSessionToken: string): Promise<StartTalkResult>` → `{ talkSessionId: string; wsUrl: string; uplinkSampleRate: number; downlinkSampleRate: number; frameMs: number; maxSeconds: number }`.
  - `TalkService.stop(user: AuthUser, talkSessionId: bigint): Promise<StopTalkResult>` → `{ talkSessionId: string; status: number; endReason: number | null; durationSeconds: number | null }`.
  - `consumeTicket(ticket): Promise<TalkSessionRow | null>`, `revalidate(talkSessionId: bigint, now?: Date): Promise<TalkVerdict>`, `hangUp(row, reason, audit: TalkStopAudit): Promise<void>`, `expireStaleTalks(now?: Date): Promise<number>` — semantics as the reference.
  - Routes: `POST /api/talk/sessions` — `@HttpCode(200) @RequirePermission('streaming:talk') @Audit('START_TALK', 'TalkSessions')`; `POST /api/talk/sessions/:id/stop` — `@HttpCode(200) @LoginOnly() @Audit('STOP_TALK', 'TalkSessions')`, `:id` via `ParseBigIntPipe`.

Rules (spec §5.1–5.4):
- Live permission check = `roleGrants(...).includes('streaming:talk')` on a fresh `Users` + `Roles` read (status 1, not deleted, role ≠ `TEAM_LEADER`) — same shape as `StreamingService.currentAccess`.
- Live target = `StreamingSessions` row with that `SessionToken`, `UserId = user.id`, `Status = 2`, `SessionType = 1`, joined to a non-deleted `Devices` row.
- Errors: 403 `FORBIDDEN` · 403 `STREAMING_DISABLED` (`streaming.enabled` false) · 403 `DEVICE_STREAM_DISABLED` (`StreamingEnabled` false or `Status = 4`) · 404 `TALK_LIVE_NOT_FOUND` · 404 `TALK_NOT_FOUND` · 409 `TALK_DEVICE_BUSY` (message `talkBusyMessage(FirstName + ' ' + LastName)`; also vendor 1004) · 409 `TALK_ALREADY_STARTING` · 409 `TALK_USER_BUSY` (`TALK_MESSAGE.USER_BUSY`; pre-check plus catching a `UX_Talk_User_Open` violation) · 502 `TALK_START_FAILED` (`TalkProviderError.userMessage`; never the middleware's raw text).
- The user's own open call on the **same** device is released before insert (reference `releaseOpenTalk`); on another device it is not (→ `TALK_USER_BUSY`).
- `maxSeconds` = `settings.getInt('streaming.talk-max-seconds')`.
- TalkIdle: `onModuleInit` starts `setInterval(() => void this.expireStaleTalks().catch(log), 30_000).unref()`; `onModuleDestroy` clears it.

- [ ] **Step 1: Port the four reference int tests** with our helpers (`bootHttpContext`, `createTestUsers` with role `OPERATOR` instead of `supervisor1`, `bearerFor`, devices by `DeviceCode`, `eventually`; `vi.spyOn(ctx.app.get(LiveStreamProvider), 'requestLive')` to open a real live session through `POST /api/streams/live`; read `"Changes"` not `"ChangesJson"`; drop company/scope and role-stream-access cases). Add:

```ts
it('middleware failure at start → 502 TALK_START_FAILED, row FAILED, next start on the device is not 409', async () => {
  vi.spyOn(provider, 'start').mockRejectedValueOnce(new TalkProviderError(TALK_MESSAGE.RTSP_FAILED, 1002));
  const first = await startTalk(owner, liveToken);
  expect(first.status).toBe(502);
  expect(first.body.code).toBe('TALK_START_FAILED');
  expect(await statusOfLastTalk(ownerId)).toBe(4);
  expect((await startTalk(owner, liveToken)).status).toBe(200);
});
it('same user, second device while a call is open → 409 TALK_USER_BUSY; after stop it works', async () => {
  const a = await startTalk(owner, liveTokenA);
  expect((await startTalk(owner, liveTokenB)).body.code).toBe('TALK_USER_BUSY');
  await stopTalk(owner, a.body.talkSessionId);
  expect((await startTalk(owner, liveTokenB)).status).toBe(200);
});
it('another user talking on the device → 409 TALK_DEVICE_BUSY naming them', async () => { /* message contains other user's FirstName */ });
it('stop works after streaming:talk is revoked (LoginOnly)', async () => { /* remove grant, stop → 200 */ });
it('VIEWER → 403 FORBIDDEN; TEAM_LEADER → 403', async () => {});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/talk` → FAIL.
- [ ] **Step 3: Implement** service, DTO, controller, module (`imports: [TalkProviderModule]`, exports `TalkService`), register in `AppModule`.
- [ ] **Step 4: Run** the Step 2 command → PASS; `npx vitest run --config vitest.integration.config.ts src/common/auth` (route-guard coverage) → PASS; typecheck clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 5: WS relay `/api/talk/ws`

**Files:**
- Create: `server/src/modules/talk/talk-relay.ts`
- Modify: `server/src/modules/talk/talk.module.ts` (provide `TalkRelay` and `TALK_RELAY_OPTIONS` = `{ revalidateMs: TALK_REVALIDATE_MS }`)
- Test: `server/src/modules/talk/talk-relay.int-test.ts` (port reference)

**Interfaces:**
- Consumes: `TalkService.consumeTicket / revalidate / hangUp`, `TALK_PROVIDER.openAudio`, Task 2 frame and close-code helpers, `HttpAdapterHost`.
- Produces: `TalkRelay` (`OnApplicationBootstrap` attaches `'upgrade'` on the HTTP server only for `isTalkWsRequest(req.url)`; no-op without an HTTP adapter), `TALK_RELAY_OPTIONS`, `TalkRelayOptions { revalidateMs: number }`.

Behavior = reference `talk-relay.ts` unchanged: consume ticket → answer 101 within 1 s (engine.io default `destroyUpgrade` 1 000 ms is active in our `RedisIoAdapter`) → bad ticket = upgrade then close 4401 → open upstream → pipe frames with `UplinkFrameGuard` → revalidate every `revalidateMs` → close-code mapping both ways → `hangUp` + audit `STOP_TALK` with `{ closeCode, closedBy }` when Nest closes the call itself.

- [ ] **Step 1: Port the reference relay int test** (listen with `ctx.app.getHttpServer().listen(0)`, mock driver echo, `TALK_RELAY_OPTIONS.revalidateMs` lowered in the test). Add:

```ts
it('browser socket terminated mid-call → row ENDED/DISCONNECTED, provider.stop called, new start on same device → 200', async () => {
  const call = await openCall(owner);
  call.ws.terminate();
  await eventually(async () => (await rowOf(call.id)).Status === 3);
  expect((await rowOf(call.id)).EndReason).toBe(6);
  expect(stopSpy).toHaveBeenCalled();
  expect((await startTalk(owner, liveToken)).status).toBe(200);
});
it('live session stopped → WS closed by the next revalidate with 4006 and row ENDED/POLICY_DISABLED', async () => {});
it('/socket.io upgrades still reach Socket.IO (relay ignores other paths)', async () => {});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/talk/talk-relay.int-test.ts` → FAIL.
- [ ] **Step 3: Implement** `talk-relay.ts` by copying the reference and fixing imports; register in the module.
- [ ] **Step 4: Run** Step 2 command → PASS; full `npm run test:int` → PASS (realtime tests still green).
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 6: Live view needs only `streaming:view-live`

**Files:**
- Modify: `server/src/modules/streaming/streaming.controller.ts:18-31` (three `@RequirePermission('streaming:view-live')`)
- Modify: `server/src/modules/streaming/streaming.service.ts:45-53` (`currentAccess` returns `grants.includes('streaming:view-live')`; keep the `TEAM_LEADER` refusal; update the 403 message to `'ไม่มีสิทธิ์ดูภาพสด'`)
- Test: `server/src/modules/streaming/streaming.int-test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Add the test**

```ts
it('a role with streaming:view-live but without streaming:live-wall can start, list and stop a live view', async () => {
  // delete OPERATOR's RolePermissions row for streaming:live-wall (restore in finally; invalidate PermissionCheckService cache if it has one)
  const res = await http.post('/api/streams/live').set('Authorization', owner).send({ deviceCode: CODE });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/streaming` → new test FAILS (403).
- [ ] **Step 3: Implement** the two edits.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 7: Client talk feature

**Files:**
- Create: `client/src/features/talk/` — `talk.api.ts`, `talkRules.ts`, `useTalkSession.ts`, `TalkControl.tsx`, `TalkWaveform.tsx`, `waveformLevels.ts`, `audio/{capture.worklet,playback.worklet,resampler,jitterBuffer,pcm,downlink,talkAudio,workletProtocol}.ts` + every reference test beside them
- Create: `client/src/test/talkFakes.ts`, `client/src/test/workletScope.ts` (copy; make `talkFakes` use `@/test/deferred`)
- Create: `client/src/i18n/locales/th/talk.ts`, `client/src/i18n/locales/en/talk.ts` (reference `talk.*` keys, ref `th.ts:950-983`); register in `th/index.ts` / `en/index.ts`
- Modify: `client/src/i18n/locales/parity.test.ts:21` (add `talk` to the allowed prefixes)
- Modify: `client/vite.config.ts:34-37` (add `'/api/talk/ws': { target: 'http://localhost:3000', ws: true, changeOrigin: true }` **before** `'/api'`)

**Interfaces:**
- Consumes: `api` (`@/lib/apiClient`, per-request `timeout: 30_000` on start), `backendMessage(error)` / `apiErrorOf(error, t)` (`@/lib/apiError`), `useAuthStore`, `API_BASE`.
- Produces: `talkApi.start(streamSessionToken: string)` (body `{ streamSessionToken }`), `talkApi.stop(talkSessionId: string)`, `talkWsUrlFor(wsUrl: string, apiBase?: string)` (origin of `VITE_API_BASE` when it is a full URL, else the page origin; `https→wss`), `useTalkSession(streamSessionToken: string | null): TalkSession` (reference shape: `state`, `start()`, `stop()`, notice, timers), `isTalkBusy(state)`, `TalkControl({ talk, blocker })`, `talkBlockerOf({ canTalk, supported, liveReady, targetMissing? })`, `browserSupportsTalk(window)`, `TALK_PERMISSION = 'streaming:talk'`.

Adaptations: error text from `backendMessage` (our `{ code, message }`); on 409 `TALK_DEVICE_BUSY` / `TALK_USER_BUSY` show the server message and return to the idle state so the button can be pressed again (spec §5.4); i18n strings from the new `talk` namespace, no data-source wording.

- [ ] **Step 1: Copy the reference tests**; add to `useTalkSession.test.tsx`:

```ts
it('unmount while start is pending → stops that call when start resolves and never opens a WebSocket', async () => {
  const start = deferred<StartTalkResult>();
  talkApi.start = vi.fn(() => start.promise);
  const { result, unmount } = renderHook(() => useTalkSession('tok'));
  act(() => void result.current.start());
  unmount();
  start.resolve(START_RESULT);
  await waitFor(() => expect(talkApi.stop).toHaveBeenCalledWith(START_RESULT.talkSessionId));
  expect(fakeWebSocketCount()).toBe(0);
});
it('microphone denied → notice talk.mic.denied (reference key) and no open server call', async () => {});
it('409 TALK_DEVICE_BUSY → shows the server message and state returns to idle', async () => {});
```

- [ ] **Step 2: Run** (in `client/`) `npx vitest run src/features/talk src/i18n` → FAIL.
- [ ] **Step 3: Copy the reference sources and adapt** per the list above.
- [ ] **Step 4: Run** Step 2 command → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 8: `LiveStreamDialog` + ดูสด on the map camera card

**Files:**
- Create: `client/src/features/streaming/components/LiveStreamDialog.tsx` (+ `.test.tsx`, port reference minus playback)
- Modify: `client/src/features/tracking/components/CameraCard.tsx` (button ดูสด next to ประวัติเส้นทาง; new prop `onWatch?: () => void`)
- Modify: `client/src/features/tracking/components/CameraListPanel.tsx`, `client/src/features/tracking/LiveMapPage.tsx` (state `watching: LiveDevice | null`, render `LiveStreamDialog`)
- Modify: i18n `streaming.ts` (th/en) and `tracking` keys for the button
- Test: `client/src/features/tracking/components/CameraCard.test.tsx` (new), `LiveStreamDialog.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`useTalkSession`, `TalkControl`, `talkBlockerOf`, `browserSupportsTalk`, `TALK_PERMISSION`), `StreamPlayer({ device, onSessionChange, forceMuted })`, `LiveTarget`, `normalizedDeviceName` (`@/lib/deviceName`), `usePermission`.
- Produces: `LiveStreamDialog({ device: LiveTarget; onClose: () => void })` — used by Tasks 8 and 9.

Dialog: title = device name or code, secondary line = code; `StreamPlayer` with `forceMuted={talk.state === 'active'}`; footer left `TalkControl` only when the user has `streaming:talk`, right "ปิด"; closing = `onClose` (unmount stops talk and live). Button ดูสด shows only when `device.platformState === 'online'` and `usePermission('streaming:view-live')`.

- [ ] **Step 1: Write tests**: CameraCard — button shown for online + view-live; hidden for `offline`, `unknown`, or without permission; click calls `onWatch`. LiveStreamDialog (port) — talk control hidden without `streaming:talk`; close button calls `onClose`; video forced muted while talk is active. LiveMapPage — clicking ดูสด opens the dialog with that camera's code (mock `StreamPlayer`).
- [ ] **Step 2: Run** `npx vitest run src/features/tracking src/features/streaming` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command → PASS; typecheck + lint clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 9: ดูสด on work-order list and detail

**Files:**
- Modify: `client/src/features/work-orders/WorkOrderCameraList.tsx` (owns `watching: WorkOrderCamera | null`; renders `LiveStreamDialog`)
- Modify: i18n `workOrders.ts` (th/en) — button label / aria `ดูสด {camera}`
- Test: `client/src/features/work-orders/WorkOrderCameraList.test.tsx` (new or extend)

**Interfaces:**
- Consumes: `LiveStreamDialog` (Task 8), `WorkOrderCamera` (`deviceId`, `deviceCode`, `name`, `platformState`), `usePermission`.
- Produces: nothing new.

Rules: button per camera when `deviceId && deviceCode && platformState === 'online'` and the user has `streaming:view-live`; compact list = icon `ToolButton` (aria-label with the camera code), detailed list = small button beside the status badge. The click must not trigger the row's own handlers (`event.stopPropagation()`). Opening from inside the work-order detail dialog is a nested Radix dialog — focus returns to the button on close.

- [ ] **Step 1: Write tests**: shown for online + permission (both variants); hidden for offline / unknown / no `deviceId` / no permission; click opens `LiveStreamDialog` with `deviceCode` (mock `StreamPlayer`) and does not call a parent `onClick`.
- [ ] **Step 2: Run** `npx vitest run src/features/work-orders` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command → PASS; typecheck + lint clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 10: Talk panel on the live wall

**Files:**
- Modify: `client/src/features/streaming/LiveWallPage.tsx` (replace `talking={false} muteAll={false}` and the `noSessionChange` stub)
- Modify: i18n `streaming.ts` if a key is missing (`liveWall.talk.title/target/noTarget`, `liveWall.talking` exist)
- Test: `client/src/features/streaming/LiveWallPage.test.tsx` (port `describe('LiveWallPage — คุยผ่านกล้อง')`)

**Interfaces:**
- Consumes: Task 7 hook/control/rules; `LiveWallTile` props `talking`, `muteAll`, `onLiveSessionChange(deviceCode, session | null)`; `devices.data` (`WallDevice[]` with `deviceCode`, `name`).
- Produces: nothing new.

Port the reference wiring (ref `LiveWallPage.tsx` ~145–222, ~339–340): `liveByCode` map from `onLiveSessionChange`; `selectedCode = slots[selectedIndex]`; call lock `callToken` / `callCode` so a call stays on its tile when the selection moves; `talk = useTalkSession(talkToken)`; `talkBusy = isTalkBusy(talk.state)`; tile `talking = talkBusy && code === callCode`, `muteAll = talkBusy`; panel (`data-slot="live-wall-talk"`: title, target line "จอ n · ชื่อกล้อง" or no-target, `TalkControl`) rendered at the end of the `<aside>` (our `LiveWallCameraList` has no `children` prop). Skip the reference's slot ids and `device:status` subscription.

- [ ] **Step 1: Port the three reference talk tests** (selection moves during a call → call stays on the original tile; closing the talking tile → hook gets `null` and hangs up; panel shows the selected tile's camera).
- [ ] **Step 2: Run** `npx vitest run src/features/streaming` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command → PASS; `npm test`, `npm run build` → PASS.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 11: Docs

**Files:**
- Modify: `docs/blueprint/02-system-architecture.md` (TalkIdle runs in `api` every 30 s, not worker `media`)
- Modify: `docs/blueprint/04-database-design.md` (`TalkSessions` created in `0014` + `UX_Talk_User_Open`)
- Modify: `docs/blueprint/05-api-design.md` (`/talk/sessions/:id/stop` `LoginOnly`, error codes §5.4 of the spec, `/streams/*` need `streaming:view-live` only)
- Modify: `docs/blueprint/06-frontend-architecture.md` (ดูสด on map card and work-order list/detail)
- Modify: `docs/blueprint/08-implementation-roadmap.md` (P4 progress)
- Modify: `docs/blueprint/09-risks-open-questions.md` (add **DL86 (Q62)** — the three user decisions of spec §1; amend **DL62 (3)**: busy camera is reported after pressing, button stays pressable)
- Modify: `docs/blueprint/README.md` if a summary line changes; `docs/runbooks/local-dev.md` (talk test on dev: VPN + `DSS_DRIVER=dss`, headphones, ~11 s connect); `CLAUDE.md` (P4 state: live wall + talk + dialogs, migration `0014_p4_talk`)

- [ ] **Step 1: Edit** each file in Thai (CLAUDE.md in English), using Part 4 names.
- [ ] **Step 2: Verify** `grep -n "DL86" docs/blueprint/*.md` shows the entry; every edited Mermaid block still parses (none expected).
- [ ] **Step 3: Commit** — leave uncommitted.

---

## Final verification (after Task 11)

- `server/`: `npm run ci` → lint + typecheck + unit + integration all PASS.
- `client/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` → PASS.
- Live check with `DSS_DRIVER=dss` over VPN, camera `1000027`: start a live view, `POST /api/talk/sessions` answers in ~11 s, WS opens, downlink frames arrive; then the user checks by ear from all three entry points and that closing the dialog ends the call (spec §7).
