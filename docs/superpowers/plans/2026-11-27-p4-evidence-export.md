# P4 Evidence Export (MP4 download) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "ดาวน์โหลด MP4" button on `/evidence`: the server queues an export, the `media` worker turns the DSS recording into an MP4 with ffmpeg on shared local disk, the page shows progress and downloads the file through a short ticket; files expire after 24 h.

**Architecture:** `EvidenceExports` rows + BullMQ queue `evidence-export` (producer in `api`, worker in role `media`). The processor is a port of the reference: claim row → one `RecordingProvider.requestPlayback` → fetch playlist + segments itself (allowed hosts only, per-segment progress) → `ffmpeg -c copy` remux → SHA-256 → `.part` + atomic rename under `STORAGE_LOCAL_DIR/evidence/` → Ready. A 60 s timer job purges expired files.

**Tech Stack:** NestJS + Drizzle + PostgreSQL, BullMQ 5.81.5 / ioredis 5.11.1 (already used by P3a), ffmpeg (external binary), Vitest; React 18 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-27-p4-evidence-export-design.md` (read it first; §-numbers refer to it).
**Reference (read-only):** `C:\Git\Internal-BodyCam\server\src\modules\streaming\evidence-export\*` (rules, service, controller, processor, worker, worker module, evidence-media, hls-playlist + tests), `server\src\common\queue\evidence-export-queue.service.ts`, `server\src\common\rate-limit\rate-limit-specs.ts`; client `features\evidence\{evidenceExports.api.ts, evidenceDownload.ts, useEvidenceDownload.ts}` + the download part of `components\EvidencePlaybackDialog.tsx`.

## Global Constraints

- **No git writes** (user commits); never modify `C:\Git\Internal-BodyCam` or `C:\Git\psd-bwc-dss-services`.
- `EVIDENCE_EXPORT_STATUS`: 1 Queued · 2 Processing · 3 Ready · 4 Failed · 5 Expired (frozen DB values). Setting `streaming.download-max-minutes` default 120, bounds 5–1440. Ready files expire 24 h after `CompletedAt`.
- Permissions: policy / request / status = `evidence:export`; download-ticket = `evidence:download`; download = Public with ticket (60 s, bound to exportId + userId, reusable within 60 s; open re-checks the user is active and still has `evidence:download`). `TEAM_LEADER` has neither. Audit `REQUEST_EVIDENCE_EXPORT` (POST) and `DOWNLOAD_EVIDENCE_EXPORT` (ticket), resource `EvidenceExports`; the status GET is not audited.
- Range: `end > start`, ≤ setting minutes, not in the future (> 5 min), `start` ≥ `earliestRecordingFrom(now)` (`server/src/modules/streaming/recording-range.ts`) ⇒ 400 `INVALID_RANGE` (Thai text naming the minute cap). Deleted camera ⇒ 404 `DEVICE_NOT_FOUND`; retired allowed; `StreamingEnabled = false` ⇒ 403 `DEVICE_STREAM_DISABLED`; `streaming.enabled = false` ⇒ 403 `STREAMING_DISABLED` (text "ระบบปิดการดูวิดีโอไว้").
- Reuse: same device + channel + exact start/end that is Queued / Processing / Ready-unexpired ⇒ return that row (any requester); Failed / Expired never reused.
- Storage: `STORAGE_DRIVER=local` only, root `STORAGE_LOCAL_DIR`; rows store paths relative to the root; files under `evidence/`. ffmpeg from `FFMPEG_PATH` if set, else `ffmpeg` on PATH. Queue concurrency `EVIDENCE_EXPORT_CONCURRENCY` (default 1, max 8), timeout `EVIDENCE_EXPORT_TIMEOUT_MINUTES` (default 180). BullMQ job id `evidence-export-{Id}`.
- File name ASCII `evidence_{deviceCode}_{YYYYMMDD-HHmmss Bangkok}.mp4`. Channel always 1. `WorkOrderId` stays null.
- Server log English; user-facing text Thai, never middleware text, never naming the data source in UI copy.

## Review Focus

1. **Same range requested twice at once** (double click, two operators) ⇒ one row and one job, both callers get the same id. Test owner: Task 2.
2. **Worker restarted mid-job** ⇒ Queued rows are re-enqueued; a Processing row older than the timeout becomes Failed with a Thai message; nothing stays "กำลังแปลง" forever. Test owner: Task 3.
3. **Download after expiry / purge** ⇒ ticket request 404 with a Thai message and the page offers to export again. Test owner: Task 2 and Task 4.
4. **Range above the cap** ⇒ the button is disabled with the cap in the message, and the server answers 400 if called anyway. Test owner: Task 2 and Task 4.
5. **A failed export** (e.g. no recordings in range) ⇒ the page shows the reason and "ลองอีกครั้ง" creates a new job (Failed rows are not reused). Test owner: Task 2 and Task 4.

---

### Task 1: Table, setting, rules, ticket

**Files:**
- Modify: `server/src/db/schema.ts` (`EvidenceExports`), `server/src/common/settings/setting-spec.ts` (+ test), `server/src/test/int-helpers.ts` (`dropTestUsers` / `resetDevices` delete `EvidenceExports` rows first)
- Create: `server/drizzle/0015_p4_evidence_exports.sql` (generated + appended Settings insert), `server/src/modules/evidence-export/evidence-export-rules.ts` (+ `.test.ts`), `server/src/modules/evidence-export/download-ticket.ts` (+ `.test.ts`), `server/src/modules/evidence-export/evidence-exports-schema.int-test.ts`

**Interfaces:**
- Produces: `EvidenceExports` (columns + indexes of spec §4.1 / reference schema); `EVIDENCE_EXPORT_STATUS`; `assertExportRange(startAt: Date, endAt: Date, maxMinutes: number, now?: Date): void`; `isReusableExport(row: { Status: number; ExpiresAt: Date | null }, now?: Date): boolean`; `exportFileName(input: { deviceCode: string; startAt: Date }): string`; `segmentProgress(done: number, total: number): number` (≤ 95); `EXPORT_TTL_MS = 24 * 3_600_000`; `sealDownloadTicket(payload: { exportId: bigint; userId: bigint }, key: Buffer, now?: Date): string`, `openDownloadTicket(ticket: string, key: Buffer, now?: Date): { exportId: bigint; userId: bigint } | null` (60 s validity; key = `streamUrlKey()` from `server/src/modules/streaming/url-seal.ts`).

- [ ] **Step 1: Write failing tests** — rules: cap from the argument (121 min with cap 120 ⇒ `INVALID_RANGE` and the message contains "120"), reversed/NaN, future > 5 min, start before `earliestRecordingFrom`; `isReusableExport` for each status (Ready expired ⇒ false, Failed ⇒ false); `exportFileName({ deviceCode: '1000027', startAt: new Date('2026-11-25T10:06:30Z') }) === 'evidence_1000027_20261125-170630.mp4'` (Bangkok); `segmentProgress(5, 10) === 47`, `(10,10) === 95`, `(0,0) === 0`. Ticket: round trip; tampered ⇒ null; after 61 s ⇒ null. Setting defaults 120 / bounds {5,1440}. Schema int test: defaults (Status 1, Progress 0), FK to a missing device fails.
- [ ] **Step 2: Run** `npx vitest run src/modules/evidence-export src/common/settings` and the schema int test → FAIL.
- [ ] **Step 3: Implement**; `npm run db:generate -- --name=p4_evidence_exports`, append `INSERT INTO "Settings" … ('streaming.download-max-minutes', '120', 2, 'streaming', 'ดาวน์โหลด MP4 ได้ครั้งละไม่เกิน (นาที)') ON CONFLICT ("SettingKey") DO NOTHING;`; `npm run db:migrate`; `npm run db:prepare:test`.
- [ ] **Step 4: Run** Step 2 commands + `npx vitest run --config vitest.integration.config.ts src/db` → PASS; typecheck + lint clean.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 2: Queue producer, storage, API

**Files:**
- Modify: `server/src/common/queue/queue.constants.ts` (`EVIDENCE_EXPORT = 'evidence-export'`, `EvidenceExportJob = { exportId: string }`), `server/src/common/queue/queue.module.ts` (provider `EVIDENCE_EXPORT_QUEUE`), `server/src/common/rate-limit/rate-limit-specs.ts` (`'evidence-export'`: `EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR` default as reference, window 3600 s; `'evidence-download'`: `EVIDENCE_DOWNLOAD_RATE_LIMIT_PER_MIN` default as reference, window 60 s), `server/src/app.module.ts`, `server/.env.example` (commented `FFMPEG_PATH`, the two rate-limit vars if missing)
- Create: `server/src/modules/evidence-export/{evidence-storage.ts, evidence-export.service.ts, evidence-export.controller.ts, evidence-export.module.ts, dto/request-export.dto.ts}`, tests `evidence-storage.test.ts`, `evidence-export.int-test.ts`, `evidence-export-http.int-test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `evidenceStorage(env?)` → `{ root: string; absolute(relative: string): string; evidenceDir(): string }` (rejects paths escaping the root).
  - `EvidenceExportService`: `policy(): Promise<{ maxMinutes: number }>`, `request(user: AuthUser, input: { deviceCode: string; startAt: string; endAt: string; channel?: 1 }): Promise<EvidenceExportView>`, `get(user: AuthUser, id: bigint): Promise<EvidenceExportView>`, `issueTicket(user: AuthUser, id: bigint): Promise<{ url: string; fileName: string }>`, `openDownload(ticket: string): Promise<{ absolutePath: string; fileName: string; size: number }>`; `EvidenceExportView = { id: string; status: number; progress: number; fileName: string | null; fileSizeBytes: string | null; startAt: string; endAt: string; expiresAt: string | null; errorMessage: string | null }`.
  - Routes `/api/evidence-exports/policy|(POST)|:id|:id/download-ticket|download` with the permissions/audit/rate limits of Global Constraints; `download` sets `Content-Type: video/mp4`, `Content-Disposition: attachment; filename="…"`, supports `Range` (use `res.sendFile` or a ranged stream).

