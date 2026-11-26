# P4 Evidence Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The วิดีโอย้อนหลัง page `/evidence`: pick a camera + a day (last 30 days), list every recorded segment from DSS, and play any part of it back (≤ 24 h per view).

**Architecture:** `GET /api/streams/recordings` asks the DSS middleware `/recording/search` live on every search (no cache table) and filters to the requested window; `POST /api/streams/playback` opens a `StreamingSessions` row with `SessionType = 2` and reuses the live HLS proxy, quota, idle expiry and audit. The client page reuses `StreamPlayer`'s existing `playback` mode plus ports of the reference `RecordingSegmentsPanel` and `evidenceRange`.

**Tech Stack:** NestJS + Drizzle + PostgreSQL, Vitest; React 18 + TanStack Query + react-router, hls.js (inside `StreamPlayer`).

**Spec:** `docs/superpowers/specs/2026-11-26-p4-evidence-playback-design.md` (read it first; §-numbers below refer to it).
**Reference (read-only):** `C:\Git\Internal-BodyCam` — server `modules/streaming/{playback.service.ts, playback-range.ts, recording-merge.ts, dto/playback.dto.ts, provider/dss-stream.provider.ts}`; client `features/evidence/{components/RecordingSegmentsPanel.tsx, components/EvidencePlaybackDialog.tsx, evidenceRange.ts}`. Middleware: `C:\Git\psd-bwc-dss-services` `app/api/routes/{recording.py, playback.py}`.

## Global Constraints

- **No git writes** (user commits): never `git add` / `commit` / `stash` / `reset` / `checkout`. "Commit" steps = leave changes in the working tree.
- Never modify `C:\Git\Internal-BodyCam`, `C:\Git\psd-bwc-dss-services` or any other repo.
- `RECORDING_MAX_DAYS_BACK = 30` (one constant, server and client); a day is selectable from today back to 29 days before today (Bangkok); the earliest allowed `from` = 00:00 Asia/Bangkok of that day.
- `PLAYBACK_MAX_RANGE_HOURS = 24`; future allowance `FUTURE_SKEW_MS = 5 * 60_000`.
- Channel is always 1; DSS `channelId` = `` `${VendorDeviceId}$1$0$0` ``.
- Middleware auth = `dssAuthorizationHeader(config.apiKey)` from `server/src/common/dss/dss-auth.ts`; base = `readDssConfig(process.env).baseUrl`; recording search `${baseUrl}/api/v1/recording/search`, playback `${baseUrl}/api/v1/playback`. No new env vars.
- Errors: `AppException(status, code, message)` → 400 `INVALID_RANGE` · 404 `DEVICE_NOT_FOUND` · 404 `RECORDING_NOT_FOUND` ("ไม่พบไฟล์บันทึกในช่วงเวลานี้") · 403 `STREAMING_DISABLED` · 403 `DEVICE_STREAM_DISABLED` · 429 `STREAM_QUOTA_EXCEEDED` (existing) · 502 `RECORDING_SEARCH_FAILED` · 502 `PLAYBACK_START_FAILED`. User-facing messages are Thai and never carry middleware text.
- Audit: `@Audit('SEARCH_RECORDINGS', 'Devices')` on recordings, `@Audit('START_PLAYBACK', 'StreamingSessions')` on playback.
- Permissions: both endpoints `playback:view`; media of a `SessionType 2` row needs `playback:view` only, `SessionType 1` keeps `streaming:view-live`; `TEAM_LEADER` refused for both. `/evidence` route: `playback:view` + `devices:read`.
- Retired cameras (`Devices.Status = 4`) can be searched and played back; deleted ones (`IsDeleted`) = 404. `streaming.enabled = false` or `Devices.StreamingEnabled = false` blocks playback.
- UI text Thai default + English parity; never name the data source (DL64); every segment shows "ไม่ผูกใบงาน" (`workOrder: null`) in this phase. Server log / console output English only.

## Review Focus

1. **A segment crossing midnight** (e.g. 23:30 yesterday → 00:40 today, searching today): it is listed, its row shows both dates, and clicking it plays only 00:00–00:40. Test owner: Task 4 (`clipToDay`) and Task 5.
2. **Today's still-growing segment**: today's window ends at now; a file whose end ≈ now is listed and plays. Test owner: Task 2.
3. **Switching camera / day / segment while a playback is open** closes the old session (no quota leak; `StreamPlayer` remount stops it). Test owner: Task 5.
4. **The oldest selectable day** (29 days before today): `daysBack` capped at 30 still covers its 00:00, and the day before it is refused with `INVALID_RANGE`. Test owner: Task 1 and Task 2.
5. **Middleware "no recordings" (`code 1002`)** is an empty list, not an error; on playback it is 404 `RECORDING_NOT_FOUND`. Test owner: Task 1 and Task 3.

