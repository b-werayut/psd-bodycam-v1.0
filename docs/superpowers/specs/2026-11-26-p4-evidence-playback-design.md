# P4 — วิดีโอย้อนหลัง `/evidence`: ค้นไฟล์บันทึกรายกล้อง + เล่นย้อนหลัง

> สถานะ: ร่าง รออนุมัติ · วันที่ 2026-11-26 · Phase P4 ส่วนที่ 2 (ต่อจาก talk + ภาพสด)
> ต้นแบบ (อ่านอย่างเดียว): `C:\Git\Internal-BodyCam` — server `modules/streaming/{playback.service.ts, playback-range.ts, recording-merge.ts, dto/playback.dto.ts, provider/dss-stream.provider.ts}`,
> client `features/evidence/{components/RecordingSegmentsPanel.tsx, components/EvidencePlaybackDialog.tsx, evidenceRange.ts}`
> middleware: `C:\Git\psd-bwc-dss-services` `app/api/routes/{recording.py, playback.py}` (อ่านอย่างเดียว)

## 1. เป้าหมายและเหตุผล

ผู้ดูแลในศูนย์ควบคุมต้องย้อนดูวิดีโอของกล้องตัวใดก็ได้ในวันที่เลือก รวมถึงกล้องที่ไม่มีใบงาน (DL59) —
ตอนนี้เมนู วิดีโอย้อนหลัง ยังกดไม่ได้ ภาพสด / talk / แผนที่ทำครบแล้ว และ DSS middleware รองรับการค้นไฟล์และเล่นย้อนหลังแล้ว

ผู้ใช้ตัดสิน (2026-11-26 · บันทึกเป็น **DL87 / Q63**):

1. ทำหน้า วิดีโอย้อนหลัง (ค้นหา + เล่นย้อนหลัง) ก่อน · ดาวน์โหลด MP4 แยกเป็นงานถัดไป
2. เลือกวันย้อนหลังได้ **30 วัน** (เพดานของ DSS middleware) แทน 3 เดือนที่ DL59 เขียนไว้

ความสำเร็จ: เลือกกล้อง + วัน → เห็นไฟล์บันทึกทุกช่วงของวันนั้น → กดช่วงหนึ่งแล้วเล่นย้อนหลังได้ · ปรับช่วงเวลาเองได้ (≤ 24 ชม.)

## 2. ขอบเขต

**ทำ**
- server: `GET /api/streams/recordings?deviceId&from&to` · `POST /api/streams/playback`
- client: หน้า `/evidence` (เปิดเมนู วิดีโอย้อนหลัง) — เลือกกล้อง + วัน · รายการไฟล์ · player + ปรับช่วง
- ไฟล์ทุกช่วงแสดงป้าย "ไม่ผูกใบงาน" (`workOrder: null`) จนกว่าจะมี session engine (P2)

**ไม่ทำ**
- ดาวน์โหลด MP4 / `EvidenceExports` / worker `media` (งานถัดไป)
- `?workOrderId=` และปุ่ม ดูย้อนหลัง ในหน้า ใบงาน (ส่วนใบงาน — รอ spec Booking)
- ตาราง `RecordingSegments` + recording index job (มากับ P2 เพื่อผูกไฟล์กับ session/ใบงาน)
- ป้ายใบงานจริง (ต้องมี `TrackingSessions` — P2)

## 3. แนวทาง (Approaches)

| | แนวทาง | ผล |
|---|---|---|
| **A** | **ค้นจาก DSS ทุกครั้งที่ค้นหา**: Nest เรียก middleware `/recording/search` แล้วกรองเหลือช่วงที่ขอ | **เลือก** — ไม่มีตารางใหม่ · ข้อมูลล่าสุดเสมอ · ทดสอบกล้องจริงแล้ว ~0.9 วินาที (11 ช่วงใน 30 วัน) |
| B | cache ใน `RecordingSegments` + job ดึงจาก DSS เป็นระยะ | เลื่อนไป P2 — ต้องมี worker job · ข้อมูลอาจช้ากว่าจริง · ประโยชน์หลัก (ผูกไฟล์กับใบงาน) ยังใช้ไม่ได้จนมี session |