Rules: `request` holds a transaction-scoped advisory lock keyed on `device:channel:start:end` around "find reusable or insert Queued", enqueues after commit with job id `evidence-export-{Id}` (adding an existing id is a no-op); expired Ready rows are not reused. `issueTicket` only for Ready + not expired + file exists ⇒ else 404 `EXPORT_NOT_READY` / `EXPORT_EXPIRED` (Thai). Unknown id ⇒ 404 `EXPORT_NOT_FOUND`.

- [ ] **Step 1: Write failing int tests** (spy/replace the queue's `add`; temp `STORAGE_LOCAL_DIR` per test file):
  - POST creates Queued row + one job `evidence-export-{id}`; repeat with the same range ⇒ same id, still one job; **two parallel POSTs ⇒ same id** (Review Focus 1).
  - Ready-unexpired reused; Ready-expired and Failed ⇒ new row (Review Focus 5).
  - 121 min ⇒ 400 `INVALID_RANGE` (Review Focus 4); deleted camera 404; retired OK; StreamingEnabled false 403; VIEWER 403; TEAM_LEADER 403; audit row `REQUEST_EVIDENCE_EXPORT`.
  - ticket: role with `evidence:export` but not `evidence:download` ⇒ 403; Ready row with a real file in temp storage ⇒ ticket ⇒ GET download 200 with `video/mp4`, attachment name, body bytes equal the file, `Range: bytes=0-9` ⇒ 206; ticket after 61 s ⇒ 404; expired row / missing file ⇒ 404 Thai (Review Focus 3); audit `DOWNLOAD_EVIDENCE_EXPORT`.
- [ ] **Step 2: Run** `npx vitest run --config vitest.integration.config.ts src/modules/evidence-export` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 + `npx vitest run src/modules/evidence-export` + `npx vitest run --config vitest.integration.config.ts src/common` (route-guard coverage) → PASS; typecheck + lint.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 3: Worker `media` — processor, recovery, cleanup

**Files:**
- Create: `server/src/modules/evidence-export/{hls-playlist.ts, evidence-media.ts, evidence-export.processor.ts, evidence-export.worker.ts, evidence-cleanup.job.ts, evidence-export-worker.module.ts}` + tests (port `hls-playlist.test.ts`, `evidence-media.test.ts`; new `evidence-export.processor.int-test.ts`, `evidence-cleanup.int-test.ts`)
- Modify: `server/src/worker.module.ts` (`media` ⇒ `EvidenceExportWorkerModule`) + `worker.module.test.ts`

**Interfaces:**
- Consumes: Task 1–2; `RecordingProvider.requestPlayback(vendorDeviceId, startAt, endAt)` and `LiveStreamProvider.assertAllowed(url)` (`server/src/modules/streaming/`).
- Produces: `EvidenceExportProcessor.process(exportId: bigint): Promise<void>`; `EvidenceExportWorker` (BullMQ `Worker` on `EVIDENCE_EXPORT`, concurrency from env, `recoverOnStart()`); `EvidenceCleanupJob.purgeExpired(now?: Date): Promise<number>` every 60 s.

Processor (spec §4.3, reference flow): claim Queued→Processing (guarded) · re-check device (deleted / `StreamingEnabled` / `streaming.enabled` ⇒ Failed with reason; retired continues) · `requestPlayback` once (`'no-recordings'` ⇒ Failed "ไม่พบไฟล์บันทึกในช่วงเวลานี้") · `collectSegments` (allowed host per URL, progress via `segmentProgress`, write Progress at most every ~2 s) · `remuxToMp4` with ffmpeg in an OS temp dir · SHA-256 · copy to `evidence/<name>.part` then `rename` · Ready, `FileSizeBytes`, `Checksum`, `MediaSeconds`, `CompletedAt`, `ExpiresAt = CompletedAt + 24 h` · temp dir removed always · abort after `EVIDENCE_EXPORT_TIMEOUT_MINUTES` ⇒ Failed. Error text stored in Thai, logs English. Recovery on worker start: enqueue every Queued row (job id dedupes); Processing with `StartedAt` older than the timeout ⇒ Failed "งานค้าง กรุณาสั่งใหม่". Cleanup: Ready rows with `ExpiresAt ≤ now` ⇒ delete file (ignore missing) + Expired; delete `evidence/*.part` older than 1 h.

- [ ] **Step 1: Write failing tests**:
  - processor with injected fakes (fake provider URL + fake media deps serving a tiny playlist of 2 `.ts` segments; ffmpeg: use the real binary when `FFMPEG_PATH` / PATH has one, otherwise inject a fake remux that writes bytes — skip nothing, choose by detection) ⇒ Ready, file exists under `evidence/`, checksum = sha256 of the file, Progress 100, no `.part` left.
  - provider `'no-recordings'` ⇒ Failed with the Thai message, no file; device deleted while queued ⇒ Failed; a row not Queued is skipped.
  - recovery: a Queued row ⇒ enqueued once; a Processing row started 4 h ago (timeout 180) ⇒ Failed "งานค้าง กรุณาสั่งใหม่"; a fresh Processing row untouched (Review Focus 2).
  - cleanup: expired Ready ⇒ file deleted + Expired; unexpired untouched; old `.part` removed.
  - `WorkerModule.forRoles(['media'])` imports `EvidenceExportWorkerModule`; other roles don't.
- [ ] **Step 2: Run** `npx vitest run src/modules/evidence-export src/worker.module.test.ts` and `npx vitest run --config vitest.integration.config.ts src/modules/evidence-export` → FAIL.
- [ ] **Step 3: Implement** (port reference `evidence-media.ts` / `hls-playlist.ts` / processor / worker, adapting imports and the provider signature).
- [ ] **Step 4: Run** Step 2 commands → PASS; `npm run test:int` → PASS; typecheck + lint.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 4: Download on `/evidence`

**Files:**
- Create: `client/src/features/evidence/evidenceExports.api.ts`, `client/src/features/evidence/useEvidenceDownload.ts` (+ tests) — adapted from the reference
- Modify: `client/src/features/evidence/EvidencePage.tsx` (+ test), `client/src/i18n/locales/{th,en}/evidence.ts` (`evidence.download.*`)

**Interfaces:**
- Consumes: Task 2 routes/shapes; Task 4 of the previous plan's helpers (`fromBangkokLocalInput`, `validateEvidenceRange`) already in `evidenceRange.ts`.
- Produces: `evidenceExportsApi.policy()`, `.request({ deviceCode, startAt, endAt })`, `.get(id)`, `.ticket(id)`; `useEvidenceDownload()` → `{ state: 'idle'|'queued'|'processing'|'ready'|'failed'|'expired', progress, view, error, request(range), download(), reset() }` polling `get` every 2 s while Queued/Processing.

UI (spec §5): "ดาวน์โหลด MP4" next to ดูย้อนหลัง, only with `evidence:export`; cap from `/policy` ⇒ disabled + "ดาวน์โหลดได้ครั้งละไม่เกิน {n} นาที" when the range is longer; status line รอคิว / กำลังแปลงไฟล์ n% (progress bar) / พร้อมดาวน์โหลด (file name + size, button needs `evidence:download`) / ล้มเหลว (server message + ลองอีกครั้ง) / หมดอายุ (offer to export again); download opens the ticket URL (anchor with `download`); camera/day/range change ⇒ `reset()`.

- [ ] **Step 1: Write failing tests**: button hidden without `evidence:export`; 121-minute range ⇒ disabled + cap text (Review Focus 4); click ⇒ request then polling Queued → Processing 42% → Ready ⇒ download button with file name; no `evidence:download` ⇒ ready state without a download button + hint; Failed ⇒ message + ลองอีกครั้ง issues a new request (Review Focus 5); ticket 404 expired ⇒ "หมดอายุ" + export again (Review Focus 3); changing the range resets the status.
- [ ] **Step 2: Run** `npx vitest run src/features/evidence src/i18n` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 + `npm test` (ignore the known tracking test being edited outside this plan), `npm run typecheck`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5: Commit** — leave uncommitted.

---

### Task 5: Docs

**Files:** `docs/blueprint/09-risks-open-questions.md` (**DL88 (Q64)**: spec §1 decisions + designer calls: retired allowed, cross-user reuse, ticket 60 s user-bound, one playback URL per job, recovery rule, atomic rename), `04-database-design.md` (`EvidenceExports` created in `0015`, no `TrackingSessionId` until P2), `05-api-design.md` (routes, permissions, error codes `EXPORT_NOT_FOUND` / `EXPORT_NOT_READY` / `EXPORT_EXPIRED`), `03-business-workflows.md` (Settings: `streaming.download-max-minutes`), `02-system-architecture.md` (worker `media` live: queue + cleanup), `06-frontend-architecture.md` (download on `/evidence`), `08-implementation-roadmap.md` (P4 status), `README.md` if affected, `docs/runbooks/local-dev.md` (run worker with `WORKER_ROLES` incl. `media`, ffmpeg, storage dir), `CLAUDE.md` (P4 state line + migration `0015_p4_evidence_exports`, English).

- [ ] **Step 1: Edit** in Thai (CLAUDE.md English), Part 4 names, every Part that mentions it.
- [ ] **Step 2: Verify** `grep -n "DL88" docs/blueprint/*.md`; no Mermaid edited.
- [ ] **Step 3: Commit** — leave uncommitted.

---

## Final verification

- `server/`: `npm run ci` → PASS. `client/`: `npm test`, lint, typecheck, build → PASS.
- Live: run the worker with `media` + VPN; `/evidence` camera `1000027`, 2026-11-25, range 17:06:30–17:11:30 (5 min) ⇒ progress ⇒ Ready ⇒ downloaded MP4 plays; request again ⇒ same file instantly.
