# P4 — คุยผ่านกล้อง (talk) + ดูสดจากแผนที่และหน้า ใบงาน

> สถานะ: ร่าง รออนุมัติ · วันที่ 2026-11-26 · Phase P4 (Media & Evidence) ส่วนแรกต่อจากภาพสดหลายจอ
> ต้นแบบ: reference `C:\Git\Internal-BodyCam` — spec `docs/superpowers/specs/2026-09-24-bodycam-talk-design.md`
> (เรียกต่อไปว่า **spec ต้นแบบ**) และโค้ด `server/src/modules/talk/*`, `client/src/features/talk/*`,
> `client/src/features/streaming/components/LiveStreamDialog.tsx` · อ่านอย่างเดียว ห้ามแก้ repo นั้น

## 1. เป้าหมายและเหตุผล

ผู้ดูภาพสดในศูนย์ควบคุม (`OPERATOR`, `ADMIN`, `SUPER_ADMIN`) ต้องพูดกับพนักงานที่ถือกล้องได้ทันที
โดยไม่ต้องโทรศัพท์แยก — talk เป็น **Must** (DL48) และต้องอยู่คู่กับภาพสดทุกจุดบน web (DL62)

ผู้ใช้ตัดสิน (2026-11-26 · บันทึกเป็น **DL86 / Q62**):

1. ทำส่วนกล้องก่อน ข้ามส่วนใบงานที่ต้องรอ spec ข้อมูลใบงานจากทีม Booking — DSS middleware พร้อมแล้ว
2. งานแรกของส่วนกล้อง = **talk + ดูสดจากแผนที่**
3. ใส่ปุ่ม **ดูสด (มี talk)** ในหน้า ใบงาน รอบนี้ด้วย — กล้องของใบงานมาจาก `DeviceRefs` ที่มีอยู่แล้ว ไม่ต้องรอ spec Booking

ความสำเร็จ: ผู้ใช้เปิดภาพสดจาก 3 จุด (ภาพสดหลายจอ · การ์ดกล้องบนแผนที่ติดตาม · หน้า ใบงาน / รายละเอียดใบงาน)
กด "เริ่มคุย" แล้วพูดออกลำโพงกล้องและได้ยินเสียงจากกล้อง · ปิด dialog / ปิดภาพ = วางสาย

## 2. ขอบเขต

**ทำ**

- talk สองทางแบบโทรต่อเนื่อง (full-duplex) เหมือน reference — เริ่มคุย / วางสาย พูดและฟังพร้อมกัน แนะนำให้ใช้หูฟัง
- ตาราง `TalkSessions` + setting `streaming.talk-max-seconds` + audit `START_TALK` / `STOP_TALK`
- 1 สายต่อกล้อง (บังคับที่ DB) · 1 สายต่อภาพสด
- `LiveStreamDialog` (โหมด live เท่านั้น) + ปุ่ม talk ใน footer
- ภาพสดหลายจอ: แผง talk คุยกับจอที่เลือก (props `talking` / `muteAll` มีรอไว้แล้ว)
- การ์ดกล้องบนแผนที่ติดตาม: ปุ่ม **ดูสด**
- หน้า ใบงาน (รายการ) และรายละเอียดใบงาน: ปุ่ม **ดูสด** ต่อกล้อง

**ไม่ทำ** (เหมือน spec ต้นแบบ + ของเรา)

- broadcast · คุยหลายกล้องพร้อมกันจากผู้ใช้คนเดียว · บันทึก / เก็บเสียง · คุยโดยไม่เปิดภาพ
- push-to-talk · คีย์ลัด · แจ้ง realtime ว่ามีคนคุยกับกล้องนี้อยู่
- talk บนแอปมือถือ (`TEAM_LEADER` ไม่มี `streaming:talk` — Part 5 §5.4)
- โหมด playback ของ `LiveStreamDialog` (มากับ วิดีโอย้อนหลัง `/evidence` งานถัดไป)
- ปุ่ม **ดูย้อนหลัง** ในหน้า ใบงาน (ต้องใช้ `workWindow` + recording search — งานวิดีโอย้อนหลัง)
- หน้าตั้งสิทธิ์ภาพสดต่อ role (`/streams/role-access` · RoleStreamAccessPanel ของ reference) — ยังไม่มีในระบบเรา