การเล่นย้อนหลังมีทางเดียวที่เหมาะ: แถว `StreamingSessions` แบบ `SessionType = 2` (`PlaybackStartAt` / `PlaybackEndAt` มีอยู่แล้วในตาราง) ผ่าน proxy HLS ตัวเดิมของภาพสด

## 4. ข้อเท็จจริงของ middleware (Confirmed — อ่านโค้ด + ทดสอบกล้อง `1000027` 2026-11-26)

- `POST /api/v1/recording/search` `{ channelId, daysBack (1–30), recordSource? }` — ค้น **ย้อนหลัง N วันจากตอนนี้** เท่านั้น (ไม่รับช่วงเวลาเอง) ·
  ลอง source 3 (center) ก่อนแล้ว 2 (device) · รวมไฟล์ที่ต่อกัน (ห่าง ≤ 5 วินาที) · ตอบ `{ code: 1000, data: { records: [{ startTime, endTime (unix วินาที เป็น string), startDateTime, endDateTime, duration_seconds, ... }] } }` · ไม่มีไฟล์ = `code 1002` (HTTP 200)
- `channelId` = `${VendorDeviceId}$${channel}$0$0` (เช่น `1000027$1$0$0`) — รูปแบบ `$1$0$1` ได้ 0 ไฟล์
- `POST /api/v1/playback` `{ deviceCode, channelId, startTime, endTime }` (unix วินาที) → `{ code: 1000, data: { video_url } }` — `video_url` เป็น URL proxy ของ middleware แบบเดียวกับภาพสด · ไม่มีไฟล์ = `1002` · ขอ HLS ไม่ได้ = `1001`
- auth = JWT จาก `dssAuthorizationHeader(DSS_API_KEY)` (ไม่มี `kid` ⇒ ได้ทุก scope รวม `recording` / `playback`)
- quirk ที่ reference เจอ: ต้นช่วงค้น = now − N วัน ทำให้ไฟล์ที่คร่อมต้นช่วงถูกตัดเวลาเริ่มเลื่อนทุกครั้ง ⇒ ขอ `daysBack` เผื่อ +1 วัน แล้วกรองเองใน Nest (reference `dssDaysBackFor`) · ที่เพดาน 30 เผื่อไม่ได้

## 5. Server

### 5.1 `GET /api/streams/recordings?deviceId&from&to`

- สิทธิ์ `playback:view` · `@Audit('SEARCH_RECORDINGS', 'Devices')` (การค้นไปที่แพลตฟอร์มกล้อง = เหตุการณ์ที่ต้องรู้ว่าใครดูอะไร)
- `from` / `to` ISO · `to > from` · ช่วง ≤ 24 ชม. · `from` ไม่ก่อน **00:00 (เวลาไทย) ของวันที่ 29 วันก่อนวันนี้** = เลือกได้ 30 วันรวมวันนี้ (`RECORDING_MAX_DAYS_BACK = 30`, ค่าคงที่ตัวเดียว) · ไม่อยู่ในอนาคตเกิน 5 นาที ⇒ ผิด = 400 `INVALID_RANGE` (รหัสเดียวกับประวัติเส้นทาง)
- กล้องไม่พบ / ถูกลบ = 404 `DEVICE_NOT_FOUND` · `TEAM_LEADER` ไม่มี `playback:view` อยู่แล้ว
- `daysBack = min(30, ceil((now − from) / 1 วัน) + 1)` → middleware → แปลง `startTime`/`endTime` → กรองไฟล์ที่ทับ `[from, to)` · ไม่ตัดเวลาของไฟล์ (หน้าเว็บตัดตอนเล่น)
- ตอบ `{ data: [{ startAt, endAt, durationSeconds, workOrder: null }], from, to }` เรียงตามเวลาเริ่ม
- middleware ล่ม / ตอบผิด = 502 `RECORDING_SEARCH_FAILED` ข้อความไทย ไม่ส่งข้อความดิบจาก middleware
- `DSS_DRIVER=mock`: คืนไฟล์จำลองที่ deterministic (เช่น 08:00–10:00 และ 13:00–13:45 ของวันที่ขอ) สำหรับ test

