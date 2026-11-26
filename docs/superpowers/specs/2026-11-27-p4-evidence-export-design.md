# P4 — ดาวน์โหลด MP4 (evidence export) ในหน้า วิดีโอย้อนหลัง

> สถานะ: ร่าง รออนุมัติ · วันที่ 2026-11-27 · Phase P4 ส่วนที่ 3 (ต่อจาก วิดีโอย้อนหลัง ค้นหา + เล่น — DL87)
> ต้นแบบ (อ่านอย่างเดียว): `C:\Git\Internal-BodyCam` — server `modules/streaming/evidence-export/*`
> (`evidence-export-rules.ts`, `evidence-export.service.ts`, `evidence-export.controller.ts`, `evidence-export.processor.ts`,
> `evidence-export.worker.ts`, `evidence-export-worker.module.ts`, `evidence-media.ts`, `hls-playlist.ts` + tests), `common/queue/evidence-export-queue.service.ts`,
> `common/rate-limit/rate-limit-specs.ts` (`evidence-export`, `evidence-download`) · client `features/evidence/{evidenceExports.api.ts, evidenceDownload.ts, useEvidenceDownload.ts}`
> และส่วนดาวน์โหลดใน `components/EvidencePlaybackDialog.tsx`

## 1. เป้าหมายและเหตุผล

ผู้ดูแลต้องเก็บวิดีโอช่วงที่สำคัญออกจากระบบเป็นไฟล์ (หลักฐาน ส่งต่อหน่วยงาน) — หน้า วิดีโอย้อนหลัง ตอนนี้เล่นได้อย่างเดียว (DL87)
blueprint (DL34, DL36, DL39, DL59) กำหนดไว้แล้วว่าแปลงเป็น MP4 ที่ worker `media` เก็บบนดิสก์ร่วม ลบหลัง 24 ชม.

ผู้ใช้ตัดสิน (2026-11-27 · บันทึกเป็น **DL88 / Q64**):

1. ทำดาวน์โหลด MP4 ต่อจาก วิดีโอย้อนหลัง
2. ดาวน์โหลดได้ครั้งละไม่เกิน **120 นาที** (setting ปรับได้ — แบบ reference)

ความสำเร็จ: ในหน้า `/evidence` เลือกช่วง (≤ 120 นาที) → กด ดาวน์โหลด MP4 → เห็นสถานะ/ความคืบหน้า → ไฟล์ดาวน์โหลดลงเครื่องได้
ขอช่วงเดิมซ้ำ (ยังไม่หมดอายุ) ได้ไฟล์เดิมทันที ไม่แปลงใหม่

## 2. ขอบเขต

**ทำ**
- ตาราง `EvidenceExports` + setting `streaming.download-max-minutes` (ค่าเริ่มต้น 120 · ขอบเขต 5–1440)
- api: `GET /api/evidence-exports/policy` · `POST /api/evidence-exports` · `GET /api/evidence-exports/:id` · `POST /api/evidence-exports/:id/download-ticket` · `GET /api/evidence-exports/download?ticket=`
- queue BullMQ `evidence-export` · worker role `media` (`EvidenceExportWorkerModule`): ดึง HLS ย้อนหลังจาก DSS → ffmpeg remux เป็น MP4 → checksum → เก็บไฟล์ → `Ready`
- `EvidenceCleanup`: ลบไฟล์ที่หมดอายุ (24 ชม.) ทุก 60 วินาที ใน worker `media`
- client: ปุ่ม ดาวน์โหลด MP4 ในหน้า `/evidence` + สถานะ/ความคืบหน้า + ดาวน์โหลดเมื่อพร้อม

**ไม่ทำ**
- ดาวน์โหลดจาก dialog ของใบงาน (`?workOrderId=` — ส่วนใบงาน รอ spec Booking) · `WorkOrderId` ในแถวเป็น null ไว้ก่อน
- `TrackingSessionId` (ตาราง `TrackingSessions` ยังไม่มี — เพิ่มพร้อม P2)
- object storage / MinIO (DL34: local disk เท่านั้น)
- รายการไฟล์ที่เคยดาวน์โหลด (ไม่มีหน้า history ของ export ในรอบนี้)