---

### Task 1: Recording rules + DSS provider methods

**Files:**
- Create: `server/src/modules/streaming/recording-range.ts` (+ `recording-range.test.ts`)
- Create: `server/src/modules/streaming/recording-provider.ts` (+ `recording-provider.test.ts`)

**Interfaces:**
- Produces:
  - `RECORDING_MAX_DAYS_BACK = 30`, `PLAYBACK_MAX_RANGE_HOURS = 24`, `FUTURE_SKEW_MS`.
  - `earliestRecordingFrom(now: Date): Date` — 00:00 Asia/Bangkok of the day 29 days before today's Bangkok date.
  - `assertRecordingRange(from: Date, to: Date, now?: Date): void` — throws `AppException(400, 'INVALID_RANGE', <Thai>)` for NaN, `to <= from`, > 24 h, `from < earliestRecordingFrom(now)`, `from > now + FUTURE_SKEW_MS`.
  - `dssDaysBackFor(from: Date, now?: Date): number` = `min(30, ceil((now − from) / 86_400_000) + 1)`, at least 1.
  - `type RecordingFile = { startAt: Date; endAt: Date; durationSeconds: number }`.
  - `parseRecordings(payload: unknown): RecordingFile[]` — accepts `data.records` / `data.list` / `data` array; `startTime`/`endTime` as unix-seconds strings or numbers; drops invalid rows; sorted by `startAt`.
  - `@Injectable() class RecordingProvider` with
    - `search(vendorDeviceId: string, from: Date, to: Date): Promise<RecordingFile[]>` — `dss`: POST recording search `{ channelId, daysBack: dssDaysBackFor(from) }`; `code 1002` ⇒ `[]`; other non-1000 / HTTP error ⇒ throw `Error` (English, no body); keep only files overlapping `[from, to)`. `mock`: deterministic files 08:00–10:00 and 13:00–13:45 Asia/Bangkok of `from`'s Bangkok day, filtered to the window.
    - `requestPlayback(vendorDeviceId: string, startAt: Date, endAt: Date): Promise<{ vendorUrl: string; vendorSessionId: string } | 'no-recordings'>` — `dss` only (like `requestLive`): POST playback `{ deviceCode, channelId, startTime: unix seconds string, endTime }`; `1002` ⇒ `'no-recordings'`; other failure ⇒ throw; URL checked with `LiveStreamProvider.assertAllowed`.

- [ ] **Step 1: Write failing tests**
  - `recording-range.test.ts`: `earliestRecordingFrom` for a fixed `now` (e.g. `2026-11-26T09:37:00Z` ⇒ `2026-10-27T17:00:00.000Z`, i.e. 2026-10-28 00:00 Bangkok); `assertRecordingRange` rejects each case above with code `INVALID_RANGE` and accepts the oldest day's 00:00–24:00 and today 00:00–now; `dssDaysBackFor(earliestRecordingFrom(now), now) === 30` and its window start (`now − 30 days`) ≤ that `from` (Review Focus 4); `dssDaysBackFor(now − 2 h) === 2`.
  - `recording-provider.test.ts` (local HTTP server like `server/src/modules/talk/provider/dss-talk.provider.test.ts`, bearer checked with `verifyDssBearer`): search posts `channelId: 'V1$1$0$0'` and the computed `daysBack`; parses the real payload shape (records with `startTime: '1795…'` strings, extra keys); filters to the window and keeps a file overlapping the window edge; `1002` ⇒ `[]` (Review Focus 5); `5000` ⇒ throws; playback posts unix-second strings and returns the URL; `1002` ⇒ `'no-recordings'`; mock driver returns the two deterministic files.