### 5.2 `POST /api/streams/playback` `{ deviceCode, startAt, endAt, channel? }`

- body เดิมที่ client เรียกอยู่แล้ว (`streamingApi.startPlayback`) · สิทธิ์ `playback:view` · `@Audit('START_PLAYBACK', 'StreamingSessions')`
- ช่อง (channel) = 1 เท่านั้นเหมือนภาพสด (`/recordings` ไม่รับ channel)
- ช่วง ≤ 24 ชม. · ไม่เก่ากว่า 30 วัน · ไม่อยู่ในอนาคต ⇒ 400 `INVALID_RANGE`
- เหมือน `startLive`: `streaming.enabled` (สวิตช์เดียวของวิดีโอทั้งหมดจาก DSS — ปิดแล้วเล่นย้อนหลังไม่ได้ด้วย) · `Devices.StreamingEnabled` = false ⇒ 403 · โควตา `streaming.max-concurrent-per-user` (นับรวมภาพสด) · advisory lock ต่อผู้ใช้
- **กล้อง retired (`Status = 4`) ค้นและเล่นย้อนหลังได้** (ดูวิดีโอเก่าคือจุดประสงค์ของหน้านี้) — ต่างจากภาพสด · กล้องที่ถูกลบ (`IsDeleted`) = 404 `DEVICE_NOT_FOUND` ทั้งค้นและเล่น
- insert `StreamingSessions` `SessionType = 2`, `PlaybackStartAt`, `PlaybackEndAt` → middleware `/playback` (นอก transaction) → ACTIVE → ตอบ shape เดียวกับภาพสด (`LiveSession`: `sessionToken`, `playbackUrl` ผ่าน proxy `/api/streams/:token/playlist.m3u8`, `idleTimeoutSeconds`)
- ไม่มีไฟล์ในช่วงนั้น (1002) = 404 `RECORDING_NOT_FOUND` "ไม่พบไฟล์บันทึกในช่วงเวลานี้" · อื่น ๆ = 502 `PLAYBACK_START_FAILED` · row ⇒ FAILED
- สิทธิ์สดตอนเล่น media: แถว `SessionType 2` ต้องมี `playback:view` อย่างเดียว (ไม่ต้องมี `streaming:view-live`) · แถว 1 = `streaming:view-live` เหมือนเดิม — `currentAccess` ตรวจตาม `SessionType` · `TEAM_LEADER` ถูกปฏิเสธทั้งคู่ · `playback:view` มีอยู่แล้วที่ SUPER_ADMIN / ADMIN / OPERATOR (Part 5 §5.7) ไม่ต้องมี data migration
- `GET /streams/sessions` เพิ่ม `sessionType` ในแต่ละแถว · หน้าภาพสดหลายจอใช้เฉพาะแถว `sessionType = 1` (โควตารวมยังนับทั้งหมด)
- หยุดเล่น (pause) นานจน player ไม่ดึงข้อมูลเกิน `streaming.url-ttl-seconds` ⇒ session ปิดตามกติกาเดิม (การตัดสินของผู้ออกแบบ — ไม่เพิ่ม setting ใหม่) · player แสดงสถานะ "จอถูกปิด" พร้อมปุ่มเล่นช่วงเดิมอีกครั้ง (ขอ session ใหม่)
- playlist ของไฟล์บันทึกเป็น VOD (`#EXT-X-ENDLIST`, เลื่อนเวลาได้) — `rewritePlaylist` / proxy เดิมใช้ได้ (ไม่ขึ้นกับ live) · `StreamPlayer` โหมด `playback` port มาจาก reference ที่ใช้กับ VOD อยู่แล้ว · ยืนยันกับกล้องจริงตอนทดสอบ
- stop / sessions / idle expire / proxy ใช้ของเดิม (`/streams/:token/stop`, `expireIdle`) · `stream:status` เดิม
- provider: เพิ่ม `searchRecordings` + `requestPlayback` ใน `LiveStreamProvider` (หรือไฟล์ provider ใหม่ใน `modules/streaming/`) ใช้ `dssRequest` + `dssAuthorizationHeader` + `DSS_BASE_URL` · ไม่มี env ใหม่ · ทดสอบได้ด้วย `DSS_DRIVER=mock`