## 3. แนวทาง (Approaches)

| | แนวทาง | ผล |
|---|---|---|
| **A** | **port export ของ reference**: api สร้างแถว + เข้าคิว · worker `media` แปลงด้วย ffmpeg เก็บบนดิสก์ร่วม · client poll ความคืบหน้า แล้วขอ ticket ดาวน์โหลด | **เลือก** — ตรง blueprint (DL34, DL39) · คิว BullMQ มีแล้ว (P3a) · reference ผ่านการใช้งานมาแล้ว |
| B | แปลงสดตอนกดแล้ว stream ตรงให้ browser | ทิ้ง — คำขอค้างหลายนาทีที่ `api` · กิน CPU ของ `api` · หลุดแล้วต้องเริ่มใหม่ · ขัด DL39 (แยกงานแปลงออกจาก api) |
| C | ให้ DSS / middleware export ไฟล์เอง | ทิ้ง — middleware ไม่มี endpoint ดาวน์โหลด ต้องให้อีกทีมแก้ |

## 4. Server

### 4.1 ตาราง `EvidenceExports` (migration `0015_p4_evidence_exports`)

คอลัมน์ตาม reference: `Id`, `DeviceId NN → Devices`, `Channel smallint NN default 1`, `WorkOrderId → WorkOrders` (null ในรอบนี้), `StartAt NN`, `EndAt NN`,
`Status smallint NN default 1` (1 Queued · 2 Processing · 3 Ready · 4 Failed · 5 Expired — ตามเลขของ reference `EVIDENCE_EXPORT_STATUS`, ห้าม renumber),
`Progress smallint NN default 0`, `MediaSeconds integer`, `FilePath varchar(500)`, `FileName varchar(200)`, `FileSizeBytes bigint`, `Checksum varchar(64)`,
`ErrorMessage varchar(500)`, `RequestedBy NN → Users`, `RequestedAt NN default now`, `StartedAt`, `CompletedAt`, `ExpiresAt`, `CreatedAt`, `UpdatedAt` ·
index `IX_EvidenceExport_Range (DeviceId, Channel, StartAt, EndAt)`, `IX_EvidenceExport_Status (Status, ExpiresAt)`, `IX_EvidenceExport_User (RequestedBy, RequestedAt)`
+ data migration setting `streaming.download-max-minutes` = 120 (5–1440 แบบ reference — SUPER_ADMIN ปรับได้ · 1440 นาทีไฟล์จะใหญ่มาก เป็นความรับผิดชอบของผู้ตั้ง)

### 4.2 API (ตาม Part 5 §5.3)

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| GET | `/evidence-exports/policy` | `evidence:export` | `{ maxMinutes }` จาก setting |
| POST | `/evidence-exports` `{ deviceCode, startAt, endAt, channel? }` | `evidence:export` · `@Audit('REQUEST_EVIDENCE_EXPORT')` · rate limit `evidence-export` | ใช้แถวเดิมถ้า device + channel + start/end ตรงกันพอดีและยัง Queued / Processing / Ready ไม่หมดอายุ (`isReusableExport`) ไม่งั้นสร้างแถว Queued + เข้าคิว · ตอบ view ของแถว |
| GET | `/evidence-exports/:id` | `evidence:export` | ไม่ audit (client poll ทุก 2 วินาที) · `{ id, status, progress, fileName, fileSizeBytes, expiresAt, errorMessage? }` |
| POST | `/evidence-exports/:id/download-ticket` | `evidence:download` · `@Audit('DOWNLOAD_EVIDENCE_EXPORT')` | เฉพาะแถว Ready ไม่หมดอายุ · ticket อายุ 60 วินาที ผูก `exportId` + `userId` (seal แบบ reference `sealDownloadTicket`) · ใช้ซ้ำได้ภายใน 60 วินาที (browser ส่ง Range หลายครั้ง) · ตอนเปิดไฟล์ตรวจผู้ใช้ยัง active + ยังมี `evidence:download` · ตอบ `{ url: '/api/evidence-exports/download?ticket=…' }` |
| GET | `/evidence-exports/download?ticket=` | Public (ticket) · rate limit `evidence-download` | stream ไฟล์ (`Content-Disposition: attachment; filename=…`, `video/mp4`, รองรับ Range) · ticket ผิด/หมดอายุ/ไฟล์หาย = 404 |