## 3. แนวทาง (Approaches)

| | แนวทาง | ผล |
|---|---|---|
| **A** | **port talk ของ reference**: browser ต่อ raw WS `/api/talk/ws?ticket=` ของ Nest · Nest relay PCM ไป WS ของ DSS middleware · สถานะสายใน `TalkSessions` · client AudioWorklet | **เลือก** — reference คุยกับ middleware ตัวเดียวกัน (`psd-bwc-dss-services` `/api/v1/talk/*`) ผ่านการทดสอบมาแล้ว · `client/nginx.conf` ของเรา proxy `/api/talk/ws` ไว้แล้ว · Part 5 กำหนด API นี้อยู่แล้ว |
| B | browser ต่อ WS ของ middleware ตรง | ทิ้ง — browser ต้องถือ JWT ที่เซ็นด้วย `DSS_API_KEY` · เครื่องผู้ใช้เข้าถึง PSD Server ไม่ได้ · ตรวจสิทธิ์ / audit รายผู้ใช้ไม่ได้ |
| C | ส่ง frame เสียงผ่าน Socket.IO ที่มีอยู่ | ทิ้ง — frame binary 25 ครั้ง/วินาทีผ่าน Redis adapter · ต้องเขียน relay + client ที่ทดสอบแล้วใหม่ |

ผู้ใช้ไม่ได้เลือกวิธีทำเอง — A เป็นการตัดสินของผู้ออกแบบ เพราะมีทางเดียวที่เหมาะ

## 4. ข้อเท็จจริงของ DSS middleware (อ่านจาก `C:\Git\psd-bwc-dss-services` · Confirmed)

- `POST /api/v1/talk/start` `{ deviceCode, maxSeconds }` → `{ code: 1000, data: { talkId, uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40 } }`
  · ตอบหลัง ~11 วินาที (DSS ตอบ DESCRIBE หลัง ~10.4 วินาที) ⇒ timeout ฝั่งเรา 30 วินาที
  · code อื่น: 1001 อุปกรณ์ปฏิเสธ · 1002 RTSP ล้ม · 1003 codec ไม่รองรับ · 1004 อุปกรณ์มีสายค้าง · 4000 input ผิด · 5000 ระบบผิดพลาด
- `WS /api/v1/talk/{talkId}/audio` — PCM16LE mono 8 kHz สองทาง · uplink ต้อง 640 byte (40 ms) ต่อข้อความ ·
  รับ upgrade ก่อนแล้วปิดด้วย code (1008 auth · 4004 ไม่พบสาย) · ต้องต่อภายใน 15 วินาทีหลัง start (`TALK_ATTACH_TIMEOUT`) · เงียบ 10 วินาที = ตัด (`TALK_IDLE_TIMEOUT`)
- `POST /api/v1/talk/stop` `{ talkId }` — idempotent
- auth = `Authorization: Bearer <JWT>` ทั้ง REST และ WS handshake · JWT ที่ไม่มี `kid` (ของ Nest) ได้ทุก scope รวม `talk`
  ⇒ ใช้ `dssAuthorizationHeader(DSS_API_KEY)` ตัวเดิมได้เลย (JWT ใหม่ทุกคำขอ อายุ 60 วินาที · WS ตรวจตอน handshake ครั้งเดียว)

## 5. Server

### 5.1 สิ่งที่ port ตรงจาก reference (พฤติกรรมเดิมทั้งหมด)