## 6. Client — หน้า `/evidence`

เปิดเมนู วิดีโอย้อนหลัง (`navigation.playback` ใส่ `to: '/evidence'`) · route `evidence` ต้องมี `playback:view` + `devices:read` ตาม DL59 (ตอนนี้ตั้ง `work-orders:read` ไว้ — แก้)

```
วิดีโอย้อนหลัง
ค้นและเล่นวิดีโอที่กล้องบันทึกไว้ (ย้อนหลังได้ 30 วัน)
[ กล้อง: ค้นรหัส/ชื่อ ▾ ]  [ วันที่ 26/11/2569 ]  [ ค้นหา ]
┌──────────── player 16:9 ────────────┐  ┌ ไฟล์บันทึก 26 พ.ย. (3 ช่วง) ┐
│                                      │  │ 08:00–10:00 · 2 ชม.  ไม่ผูกใบงาน │
│   (เลือกช่วงจากรายการทางขวา)          │  │ 13:00–13:45 · 45 นาที ไม่ผูกใบงาน│
└──────────────────────────────────────┘  │ 15:53–16:37 · 43 นาที ไม่ผูกใบงาน│
ช่วงที่ดู  เริ่ม [..:..:..]  สิ้นสุด [..:..:..]  [ ดูย้อนหลัง ]       └──────────────┘
```

- layout ตาม `EvidencePlaybackDialog` ของ reference (`lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]`) แต่เป็นหน้าเต็ม · จอแคบ = player บน รายการล่าง
- กล้อง: ทุกกล้องจาก `GET /devices` (ค้นรหัส / ชื่อ · รวมกล้อง retired) · วัน: วันนี้ถึง 29 วันก่อน (เวลาไทย) · ช่วงที่ค้น = 00:00–24:00 เวลาไทยของวันนั้น ส่วนวันนี้ = 00:00–ตอนนี้ · ค้นเมื่อกด ค้นหา / เปลี่ยนกล้องหรือวัน (การค้นแต่ละครั้งไปที่แพลตฟอร์มกล้อง + audit — ไม่ค้นระหว่างพิมพ์)
- รายการไฟล์ (port `RecordingSegmentsPanel`): ช่วงเวลา + ระยะเวลา + ป้าย "ไม่ผูกใบงาน" · ไฟล์ที่คร่อมเที่ยงคืนแสดงวันที่ด้วย · ไม่มีไฟล์ = empty state · ผิดพลาด = ข้อความ + ลองใหม่
- คลิกไฟล์ = เติมช่วงที่ดู (ตัดให้อยู่ในวันที่เลือก) **และเริ่มเล่นทันที** · ปรับเวลาเริ่ม/สิ้นสุดเอง (ละเอียดถึงวินาที, ≤ 24 ชม., `evidenceRange`) แล้วกด ดูย้อนหลัง
- player = `StreamPlayer` โหมด `playback` ที่มีอยู่แล้ว · ไม่มี talk · เปลี่ยนกล้อง/วัน/ช่วง = ปิด session เก่าก่อนเปิดใหม่
- URL เก็บสถานะ `?deviceId&date` (กดลิงก์ / refresh แล้วได้หน้าเดิม — alert `RECORDING_OUTSIDE_WORK` จะลิงก์มาแบบนี้ภายหลัง)
- i18n `evidence.*` th/en · ไม่เอ่ยถึงแหล่งข้อมูล (DL64)