กติกา:
- ช่วง: `end > start` · ≤ `streaming.download-max-minutes` · ไม่อยู่ในอนาคต (เผื่อ 5 นาที) · ไม่เก่ากว่าช่วงที่ค้นได้ (`earliestRecordingFrom` — 30 วัน, DL87) ⇒ 400 `INVALID_RANGE` (ข้อความไทยบอกเพดานนาที)
- กล้อง: ถูกลบ ⇒ 404 `DEVICE_NOT_FOUND` · **retired ดาวน์โหลดได้** (เหมือนเล่นย้อนหลัง DL87 — ต่างจาก reference) · `StreamingEnabled = false` / `streaming.enabled = false` ⇒ 403 (รหัสเดิม)
- แถวของคนอื่น: ทุก role บน web scope `all` — ผู้ที่มีสิทธิ์เห็น/ดาวน์โหลดแถวที่คนอื่นสร้างได้ (reuse ต้องใช้ข้ามผู้ใช้) · `TEAM_LEADER` ไม่มีสิทธิ์
- ชื่อไฟล์ ASCII: `evidence_{deviceCode}_{YYYYMMDD-HHmmss เวลาไทย}.mp4` (`exportFileName`, ไม่มีเลขใบงานในรอบนี้)
- ไม่มี middleware text ถึงผู้ใช้ · log ภาษาอังกฤษ

### 4.3 Worker `media`

- `WorkerModule.forRoles` โหลด `EvidenceExportWorkerModule` เมื่อ `WORKER_ROLES` มี `media`
- BullMQ worker ของคิว `evidence-export` · concurrency `EVIDENCE_EXPORT_CONCURRENCY` (default 1, ≤ 8 — DL39) · timeout `EVIDENCE_EXPORT_TIMEOUT_MINUTES` (default 180)
- processor (port): claim แถว Queued → Processing (guarded UPDATE) → ขอ playback URL ผ่าน `RecordingProvider.requestPlayback` (ของ DL87) →
  ดึง playlist + segment (ผ่าน host ที่อนุญาตเท่านั้น `LiveStreamProvider.assertAllowed`) → ffmpeg remux (`-c copy`) เป็น MP4 → SHA-256 → ย้ายไฟล์ไป `STORAGE_LOCAL_DIR/evidence/…`
  → Ready + `ExpiresAt = CompletedAt + 24 ชม.` · ระหว่างทางเขียน `Progress` (≤ 95 ระหว่างดึง segment แบบ reference)