`server/src/modules/talk/`: `talk-constants.ts` (status / end reason / close code / vendor code — เลขลง DB แล้ว ห้าม renumber) ·
`talk-frames.ts` (ตรวจขนาด frame + rate 75 frame/วินาที) · `talk-ticket.ts` (ticket 43 ตัว · DB เก็บ SHA-256 · ใช้ครั้งเดียวแบบ atomic · อายุ 30 วินาที) ·
`talk-relay.ts` (raw `ws` server `noServer` เกาะ event `upgrade` ของ HTTP server เฉพาะ path `/api/talk/ws` · ตอบ 101 ทันทีหลังใช้ ticket
เพราะ engine.io ทำลาย upgrade ที่ไม่ใช่ของตัวเองหลัง 1 วินาที · revalidate ทุก 15 วินาที · map close code สองทอดตามตารางของ spec ต้นแบบ ·
ไม่ log / ไม่เก็บเสียง) · `talk.service.ts` (start / stop / consumeTicket / revalidate / hangUp / expireStaleTalks) · `provider/` (`dss` + `mock` echo) ·
`dto/start-talk.dto.ts` · `talk.controller.ts` · `talk.module.ts` · tests ทั้งหมดที่คู่กัน

ขั้นตอน start (ตาม spec ต้นแบบ): ตรวจสิทธิ์สดจาก DB → หา **ภาพสดของผู้ใช้เองที่ Status = 2** จาก `streamSessionToken` →
ตรวจกล้องใช้ได้ (`StreamingEnabled`, ไม่ retired, ไม่ถูกลบ) และ `streaming.enabled` → ปล่อยสายค้างของตัวเองบนกล้องนี้ →
insert `REQUESTED` (unique `UX_Talk_Device_Open` กันชน — ชน = 409 พร้อมชื่อผู้ที่คุยอยู่) → provider.start (นอก transaction) →
update เป็น `ACTIVE` + ticket → ตอบ `{ talkSessionId, wsUrl, uplinkSampleRate, downlinkSampleRate, frameMs, maxSeconds }`

revalidate ทุก 15 วินาทีตัดสายเมื่อ: ผู้ใช้ถูกระงับ / ลบ · role ไม่มี `streaming:talk` แล้ว · กล้องปิด streaming / retired / ถูกลบ ·
`streaming.enabled` = false · **ภาพสดที่ผูกอยู่จบแล้ว** (ปิดภาพ = วางสาย) · อ่าน DB ไม่ได้ = คุยต่อแล้วตรวจรอบหน้า

### 5.2 ส่วนที่ต่างจาก reference (ปรับให้เข้ากับระบบเรา)

| เรื่อง | reference | ของเรา |
|---|---|---|
| ผู้ใช้ปัจจุบัน | `getCurrentUser()` จาก request context | `@CurrentUser() user: AuthUser` ส่งเข้า service |
| ข้อผิดพลาด | `HttpException` + ข้อความไทย | `AppException(status, code, message)` → `{ statusCode, code, message, correlationId }` (§5.4) |
| scope | `DataScopeService` ระดับบริษัท | ไม่มี — web ทุก role scope `all` · `TEAM_LEADER` ไม่มี `streaming:talk` (และ `currentAccess` ของ streaming ปฏิเสธอยู่แล้ว) |
| ตรวจสิทธิ์สด | `PermissionCheckService` + ตาราง role-stream-access | `PermissionCheckService.roleGrants(roleId, roleCode)` แบบเดียวกับ `StreamingService.currentAccess` · `SUPER_ADMIN` bypass |
| auth กับ middleware | `DssAuth` (login + token cache) | `dssAuthorizationHeader(apiKey)` ทุกคำขอ รวม WS handshake |
| URL ของ middleware | env `TALK_API_URL` | ไม่มี env ใหม่ — `${DSS_BASE_URL}/api/v1/talk` (REST) และแปลง `http→ws`, `https→wss` สำหรับ `/{talkId}/audio` |
| driver | env `TALK_PROVIDER_DRIVER` | ตาม `DSS_DRIVER` (`dss` = middleware · `mock` = echo ของ reference **สำหรับ automated test เท่านั้น**) · จาก UI ใช้ได้เฉพาะ `dss` เพราะ talk ต้องมีภาพสด และ `LiveStreamProvider.requestLive` ต้องการ `DSS_DRIVER=dss` · เครื่อง dev ทดสอบผ่าน VPN กับ middleware จริง (DL63) · ไม่ทำภาพสดจำลอง |
| `TalkIdle` | ต่อท้าย scheduler sweep ทุก 60 วินาที | `setInterval` 30 วินาทีใน `TalkService` ของโปรเซส `api` (`unref`) แบบเดียวกับ `StreamingService.expireIdle` — ปิดสาย `REQUESTED` / `ACTIVE` ที่ `LastAccessAt` (หรือ `RequestedAt`) เก่ากว่า 60 วินาที + `provider.stop()` · แก้ Part 2 ที่เขียนว่าอยู่ใน worker `media` |
| timeout | env stream timeout | `DSS_TIMEOUT_MS` (ค่าเดิม 10 วินาที) สำหรับ stop / WS handshake · start ใช้ 30 วินาทีคงที่ |