- [ ] **Step 2: Run** `npx vitest run src/modules/streaming/recording-range.test.ts src/modules/streaming/recording-provider.test.ts` (in `server/`) → FAIL (modules missing).
- [ ] **Step 3: Implement** both files (provider registered later by Task 2's module change). Bangkok day math: UTC+7 has no DST — reuse an existing helper if `server/src/modules/tracking` or `work-orders` has one, else `Date.UTC` arithmetic.
- [ ] **Step 4: Run** the Step 2 command → PASS; `npm run typecheck`, `npm run lint` → clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 2: `GET /api/streams/recordings`

**Files:**
- Create: `server/src/modules/streaming/dto/recordings-query.dto.ts` (or beside `start-live.dto.ts` if that folder does not exist)
- Modify: `server/src/modules/streaming/streaming.controller.ts`, `streaming.service.ts`, `streaming.module.ts` (provide `RecordingProvider`)
- Test: `server/src/modules/streaming/recordings.int-test.ts`

**Interfaces:**
- Consumes: Task 1 (`assertRecordingRange`, `RecordingProvider.search`).
- Produces: `GET /api/streams/recordings?deviceId=<id>&from=<ISO>&to=<ISO>` → `{ data: Array<{ startAt: string; endAt: string; durationSeconds: number; workOrder: null }>, from: string, to: string }` sorted by `startAt`; `StreamingService.searchRecordings(user: AuthUser, query: { deviceId: string; from: string; to: string })`.

Rules (spec §5.1): `@RequirePermission('playback:view')`, `@Audit('SEARCH_RECORDINGS', 'Devices')`; device by `Id`, not deleted (retired allowed) else 404 `DEVICE_NOT_FOUND`; fresh-access check like `currentAccess` but for `playback:view`; provider error ⇒ 502 `RECORDING_SEARCH_FAILED` (log English, no payload).

- [ ] **Step 1: Write failing int tests** (pattern `server/src/modules/streaming/streaming.int-test.ts`; `DSS_DRIVER=mock` from `int-setup`):
  - OPERATOR gets the two mock files for a day window, in order, each with `workOrder: null`.
  - Today's window `00:00 → now`: a file ending at ≈ now (spy the provider to return one ending `now − 10 s`) is listed (Review Focus 2).
  - VIEWER ⇒ 403; unknown / deleted device ⇒ 404 `DEVICE_NOT_FOUND`; retired (`Status = 4`) ⇒ 200.
  - `from` one second before `earliestRecordingFrom(now)` ⇒ 400 `INVALID_RANGE`; > 24 h ⇒ 400 (Review Focus 4).
  - provider throws ⇒ 502 `RECORDING_SEARCH_FAILED`, message has no provider text.
  - an `AuditLogs` row `SEARCH_RECORDINGS` is written.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/streaming/recordings.int-test.ts` → FAIL.
- [ ] **Step 3: Implement** DTO (`deviceId` numeric string, `from`/`to` ISO strings), service method, controller route, module provider.
- [ ] **Step 4: Run** Step 2 command → PASS; `npx vitest run --config vitest.integration.config.ts src/modules/streaming src/common/auth` (route-guard coverage) → PASS.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 3: `POST /api/streams/playback` + session type rules

**Files:**
- Create: `server/src/modules/streaming/start-playback.dto.ts`
- Modify: `server/src/modules/streaming/streaming.service.ts` (`startPlayback`, `currentAccess`, `mySessions`), `streaming.controller.ts`
- Test: `server/src/modules/streaming/playback.int-test.ts`; extend `streaming.int-test.ts` only if a live assertion changes

**Interfaces:**
- Consumes: Task 1 (`assertRecordingRange`, `RecordingProvider.requestPlayback`).
- Produces: `POST /api/streams/playback` body `{ deviceCode: string; startAt: string; endAt: string; channel?: 1 }` → same shape as `/streams/live` (`{ sessionToken, protocol: 1, device, channel, playbackUrl, idleTimeoutSeconds }`); `GET /streams/sessions` rows gain `sessionType: 1 | 2`.

Rules (spec §5.2): `@RequirePermission('playback:view')`, `@Audit('START_PLAYBACK', 'StreamingSessions')`; `streaming.enabled` ⇒ 403 `STREAMING_DISABLED`; device by `DeviceCode`, not deleted else 404; `StreamingEnabled = false` ⇒ 403 `DEVICE_STREAM_DISABLED`; retired allowed; same per-user advisory lock + quota as `startLive` (counts live + playback); row `SessionType = 2`, `PlaybackStartAt`, `PlaybackEndAt`; provider call outside the transaction; `'no-recordings'` ⇒ row FAILED + 404 `RECORDING_NOT_FOUND`; throw ⇒ row FAILED + 502 `PLAYBACK_START_FAILED`. `currentAccess(userId, sessionType)` ⇒ grants include `playback:view` for 2, `streaming:view-live` for 1; `TEAM_LEADER` false. `media()` passes the row's `SessionType`.

- [ ] **Step 1: Write failing int tests** (spy `RecordingProvider.requestPlayback` to return `{ vendorUrl: 'http://<DSS host>/x.m3u8', vendorSessionId: 'V$1$0$0' }`):
  - OPERATOR starts playback ⇒ 200 + row `SessionType 2`, `PlaybackStartAt/EndAt` equal the request, Status 2; `GET /streams/sessions` shows `sessionType: 2`.
  - range > 24 h / older than 30 days / in the future ⇒ 400 `INVALID_RANGE`.
  - `'no-recordings'` ⇒ 404 `RECORDING_NOT_FOUND` and row Status 4 (Review Focus 5); provider throws ⇒ 502 `PLAYBACK_START_FAILED`, row Status 4.
  - retired camera ⇒ 200; `StreamingEnabled = false` ⇒ 403; `streaming.enabled = false` ⇒ 403 (restore setting + `SettingsService.invalidate`).
  - quota: with `streaming.max-concurrent-per-user = 1` and one open live row, playback ⇒ 429.
  - media of a playback row works for a role with `playback:view` but without `streaming:view-live` (remove the grant in the test, restore in `finally`), and a live row for that role is refused.
  - VIEWER ⇒ 403; stop via `/streams/:token/stop` ends the playback row.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/streaming/playback.int-test.ts` → FAIL.
- [ ] **Step 3: Implement** DTO, `startPlayback`, `currentAccess` by type, `sessionType` in `mySessions`, controller route.
- [ ] **Step 4: Run** `npx vitest run --config vitest.integration.config.ts src/modules/streaming src/modules/talk` → PASS (talk still opens on live rows only); typecheck + lint clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 4: Client API, range helpers, i18n

**Files:**
- Modify: `client/src/features/streaming/streaming.api.ts` (add `recordings`; `StreamSessionRow.sessionType`)
- Create: `client/src/features/evidence/evidenceRange.ts` (+ `.test.ts`) — adapted from the reference file
- Create: `client/src/i18n/locales/th/evidence.ts`, `client/src/i18n/locales/en/evidence.ts`; register in both `index.ts`; add `evidence` to the key-prefix regex in `client/src/i18n/locales/parity.test.ts`

**Interfaces:**
- Produces:
  - `type RecordingFile = { startAt: string; endAt: string; durationSeconds: number; workOrder: { id: string; workOrderNo: string } | null }`.
  - `streamingApi.recordings(query: { deviceId: string; from: string; to: string }): Promise<{ data: RecordingFile[]; from: string; to: string }>`.
  - `RECORDING_MAX_DAYS_BACK = 30`, `PLAYBACK_MAX_RANGE_HOURS = 24`.
  - `selectableDays(now?: Date): string[]` — Bangkok `YYYY-MM-DD`, today first, 30 entries.
  - `dayRange(dateYmd: string, now?: Date): { from: string; to: string }` — 00:00–24:00 Bangkok, `to` capped at now for today (reuse `dayWindowOf` / `bangkokDateOf` from `client/src/features/tracking-history/historyRange.ts`).
  - `clipToDay(file: { startAt: string; endAt: string }, day: { from: string; to: string }): { startAt: string; endAt: string }`.
  - `type EvidenceRange = { from: string; to: string }` (local `datetime-local` values with seconds), `toLocalInputSeconds(at: Date)`, `toIso(local)`, `validateEvidenceRange(range): TranslationKey | null` (empty, reversed, > 24 h), `formatDuration(seconds)` — as in the reference.
  - i18n `evidence.*` keys for every string Task 5 shows (title, description with 30 days, camera, day, search, segments title/count, no-segments, unlinked "ไม่ผูกใบงาน", range from/to, play, errors).

- [ ] **Step 1: Write failing tests** — `evidenceRange.test.ts`: `selectableDays` length 30, first = today Bangkok; `dayRange(today)` ends at now, past day ends 24:00; `clipToDay` of 23:30 yesterday → 00:40 today = today 00:00 → 00:40 (Review Focus 1), a file inside the day unchanged; `validateEvidenceRange` keys for reversed / > 24 h / empty. `streaming.api` test (if the file has one) for the recordings query params.
- [ ] **Step 2: Run** (in `client/`) `npx vitest run src/features/evidence src/i18n` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command → PASS; typecheck + lint clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 5: Page `/evidence`

**Files:**
- Create: `client/src/features/evidence/EvidencePage.tsx` (+ `.test.tsx`), `client/src/features/evidence/components/RecordingSegmentsPanel.tsx` (adapted from the reference: list of the chosen day's segments, no days-back input)
- Modify: `client/src/app/router.tsx` (`guardedLazy('evidence', …)`), `client/src/app/routeAccess.ts` (`evidence: { anyOf: ['playback:view'], allOf: ['devices:read'] }` + doc comment), `client/src/app/nav.ts` (`navigation.playback` gets `to: '/evidence'`, `allPermissions: ['devices:read']`), their tests
- Modify (only if it maps session rows to tiles): `client/src/features/streaming/LiveWallPage.tsx` — use rows with `sessionType === 1`

**Interfaces:**
- Consumes: Task 4 (`streamingApi.recordings`, `streamingApi.devices`, range helpers, i18n), `StreamPlayer({ device, playback: { startAt, endAt } })`.
- Produces: nothing new.

Layout (spec §6 sketch): header (title + description) · toolbar: camera picker (all cameras from `streamingApi.devices`, searchable by code / name, retired included) + day select (`selectableDays`) + ค้นหา · grid `lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]`: player + range row (เริ่ม / สิ้นสุด `datetime-local` step 1 s, ดูย้อนหลัง) on the left, `RecordingSegmentsPanel` on the right (stacked on narrow screens). URL state `?deviceId&date`. Search runs on ค้นหา or when camera/day change (never while typing). Clicking a segment sets the range to `clipToDay(file, dayRange(date))` and starts playback at once; ดูย้อนหลัง replays the edited range. Player keyed by `deviceCode + startAt + endAt` so a change remounts it (old session stopped by `StreamPlayer` unmount). No talk.

- [ ] **Step 1: Write failing tests** (mock `StreamPlayer` to render its `device.deviceCode` + `playback` props; mock `streamingApi`):
  - with `?deviceId=1&date=<today>` the page searches once and lists segments with "ไม่ผูกใบงาน"; no segments ⇒ empty state; error ⇒ message + retry.
  - clicking a segment renders the player with the clipped range (midnight case, Review Focus 1).
  - editing the range to > 24 h or reversed disables ดูย้อนหลัง and shows the message.
  - changing camera or day unmounts the previous player (Review Focus 3) and searches again; the URL follows.
  - a playback the server closed (idle after a long pause, spec §5.2) offers a way to play the same range again (use `StreamPlayer`'s existing ended/retry state if it already does this; otherwise a ดูย้อนหลัง press with an unchanged range remounts the player).
  - nav: วิดีโอย้อนหลัง is enabled with `playback:view` + `devices:read`, hidden/disabled otherwise; route guard matches.
- [ ] **Step 2: Run** `npx vitest run src/features/evidence src/app src/features/streaming` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command → PASS; `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 6: Docs

**Files:** `docs/blueprint/09-risks-open-questions.md` (new **DL87 (Q63)** row: spec §1 decisions; amend DL59 item (1) 3 months ⇒ 30 days "(แก้โดย DL87)"), `05-api-design.md` (recordings / playback details, error codes, `sessionType` on `/streams/sessions`), `06-frontend-architecture.md` (evidence screen: 30 days, click plays, live search), `02-system-architecture.md` (§evidence: live DSS search, `RecordingSegments` + recording index in P2), `04-database-design.md` (`RecordingSegments` not created yet), `08-implementation-roadmap.md` (P4 status), `README.md` if a summary line changes, `docs/runbooks/local-dev.md` (test วิดีโอย้อนหลัง on dev over VPN), `CLAUDE.md` (P4 state line, English).

- [ ] **Step 1: Edit** in Thai (CLAUDE.md English), Part 4 names, apply each change to every Part that mentions it.
- [ ] **Step 2: Verify** `grep -n "DL87" docs/blueprint/*.md` shows the row and references; no Mermaid edited.
- [ ] **Step 3: Commit** — leave uncommitted.

---

## Final verification

- `server/`: `npm run ci` → PASS. `client/`: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` → PASS.
- Live check (`DSS_DRIVER=dss`, VPN): camera `1000027`, day 2026-11-25 lists its segments; clicking one plays back in the browser; closing / switching stops the session.