- ล้มเหลว ⇒ Failed + `ErrorMessage` (ไทยสั้น ๆ ไม่มีข้อความดิบ) · ไฟล์ชั่วคราวถูกลบเสมอ · `'no-recordings'` ⇒ Failed "ไม่พบไฟล์บันทึกในช่วงเวลานี้"
- `ffmpeg` หาจาก env `FFMPEG_PATH` ถ้ามี ไม่งั้นจาก PATH (reference) — dev มี `C:\ffmpeg\bin` อยู่ใน PATH แล้ว
- `EvidenceCleanup` (60 วินาที, worker `media`): แถว Ready ที่ `ExpiresAt` ผ่านแล้ว ⇒ ลบไฟล์ + Expired (`purgeExpired` ของ reference) · แถวเก็บ 12 เดือน (P6)
- **ดึงเองแล้วค่อย remux (แบบ reference ทุกขั้น)**: worker อ่าน playlist แล้วโหลด segment ทีละไฟล์ลง temp dir เอง (ทุก URL ผ่าน `assertAllowed`, ได้ Progress ต่อ segment) แล้วให้ ffmpeg remux จากไฟล์ในเครื่อง — ไม่ให้ ffmpeg อ่าน URL เอง
- ขอ playback URL **ครั้งเดียวต่องาน** (แบบ reference) · ถ้า DSS ตัด VOD ต่อคำขอ / URL หมดอายุกลางทาง ⇒ งาน Failed (ยืนยันตอนทดสอบกล้องจริง — ถ้าเจอจริงค่อยทำแบบแบ่งช่วงในงานถัดไป)
- worker ตรวจกล้องซ้ำตอนเริ่มงาน: ถูกลบ / `StreamingEnabled = false` / `streaming.enabled = false` ⇒ Failed พร้อมเหตุผล · retired ทำต่อได้
- **กู้งานค้าง (การตัดสินของผู้ออกแบบ)**: BullMQ job id = `evidence-export-{Id}` (เพิ่มซ้ำไม่ซ้อน) · ตอน worker `media` เริ่ม ⇒ แถว Queued ทั้งหมดถูก enqueue ใหม่ · แถว Processing ที่ `StartedAt` เก่ากว่า `EVIDENCE_EXPORT_TIMEOUT_MINUTES` ⇒ Failed "งานค้าง กรุณาสั่งใหม่" · claim ยังเป็น Queued → Processing เท่านั้น
- **ไฟล์บนดิสก์ร่วม**: ffmpeg เขียนใน temp dir ของเครื่อง worker → คัดลอกไปไฟล์ชั่วคราว `.part` ในโฟลเดอร์ปลายทางใต้ `STORAGE_LOCAL_DIR/evidence/` → `rename` เป็นชื่อจริง (atomic ในโฟลเดอร์เดียวกัน) → ค่อยตั้ง Ready · api เสิร์ฟเฉพาะแถว Ready · `EvidenceCleanup` ลบไฟล์ `.part` ที่เก่ากว่า 1 ชม. ด้วย

### 4.4 Storage