## 7. การทดสอบ

- server unit: ตรวจช่วง (`INVALID_RANGE` ทุกกรณี), `daysBack` (+1, เพดาน 30), แปลง/กรองไฟล์จาก payload ของ middleware (records / list / data array, เวลา unix string, ไฟล์คร่อมขอบ)
- server integration (`DSS_DRIVER=mock`): recordings — สิทธิ์ (VIEWER 403), กล้องไม่พบ 404, ช่วงผิด 400, ผลจาก mock เรียง + กรอง, audit `SEARCH_RECORDINGS` · playback — สร้าง `SessionType 2` + เวลา, โควตารวมกับภาพสด, 1002 ⇒ 404, ล้มเหลว ⇒ row FAILED, media ใช้ `playback:view`, stop/expire เดิมใช้ได้
- client: หน้า `/evidence` — ค้นแล้วแสดงรายการ, คลิกไฟล์แล้ว player ได้ช่วงที่ตัดในวัน, ปรับช่วงเกิน 24 ชม./กลับด้าน ⇒ ปุ่มกดไม่ได้ + ข้อความ, เปลี่ยนกล้องแล้วค้นใหม่, empty / error, URL state · nav: เมนูกดได้ตามสิทธิ์
- ทดสอบจริง: กล้อง `1000027` ค้นวันที่มีไฟล์ (เช่น 25 พ.ย.) แล้วเล่นย้อนหลังได้ผ่าน VPN

## 8. เอกสารที่ต้องอัปเดต

Part 9 §9.5 **DL87 (Q63)** + แก้ DL59 (ย้อนหลัง 30 วัน) · Part 5 (recordings / playback รายละเอียด + รหัสผิดพลาด) · Part 6 (หน้า วิดีโอย้อนหลัง 30 วัน, คลิกไฟล์แล้วเล่น) · Part 2 §evidence (ค้นสดจาก DSS, `RecordingSegments` ไป P2) ·
Part 4 (`RecordingSegments` ยังไม่สร้าง) · Part 8 (สถานะ P4) · README ถ้ากระทบ · CLAUDE.md (P4 state) · runbook (ทดสอบวิดีโอย้อนหลัง)

## 9. ความเสี่ยง

- `daysBack` เพดาน 30 จาก middleware — วันที่ 30 ย้อนหลังอาจได้ไฟล์ไม่ครบต้นวัน (เผื่อ +1 ไม่ได้) · ยอมรับ
- middleware ตอบเฉพาะหน้าแรกของผลค้น (`total_pages` ไม่ถูกตามต่อ) — ถ้ากล้องมีไฟล์เยอะมากใน 30 วันอาจได้ไม่ครบ · ตอนนี้ทดสอบได้ 11 ช่วง / 1 หน้า · ตรวจอีกครั้งเมื่อมีกล้องจริงหลายตัว
- เวลาไฟล์จาก DSS เป็นเวลาไซต์ (Asia/Bangkok) แต่ส่ง unix timestamp — ใช้ timestamp เป็นหลัก

## 10. ปล่อยให้ builder ตัดสิน

- แยก provider ไฟล์ใหม่หรือเติมใน `live-stream.provider.ts` · ชื่อ helper ภายใน
- ข้อความไทยของสถานะ/ข้อผิดพลาด (ใช้ของ reference เป็นหลัก)
- ตัวเลือกกล้องแบบ combobox ค้นได้ (ใช้ component ที่มีใน `components/ui` / ของหน้า ประวัติเส้นทาง)