### 5.3 สิทธิ์ภาพสดของ dialog

ตอนนี้ `/streams/live`, `/streams/sessions`, `/streams/:token/stop` และ `currentAccess` ต้องมีทั้ง `streaming:view-live` **และ** `streaming:live-wall`
(เขียนมาสำหรับภาพสดหลายจออย่างเดียว) · Part 5 กำหนดให้ต้องมีแค่ `streaming:view-live`
⇒ แก้ให้ตรง Part 5: 3 endpoint + `currentAccess` ใช้ `streaming:view-live` อย่างเดียว · หน้า `/live-wall` ยังต้องมี `streaming:live-wall` (ตรวจที่ route / เมนูฝั่ง client ตามเดิม) ·
`TEAM_LEADER` ยังถูกปฏิเสธใน `currentAccess` จนถึง P5
ผลจริงวันนี้ไม่เปลี่ยน: ทุก role ที่มี `view-live` บน web มี `live-wall` ด้วย

### 5.4 API (ตรง Part 5 §5.3)

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/api/talk/sessions` `{ streamSessionToken }` | `streaming:talk` · `@Audit('START_TALK', 'TalkSessions')` | ตอบ 200 `{ talkSessionId, wsUrl, uplinkSampleRate, downlinkSampleRate, frameMs, maxSeconds }` · body เป็น camelCase (reference ใช้ `StreamSessionToken`) |
| POST | `/api/talk/sessions/:id/stop` | ไม่มี `@RequirePermission` (เจ้าของสายวางสายได้เสมอแม้ถูกถอดสิทธิ์) · `@Audit('STOP_TALK', 'TalkSessions')` | สายของคนอื่น = 404 · เรียกซ้ำได้ · ตอบ `{ talkSessionId, status, endReason, durationSeconds }` |
| WS | `/api/talk/ws?ticket=` | ticket | ticket ผิด / หมดอายุ / ใช้แล้ว = รับ upgrade แล้วปิด 4401 |

รหัสข้อผิดพลาด (การตัดสินของผู้ออกแบบ — builder ปรับชื่อได้ถ้ามีรหัสเดิมที่ตรงกว่า):

| สถานะ | `code` | เมื่อ |
|---|---|---|
| 403 | `FORBIDDEN` | role ไม่มี `streaming:talk` ณ ตอนนี้ |
| 403 | `STREAMING_DISABLED` | `streaming.enabled` = false |
| 403 | `DEVICE_STREAM_DISABLED` | กล้องปิด streaming / retired |
| 404 | `TALK_LIVE_NOT_FOUND` | token ไม่ใช่ภาพสด `ACTIVE` ของผู้ใช้เอง |
| 404 | `TALK_NOT_FOUND` | stop สายที่ไม่ใช่ของตัวเอง / ไม่มี |
| 409 | `TALK_DEVICE_BUSY` | ผู้อื่นคุยกับกล้องนี้อยู่ (ข้อความมีชื่อผู้นั้น) หรือ middleware ตอบ 1004 |
| 409 | `TALK_ALREADY_STARTING` | สายของตัวเองบนกล้องนี้ยัง `REQUESTED` |
| 409 | `TALK_USER_BUSY` | ผู้ใช้มีสายเปิดอยู่กับ **กล้องอื่น** (เช่น อีกแท็บ) — "วางสายที่คุยอยู่ก่อน" · สายเดิมบนกล้องเดียวกันยังถูกปล่อยอัตโนมัติตาม reference |

**กล้องที่มีคนคุยอยู่ (ปรับ DL62 ข้อ 3)**: ระบบไม่รู้ล่วงหน้าว่ากล้องว่างไหม (ไม่มี endpoint / event ใหม่) — ผู้ใช้กด เริ่มคุย แล้วได้ 409 `TALK_DEVICE_BUSY`
⇒ `TalkControl` แสดง "มีผู้ใช้อื่นกำลังพูด (ชื่อ)" ข้างปุ่ม และปุ่มยังกดซ้ำได้เพื่อลองใหม่เมื่ออีกฝ่ายวางสาย
(DL62 เดิมเขียนว่าปุ่มกดไม่ได้ก่อนกด ซึ่งต้องมี endpoint ตรวจสถานะหรือ snapshot ที่ค้างได้ · กรณีสองคนคุยกล้องเดียวกันเกิดน้อย)
| 502 | `TALK_START_FAILED` | middleware ตอบ 1001 / 1002 / 1003 / 5000 / timeout — ข้อความไทยตาม `TALK_MESSAGE` ของ reference · ไม่ส่งข้อความดิบจาก middleware |

### 5.5 ฐานข้อมูล — migration `0014_p4_talk`

- ตาราง `TalkSessions` ตาม spec ต้นแบบ §"ตาราง TalkSessions" ทุกคอลัมน์และ index
  (`IX_Talk_Device`, `IX_Talk_User`, `UX_Talk_Device_Open (DeviceId) WHERE Status IN (1,2)`, `UX_Talk_Ticket`) — ตรงกับ Part 4
  + **เพิ่ม** `UX_Talk_User_Open (UserId) WHERE Status IN (1,2)` — 1 สายต่อผู้ใช้ (ชน = 409 `TALK_USER_BUSY`) · แถวค้างจากแท็บที่หายไปถูกปิดโดย relay (WS ปิด) หรือ `TalkIdle` ภายใน 60 วินาที
- setting `streaming.talk-max-seconds` ค่าเริ่มต้น 600 ขอบเขต 60–3600 (`SETTING_DEFAULTS` + `SETTING_BOUNDS` + data migration แบบ idempotent
  เหมือนแถว streaming ใน `0013`) · ส่งเป็น `maxSeconds` ให้ middleware ซึ่งตัดสายเองเมื่อครบ
- permission `streaming:talk` และ grant มีแล้วใน `0003` / `0011` — ไม่ต้องเพิ่ม
- retention `TalkSessions` 12 เดือนตาม Part 4 — job ลบอยู่ใน P6 ตามเดิม

### 5.6 อื่น ๆ

- `ws` + `@types/ws` เป็น dependency ตรงของ server แบบ pin exact (ตอนนี้มาทางอ้อมจาก socket.io)
- `TalkModule` import ใน `AppModule` · โปรเซส worker ก็โหลด `AppModule` ด้วย (`worker.module.ts`) ⇒ relay ต้องไม่ทำอะไรเมื่อไม่มี HTTP adapter (แบบ reference) · `TalkIdle` รันได้ทั้งสองโปรเซสโดยไม่ชนกัน (UPDATE แบบมีเงื่อนไข)
- ไม่มี Socket.IO event ใหม่
- ไม่ log / ไม่เก็บเสียง · ไม่ log ticket, JWT, talkId เต็ม

## 6. Client

### 6.1 port จาก reference

`client/src/features/talk/` ทั้งโฟลเดอร์: `talk.api.ts`, `talkRules.ts`, `useTalkSession.ts`, `TalkControl.tsx`, `TalkWaveform.tsx`, `waveformLevels.ts`,
`audio/*` (capture / playback worklet, resampler, jitter buffer, pcm, downlink, talkAudio) + tests + `src/test/talkFakes.ts`
ปรับ: เรียก API ผ่าน `@/lib/apiClient` ของเรา · อ่าน error จาก `{ code, message }` ผ่าน `@/lib/apiError` · body `{ streamSessionToken }` ·
URL ของ WS สร้างจาก origin ของหน้า (หรือ origin ของ `VITE_API_BASE` เมื่อเป็น URL เต็ม เหมือน `realtimeUrl.ts`) · i18n th/en ทุกข้อความ

### 6.2 `LiveStreamDialog`

port `features/streaming/components/LiveStreamDialog.tsx` (ไม่มี prop `playback` รอบนี้) — หัว dialog = ชื่อกล้อง + รหัส · `StreamPlayer` ·
footer ซ้าย = `TalkControl` (ปุ่มเริ่มคุย / ยกเลิกระหว่างเชื่อมต่อ / วางสาย · นาฬิกา · waveform · คำแนะนำใช้หูฟัง) · ขวา = ปิด ·
ระหว่างคุยบังคับ mute เสียง HLS (`forceMuted`) · ปิด dialog = วางสาย + ปิดภาพ · ผู้ใช้ไม่มี `streaming:talk` = ซ่อน / ปิดปุ่มตาม `talkBlockerOf`

### 6.3 จุดเปิดภาพสด

| จุด | ปุ่ม | แสดงเมื่อ |
|---|---|---|
| การ์ดกล้องบนแผนที่ติดตาม (`tracking/components/CameraCard.tsx`) | **ดูสด** (ข้างปุ่มประวัติเส้นทาง) | `platformState` = online และผู้ใช้มี `streaming:view-live` |
| หน้า ใบงาน — คอลัมน์กล้อง (`WorkOrderCameraList` แบบย่อ) | ปุ่มไอคอน ดูสด ต่อกล้อง | กล้องหาเจอ (`deviceId`) + online + `streaming:view-live` |
| รายละเอียดใบงาน (`WorkOrderCameraList` แบบเต็ม) | ปุ่ม ดูสด ต่อกล้อง | เงื่อนไขเดียวกัน |
| ภาพสดหลายจอ | แผง talk ของจอที่เลือก (port ส่วน talk ของ `LiveWallPage` reference) · จอที่คุย = ป้าย "กำลังคุย" · ระหว่างคุยทุกจอ mute | ผู้ใช้มี `streaming:talk` |

online = ค่าที่หน้านั้นมีอยู่แล้ว (snapshot ตอนเปิดหน้า / cache สถานะ DL35, DL45) — ปุ่มไม่ซ่อนตัวเองแบบ realtime ·
กล้องออฟไลน์จริงตอนกด = `StreamPlayer` แสดงข้อผิดพลาดตามเดิม

### 6.4 อื่น ๆ

- `vite.config.ts`: proxy `/api/talk/ws` แบบ `ws: true` ไป `http://localhost:3000` (วางก่อน `/api`)
- ทุกจุดใช้ `useTalkSession` ตัวเดียวกัน ⇒ ภาพสดหลายจอคุยได้ทีละจอ · dialog คุยได้กับกล้องของ dialog · ข้ามแท็บกันที่ server (`TALK_USER_BUSY`)
- ข้อความ UI ไม่เอ่ยถึงแหล่งข้อมูล (DL64)
- ไมค์ใช้ได้เฉพาะ secure context (HTTPS หรือ `localhost`) — production ผ่าน HTTPS ของ ingress

## 7. การทดสอบ

- server unit: port `talk-constants.test`, `talk-frames.test`, `talk-ticket.test`, `provider/*.test`
- server integration (`DSS_DRIVER=mock` ตาม `int-setup.ts`): port `talk.int-test`, `talk-relay.int-test`, `talk-http.int-test`, `talk-idle.int-test`,
  `talk-permission.int-test`, `talk-sessions-schema.int-test` — ปรับให้ใช้ `createTestUsers` / `resetDevices` / `recordingGateway` ของเรา ·
  เพิ่ม: ปิดภาพสดแล้วสายถูกตัดภายในรอบ revalidate · `/streams/live` ใช้ได้ด้วย `streaming:view-live` อย่างเดียว
- client: port tests ของ `features/talk` · `LiveStreamDialog` · ปุ่มดูสดบน `CameraCard` และ `WorkOrderCameraList` (แสดง / ซ่อนตามสถานะและสิทธิ์) ·
  แผง talk ของภาพสดหลายจอ
- ทดสอบจริง (`DSS_DRIVER=dss` ผ่าน VPN · กล้อง `1000027`): ผู้ออกแบบตรวจว่า start ตอบ, WS ต่อติด, มี frame ขาลง ·
  **ผู้ใช้ตรวจด้วยหู** — ต้องมีคนอยู่ข้างกล้องฟังเสียงที่พูดและพูดกลับ จากทั้ง 3 จุด และปิด dialog แล้วสายจบ

## 8. เอกสารที่ต้องอัปเดต

Part 2 (`TalkIdle` อยู่ใน `api`) · Part 4 (`TalkSessions` สร้างแล้ว migration `0014`) · Part 5 (`/talk/sessions/:id/stop`, รหัสข้อผิดพลาด, `/streams/*` ใช้ `view-live`) ·
Part 6 (ปุ่มดูสดบนการ์ดแผนที่และหน้า ใบงาน) · Part 8 (สถานะ P4) · Part 9 §9.5 **DL86 (Q62)** และแก้ DL62 ข้อ 3 (กล้องที่มีคนคุย = แจ้งหลังกด) · Part 4 (`UX_Talk_User_Open`) · README ถ้าสรุปตรงไหนกระทบ ·
runbook `local-dev.md` (ทดสอบ talk บนเครื่อง dev) · `CLAUDE.md` (สถานะ P4 + migration 0014)

## 9. ความเสี่ยง

- **echo** — โทรต่อเนื่องและเล่นเสียงผ่าน WebAudio ซึ่ง AEC ของ browser อาจไม่ตัด ⇒ คำแนะนำใช้หูฟังบนจอ (เหมือน reference)
- เริ่มคุยใช้เวลา ~11 วินาที (ข้อจำกัดของ DSS) — UI ต้องแสดงสถานะ "กำลังเชื่อมต่อ" และให้ยกเลิกได้
- ช่อง Nest ↔ middleware เป็น HTTP / WS ธรรมดา (PSD Server เครื่องเดียวกับ K8s) — เสียงสนทนาวิ่งบนเครือข่ายภายใน · ตรวจอีกครั้งตอน deploy (spec ต้นแบบข้อ 8)
- middleware รันได้ instance เดียว — ถ้ามันล่ม สายทั้งหมดจบด้วย 4005 และเริ่มใหม่ไม่ได้จนกว่าจะกลับมา

## 10. ปล่อยให้ builder ตัดสิน

- โครงไฟล์ / ชื่อฟังก์ชันภายใน · ตัดส่วนของ reference ที่ผูกกับบริษัท / role-stream-access ออก
- ข้อความไทยของสถานะ talk (ใช้ของ reference เป็นหลัก)
- ตำแหน่งและขนาดปุ่มตาม `client/DESIGN.md`