- `STORAGE_DRIVER=local` เท่านั้น (DL34) · `STORAGE_LOCAL_DIR` (dev `./storage`) — `api` อ่าน, `worker-media` เขียน · path ในแถวเป็น relative กับ root
- ไม่มี env ใหม่นอกจากที่ `.env.example` มีแล้ว (`STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `EVIDENCE_EXPORT_CONCURRENCY`, `EVIDENCE_EXPORT_TIMEOUT_MINUTES`) + `FFMPEG_PATH` (ไม่บังคับ — ถ้า `.env.example` ยังไม่มีให้เพิ่มแบบ comment)

## 5. Client — หน้า `/evidence`

```
ช่วงที่ดู  เริ่ม [..]  สิ้นสุด [..]   [ ดูย้อนหลัง ]  [ ⬇ ดาวน์โหลด MP4 ]
           ดาวน์โหลดได้ครั้งละไม่เกิน 120 นาที
           ┌ กำลังแปลงไฟล์ … 42% ███████░░░░ ┐   → พร้อมแล้ว: [ ดาวน์โหลด evidence_1000027_20251125-170630.mp4 (310 MB) ]
```

- ปุ่ม ดาวน์โหลด MP4 อยู่ข้าง ดูย้อนหลัง · แสดงเมื่อผู้ใช้มี `evidence:export` · ช่วงเกินเพดาน (จาก `/policy`) ⇒ ปุ่มกดไม่ได้ + ข้อความบอกเพดาน
- กด ⇒ `POST /evidence-exports` ⇒ poll `GET /:id` ทุก 2 วินาที ⇒ แสดงสถานะ: รอคิว / กำลังแปลง n% / พร้อม / ล้มเหลว (ข้อความ + ลองใหม่)
- พร้อม ⇒ ปุ่ม ดาวน์โหลด (ต้องมี `evidence:download`) ⇒ ขอ ticket ⇒ เปิด URL ดาวน์โหลด (browser ดาวน์โหลดเอง) · ได้แถวเดิมที่พร้อมแล้ว ⇒ ข้ามไปพร้อมทันที
- เปลี่ยนกล้อง / วัน / ช่วง ⇒ ล้างสถานะดาวน์โหลด (ไม่ยกเลิกงานที่ server)
- port `evidenceExports.api.ts`, `useEvidenceDownload.ts`, `evidenceDownload.ts` ของ reference · i18n `evidence.download.*` th/en · ไม่เอ่ยถึงแหล่งข้อมูล

## 6. การทดสอบ

- server unit: `assertExportRange` (เพดานนาทีจาก setting, อนาคต, ย้อนหลัง 30 วัน), `isReusableExport`, `exportFileName` (เวลาไทย), ticket seal/open, `segmentProgress`, HLS playlist parse (port tests)
- server integration: request สร้างแถว + เข้าคิว (ตรวจ job ใน Redis หรือ spy queue) · reuse แถวเดิม (Queued / Ready ไม่หมดอายุ) · หมดอายุ ⇒ สร้างใหม่ · สิทธิ์ (VIEWER 403, `evidence:export` ไม่มี `evidence:download` ขอ ticket ⇒ 403) · ticket ⇒ ดาวน์โหลดได้ (ไฟล์จริงใน storage ชั่วคราว) / ticket หมดอายุ 404 · processor กับ provider + ffmpeg จำลอง (หรือ ffmpeg จริงถ้ามี — ข้ามเมื่อไม่มี) ⇒ Ready + checksum · ล้มเหลว ⇒ Failed ไม่มีไฟล์ค้าง · `purgeExpired` ลบไฟล์ + Expired · worker role `media` โหลดโมดูล
- client: ปุ่มตามสิทธิ์ · เกินเพดาน ⇒ กดไม่ได้ · poll จน Ready แล้วขอ ticket · Failed ⇒ ข้อความ + ลองใหม่ · เปลี่ยนช่วงแล้วสถานะล้าง
- ทดสอบจริง: worker `media` + กล้อง `1000027` วันที่ 25 พ.ย. ช่วง 5 นาที ⇒ ได้ไฟล์ MP4 เล่นได้

## 7. เอกสารที่ต้องอัปเดต

Part 9 §9.5 **DL88 (Q64)** · Part 4 (`EvidenceExports` สร้างแล้ว `0015`, ไม่มี `TrackingSessionId` จนถึง P2) · Part 5 (สิทธิ์ export/download, รหัสผิดพลาด, response) ·
Part 3 Settings (`streaming.download-max-minutes`) · Part 2 (worker `media` ทำงานแล้ว) · Part 6 (ปุ่มดาวน์โหลดใน `/evidence`) · Part 8 (สถานะ P4) · README ถ้ากระทบ ·
runbook (รัน worker `media`, ffmpeg, storage) · CLAUDE.md (P4 state, migration 0015)

## 8. ความเสี่ยง

- ไฟล์ 120 นาทีอาจใหญ่ ~2 GB (ขึ้นกับบิตเรตกล้อง) — ดิสก์ PVC ต้องพอสำหรับไฟล์ 24 ชม. · ตรวจตอน deploy (Part 9 R16)
- ffmpeg ต้องมีใน image ของ worker ตอน deploy (ตรวจ Dockerfile ของ backend ตอนนำขึ้น — ไม่แก้ repo Azure)
- middleware เล่น VOD ช้าหรือหลุดกลางทาง ⇒ งานล้มเหลวต้องกดใหม่ (ไม่ resume)

## 9. ปล่อยให้ builder ตัดสิน

- โครงไฟล์ (โมดูลใหม่ `modules/evidence-export/` หรือใน `modules/streaming/`) · ชื่อ helper ภายใน
- ข้อความไทยของสถานะ (ใช้ของ reference เป็นหลัก)
- ค่า rate limit (ใช้ค่าเริ่มต้นของ reference + env เดิม `EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR`, `EVIDENCE_DOWNLOAD_RATE_LIMIT_PER_MIN`)
