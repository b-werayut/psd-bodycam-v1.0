# Part 9 — Risks & Open Questions

> ปรับตามคำตอบของผู้ใช้ 2026-11-04 (2 รอบ), 2026-11-09 (DL33–DL36) และ 2026-11-12 (DL46–DL49: Smart Booking push + mobile หัวหน้าทีม + login / เจ้าของแอปมือถือ + ยึด [requirement ฉบับ 2026-11-12](../requirements/2026-11-12-body-camera-requirements.md)) — คำถามที่ตอบแล้วอยู่ใน Decision Log (§9.5) · **ทั้งหมดอาจเปลี่ยนตามข้อมูลจากทีม Smart Booking** (ผู้ใช้ระบุ)

---

## 9.1 Technical Risks

| # | Risk | ผลกระทบ | โอกาส | Mitigation |
|---|---|---|---|---|
| R1 | **Booking ไม่ส่ง check-in/check-out, POST มาแค่ตอนสร้างใบงาน หรือไม่ระบุกล้องในใบงาน** — ใบงานและการผูกกล้องมาจาก Booking เท่านั้น (Q20, DL33) · ถ้า Smart Booking POST แค่ตอนสร้าง สถานะใบงานจะไม่เปลี่ยนตาม check-in/out (DL46) | สูงมาก — ใบงาน สถานะใบงาน และการจับคู่ทั้งระบบพึ่งข้อมูลนี้ | กลาง | ถามทีม Booking ก่อนเริ่ม P3c (§9.4 ข้อสำคัญที่สุด) · ส่ง contract v1 (Part 7 §7.2) ให้ Booking ใช้ POST ทุกครั้งที่ใบงานเปลี่ยน · พัฒนาบน mock / `booking-simulator` ไปก่อน (Q14) · session ที่จับคู่ไม่ได้ค้าง `AwaitingMatch` และ rematch อัตโนมัติเมื่อ Booking แก้ข้อมูล · หลักฐานยังเปิดได้จากค้น recording รายกล้อง (`/recordings`) · `SafetyTimeout` 7 วันกันใบงานค้าง |
| R2 | **ตรวจ "กล้องชาร์จที่ฐาน" ได้ไม่ครบตอนเปิด session** — vendor ไม่มี charging state (Q21) และกล้องในอาคารมักไม่มี GPS | session ขยะค้าง `AwaitingMatch` + alert เกินจริง · ไม่เกิดใบงานขยะแล้ว (ระบบไม่สร้างใบงานเอง — DL33) | สูง | ตรวจ 2 ชั้น: `Depots` + fix ล่าสุด ⇒ session ได้ `IdleOrCharging` (ระบบตั้งเอง) · session ที่ตรวจไม่เจอ attach ได้เฉพาะเมื่อตรงงานใน Booking |
| R3 | **Throughput ของ DSS `/location`** (ต่อเครื่อง ~51s/78 เครื่อง ⇒ ~3.3 นาที/300 เครื่อง) | สถานะและตำแหน่งช้าได้ระดับนาทีเมื่อกล้องเยอะ — `/location` เป็นแหล่งสถานะเดียว (DL32) | สูง | GpsPoll concurrency 8 · ขอ batch location endpoint จากทีม middleware · session ใช้ debounce 15 นาทีจึงรับความช้าระดับนาทีได้ · หน้าจอดึงสถานะสดจาก DSS ตอนเปิดดู (DL35) ผ่าน cache Redis 10s กันการยิง DSS ซ้ำเมื่อหลายคนเปิดพร้อมกัน (DL45) |
| R4 | เวลาของสถานะ = เวลาที่ระบบได้รับ ไม่ใช่เวลาที่อุปกรณ์เปลี่ยน | เวลาเริ่ม/จบ session คลาดเคลื่อน ≤ 1 รอบ poll | แน่นอน | ระบุใน UI ("โดยประมาณ") · `StartInferred` |
| R5 | Booking ระบุกล้องสำรองผิดหรือช้า | หลักฐานอยู่ผิดใบงาน หรือยังไม่ผูกใบงานชั่วคราว | กลาง | session ค้าง `AwaitingMatch` / `NoTeam` + alert `CAMERA_ACTIVE_NO_TEAM` · rematch อัตโนมัติเมื่อ Booking แก้ข้อมูล (ภายใน `booking.rematch-horizon-hours`) · `MappingIssues` UnknownDeviceRef |
| R6 | **Retention 3 เดือน** (ใบงาน + วิดีโอ DSS) สั้นกว่าความต้องการหลักฐานบางกรณี (ข้อร้องเรียน/คดี) | ข้อมูลหายก่อนต้องใช้ | กลาง | แสดงวันที่จะถูกลบในหน้าใบงาน · export MP4 แล้วดาวน์โหลดเก็บนอกระบบก่อนครบกำหนด (ไฟล์ export อยู่บน PVC แค่ 24 ชม. — DL34) |
| R7 | Managed Postgres ไม่มี `btree_gist` | ไม่มี exclusion constraint | ต่ำ | fallback: partial unique + ตรวจ overlap ใต้ row lock (Part 4 §4.6) |
| R8 | ข้อมูล Booking เปลี่ยนหลัง WO ปิด | session ที่ผูกไว้อาจไม่ตรงงานแล้ว | กลาง | ข้อมูลใบงานอัปเดตตาม Booking เอง (upsert 1:1) · badge `NeedsReview` (BookingChangedAfterClose) ในหน้าใบงาน + alert Admin · ไม่มีคิวตรวจสอบ (DL33) |
| R9 | DSS HLS ไม่ตรง spec (iOS AVPlayer — ระบุใน `docs/NEXT-STEPS.md` ของ reference) | แอปมือถือของหัวหน้าทีมเล่น live ไม่ได้ (live เป็น 1 ใน 2 ฟังก์ชันหลักของ mobile — DL47) | กลาง | ทดสอบ iOS เร็ว · ทางเลือก MediaMTX relay |
| R10 | Redis เป็น single point (realtime, lock, queue, breaker, cache สถานะกล้อง) | realtime/queue หยุด | ต่ำ–กลาง | Redis persistence + HA · health check · tracking หยุด sweep อย่างปลอดภัยเมื่อไม่มี lock · cache สถานะกล้อง fail-open: ถาม DSS ตรง (DL45) |
| R11 | PDPA: GPS และวิดีโอเป็นข้อมูลส่วนบุคคลของพนักงาน | ความเสี่ยงกฎหมาย | กลาง | retention 3/12 เดือน (ยืนยันแล้ว) · audit การดู/export ทุกครั้ง · least privilege · redact `BookingJobs.Raw` |
| R12 | ระบบเดิมกับระบบใหม่ poll DSS พร้อมกัน (ระบบเดิมยังรันอยู่) | โหลด DSS middleware เพิ่มเท่าตัว | กลาง | ตกลงกับทีม DSS เรื่อง capacity · ปิด GpsPoll/CameraSession ของระบบเดิมสำหรับกล้องที่ย้ายมาระบบใหม่ |
| R13 | Smart Booking ล่มนาน หรือส่ง POST ไม่สำเร็จแล้วไม่ retry ⇒ ไม่รู้ check-out และไม่มีใบงานใหม่เข้ามา (push — DL46) | ใบงานค้าง Open · session ใหม่ค้าง `AwaitingMatch` จนกว่า Booking ส่งข้อมูลมา · POST ที่หายไปเราไม่รู้ตัว | กลาง | ขอ Booking retry ≥ 24 ชม. + ส่งซ้ำได้ (§9.4) · alert `BOOKING_INBOUND_SILENT` เมื่อไม่มี POST เกิน `booking.inbound-silence-alert-hours` · ถ้า Booking มี read API: full reconcile รายคืน (optional) · ปิดย้อนหลังด้วยเวลา check-out จริงเมื่อข้อมูลมาถึง แล้ว rematch session ที่ค้างภายใน `booking.rematch-horizon-hours` (72 ชม.) · `SafetyTimeout` 7 วัน |
| R14 | ความรู้เชิงกติกาฝังอยู่ใน `CLAUDE.md` 400KB ของ reference | port แล้วหลุดกติกาสำคัญ | กลาง | port test ของ module ที่ reuse มาด้วย · Part 1 §1.7 สรุปบทเรียนหลัก |
| R15 | Clock ของอุปกรณ์เพี้ยน | GPS อนาคต/อดีตผิด | ต่ำ | ปฏิเสธเวลาอนาคตเกิน 2 นาที · ตัดสินสถานะด้วย DB clock เท่านั้น |
| R16 | PVC ของไฟล์ export ต้อง mount ได้ทั้ง `api` และ `worker-media` (DL34) | ดาวน์โหลดไม่ได้ถ้า pod อยู่คนละ node และ PVC เป็น ReadWriteOnce | ต่ำ (ตอนนี้ node เดียว — DL44) | ตอนนี้ PSD Server เป็น node เดียว ⇒ ReadWriteOnce ใช้ได้ · ถ้าเพิ่ม node ภายหลัง: ตกลงกับ infra เรื่อง access mode (ReadWriteMany) หรือ pod affinity · ทดสอบใน staging ก่อน P4 จบ |
| R17 | **PSD Server เครื่องเดียว** รัน Kubernetes `team3` + PostgreSQL / Redis / PVC + DSS middleware (DL44) = single point of failure | เครื่องล่ม / disk เต็ม ⇒ ทั้งระบบหยุด (Dahua DSS Platform ยังบันทึกวิดีโอต่อ เพราะอยู่คนละเครื่อง) | ต่ำ–กลาง | backup PostgreSQL ไปเก็บนอกเครื่อง (pg_dump / WAL) + ทดสอบ restore · VM snapshot · monitor disk (PVC + partition GPS) · `requests` / `limits` ตาม DL39 · แผนเพิ่ม node ภายหลัง (PVC → ReadWriteMany, R16) |
| R18 | **Endpoint รับ POST จาก Smart Booking เปิดให้ระบบภายนอกเรียก** (DL46) | ถูกยิงด้วย payload ปลอม / flood ⇒ ใบงานผิด หรือ api ช้า | ต่ำ–กลาง | HMAC-SHA256 + timestamp ±300s (หรือ API key) · secret 2 ชุดหมุนได้ไม่ downtime · IP allowlist (`BOOKING_INBOUND_ALLOWED_CIDRS`) · rate limit `booking-inbound` · body ≤ 256 KB · api แค่ตรวจแล้วเขียน inbox (ไม่แตะ `WorkOrders`) · ไม่ log secret / body เต็ม |
| R19 | **หัวหน้าทีมใช้แอปมือถือ** (DL47) — บัญชีภาคสนามจำนวนมาก, เครื่องหาย, เปลี่ยนหัวหน้าทีมบ่อย | เห็นใบงาน / live ของทีมอื่น หรือคนที่พ้นตำแหน่งยังดู live ได้ | กลาง | scope `team` คำนวณจาก `TeamMembers` ณ ตอน request (เปลี่ยนหัวหน้ามีผลทันที — DL22) · live ตรวจสิทธิ์สด (`hasPermissionNow`) · ระงับบัญชี / ถอนเครื่อง (`UserDevices.IsRevoked`) ตัด session ทันที · audit ทุกการเปิด live |

---

## 9.2 Open Business Rules

**ไม่มีคำถามค้างกับผู้ใช้แล้ว** (ตอบครบ 2026-11-04 · ปรับเพิ่ม 2026-11-09 DL33–DL36 · 2026-11-12 DL46–DL49 — ดู §9.5) · OQ1 (login หัวหน้าทีม) และ OQ2 (ใครพัฒนาแอปมือถือ) ตอบแล้ว 2026-11-12 ⇒ DL49

สิ่งที่ยังรออยู่เป็น **ข้อมูลจากทีมภายนอก** ซึ่งระหว่างรอใช้ mock ไปก่อน:

| เรื่อง | รอจาก | ระหว่างรอ |
|---|---|---|
| ตกลง contract การ POST ใบงาน (Part 7 §7.2) · POST ทุกครั้งที่ใบงานเปลี่ยนไหม · ความหมาย DO / SH · รูปแบบ check-in/check-out · การระบุกล้องในใบงาน · ref ทีม/หัวหน้าทีม · วิธี auth และ retry (§9.4) | ทีม Smart Booking | contract v1 ของเรา + `booking-simulator` + mock (Q14, DL46) |
| พิกัดฐาน/จุดชาร์จจริง | ผู้ใช้/ฝ่ายปฏิบัติการ | พิกัด mock หลายจุด (Q22) |
| ตั้ง retention วิดีโอ 3 เดือนบน DSS | infra | — |

---

## 9.3 Assumptions ที่ใช้ในเอกสาร (ต้องยืนยัน)

| # | Assumption | ถ้าไม่จริง |
|---|---|---|
| A1 | ใช้ DSS middleware ชุดเดิม (ไม่ใช้ BRMS MQ — DL30) และ provider ของ reference ใช้ต่อได้ · **[Confirmed]** middleware = `psd-bwc-dss-services` (FastAPI) ซึ่งเรียก Dahua DSS Platform อีกชั้น — token ของ DSS อยู่ใน middleware · HLS ชี้กลับมาที่ `/proxy` ของ middleware · talk เป็น RTSP ระหว่าง middleware กับ DSS (reference `docs/LIVE-STREAMING-CONTRACT.md`) | ต้องเขียน provider ใหม่ (port interface เดิมไว้แล้ว) |
| A2 | `/location` ของ DSS middleware คืน `status` (online/offline) มาพร้อม GPS ทุกครั้ง | ต้องกลับไปใช้ DSS device list (`GET /api/v1/devices`) เป็นแหล่งสถานะ |
| A3 | Postgres 16 managed รองรับ `btree_gist` และ partition | ใช้ fallback (R7) |
| A4 | **Smart Booking POST ใบงานเต็มใบมาทุกครั้งที่ใบงานเปลี่ยน** (สร้าง, check-in, check-out, ยกเลิก, แก้ไข) ตาม contract v1 (Part 7 §7.2) และ retry เมื่อเราไม่ตอบ 2xx — **[Confirmed]** เฉพาะ "POST เมื่อสร้างใบงาน" (DL46) | POST แค่ตอนสร้าง ⇒ สถานะใบงานไม่เปลี่ยนตาม check-in/out จนกว่าจะมี read API ให้ดึง (`fetchJob` / reconcile) · ไม่ retry ⇒ POST ที่หายกู้ได้เฉพาะ Booking ส่งซ้ำหรือ reconcile (R13) · payload ไม่ใช่ v1 ⇒ เขียน mapper `smart-booking` (P3c) |
| A5 | Booking job มี planned start/end | ใช้ทั้งวัน + confidence MEDIUM |
| A6 | กล้องทุกตัวเป็น bodycam channel เดียว | ต้องเพิ่ม channel ใน session/recording |
| A7 | ใช้ Microsoft Entra tenant เดิม | ปรับค่า config เท่านั้น |
| A8 | **Booking ส่งเวลา check-in/check-out ต่อใบงาน** | สถานะใบงานต้องพึ่ง Booking status (Completed) แทน · ถ้าไม่มีทั้งคู่ ใบงานปิดด้วย `SafetyTimeout` เท่านั้น (ระบบนี้ไม่มีการปิดด้วยมือ — DL33) |
| A9 | **Booking ระบุกล้องที่ใช้กับงานได้** (`DeviceRefs`) และ/หรือมีข้อมูลกล้องประจำทีม | การผูกกล้องมาจาก Booking เท่านั้น (Q20) ⇒ ถ้าไม่มี ทุก session ค้าง `NoTeam` / `AwaitingMatch` ไม่มีใบงาน (ไม่มีการ link ด้วยมือ — DL33) · ดูหลักฐานได้จากค้น recording รายกล้อง (`/recordings`) เท่านั้น |
| A10 | **Booking ส่งแผนกเจ้าของงานมากับทุกใบงาน** (`departmentRef`) | ใบงานเข้าแผนก root เห็นเฉพาะ ADMIN (scope `all`) + `MappingIssues` จนกว่าจะ map ได้ |
| A11 | ใบงานมีเลข **DO** และ **SH** (ผู้ใช้ยืนยันว่ามี) — ความหมายคาดว่าเป็นเลข Delivery Order / Shipment **[Assumption]** · ใช้แสดงผลและค้นหาเท่านั้น ไม่ใช้จับคู่กล้อง | แก้ label ใน UI · ถ้าเป็นตัวระบุทีม/กล้อง ต้องเพิ่มเป็น matching key (Part 3 §3.3.1) |
| A12 | Smart Booking มี read API (`GET /jobs/{jobId}`, `GET /jobs?from&to`) ให้ใช้ refresh รายใบและ reconcile รายคืน (optional — DL46) | `BOOKING_PROVIDER_DRIVER=none` ⇒ ไม่มีปุ่ม refresh และไม่มี reconcile · พึ่ง POST อย่างเดียว |
| A13 | หัวหน้าทีม 1 คน = หัวหน้า 1 ทีม ณ เวลาหนึ่ง และ Booking ระบุทีม / หัวหน้าทีมในใบงาน (`teamRef` / `leaderRef`) — ใช้คำนวณ scope `team` ของแอปมือถือ (DL47) | ใบงานที่ไม่มีทีม / หัวหน้าทีม ไม่ขึ้นในแอปของใคร (เว็บยังเห็นตามแผนก) |

---

## 9.4 Booking Information Checklist

ข้อมูลที่ต้องได้จากทีม Booking **ก่อนเริ่ม P3c** (ระหว่างรอพัฒนาบน mock — Q14):

**สำคัญที่สุด (ระบบพึ่งข้อมูลนี้)**
- [ ] **POST ทุกครั้งที่ใบงานเปลี่ยน** (DL46): นอกจากตอนสร้างใบงาน Smart Booking POST ใบงานเต็มใบมาอีกไหมเมื่อ check-in / check-out / ยกเลิก / แก้ไข — ถ้าส่งแค่ตอนสร้าง สถานะใบงานจะไม่เปลี่ยนตาม Booking (R1)
- [ ] **check-in / check-out**: มีเวลาต่อใบงานไหม · ส่งเป็น event หรือ field · ใครกดได้ (หัวหน้าทีม/แอดมิน) · check-in ซ้ำหลัง check-out ได้ไหม · แก้เวลาย้อนหลังได้ไหม
- [ ] **DO / SH**: คืออะไร (Delivery Order / Shipment?) · ใบงานหนึ่งมีได้กี่เลข · ซ้ำข้ามใบงานได้ไหม (A11)
- [ ] **กล้องที่ใช้กับงาน** (แหล่งเดียวของการผูกกล้อง — Q20): ใบงานระบุกล้องได้ไหม (รวมกล้องสำรองที่เปลี่ยนกลางงาน) · ใช้รหัสอะไร (DeviceCode / Serial / รหัส DSS) · มีข้อมูล "กล้องประจำทีม" ให้ sync ไหม
- [ ] **งานถูกมอบให้อะไร**: ทีม / หัวหน้าทีม / คนขับ / ทะเบียนรถ และรหัสที่ใช้ (ตรงกับรหัสพนักงาน HR ไหม)
- [ ] **แผนกเจ้าของงาน** (`departmentRef`): ส่งมากับทุกใบงานได้ไหม · ใช้รหัสอะไร (ตรงกับรหัสแผนกของเราไหม) — ใช้คุม data scope ของใบงาน (DL38)

**การ POST ใบงานเข้าระบบเรา (push — DL46)** — contract v1 อยู่ใน Part 7 §7.2
- [ ] ส่ง body ตาม contract v1 ได้ไหม · ถ้าไม่ได้ ขอ schema + ตัวอย่าง payload จริงทุกสถานะ (เราเขียน mapper `smart-booking` ให้)
- [ ] ลงนาม HMAC-SHA256 (`X-Booking-Timestamp` + `X-Booking-Signature`) ได้ไหม · ถ้าไม่ได้ใช้ `X-Api-Key` · ช่องทางส่ง secret และรอบ rotate
- [ ] IP ขาออกของ Smart Booking (ใส่ allowlist + เปิด firewall ขาเข้า) · Smart Booking อยู่ on-premise หรือ cloud
- [ ] **retry**: ไม่ได้ 2xx / timeout แล้วลองใหม่ไหม · backoff · นานสุดเท่าไร (ขอ ≥ 24 ชม.) · ถือ `200 duplicate` เป็นสำเร็จ
- [ ] มี `eventId` ไม่ซ้ำต่อการส่ง และ `version` / `updatedAt` ที่เพิ่มทุกครั้งที่ใบงานเปลี่ยนไหม (ใช้กันข้อมูลเก่าทับใหม่)
- [ ] ส่งซ้ำ (resend) ใบงานย้อนหลังตามที่ขอได้ไหม — ใช้กู้ POST ที่หาย
- [ ] URL ปลายทางของเราแยก dev / staging / production · มี sandbox ฝั่ง Booking ให้ทดสอบยิงไหม
- [ ] SLA / maintenance window · ช่องทางติดต่อเมื่อมีปัญหา

**Read API (optional — A12)**
- [ ] มี `GET /jobs/{jobId}` และ `GET /jobs?from&to` (แบ่งหน้า) ให้เราใช้ refresh รายใบ / reconcile รายคืนไหม · auth (OAuth2 client credentials / API key / mTLS) · rate limit

**Job data**
- [ ] ตัวอย่าง payload จริง (redact) ของงานทุกสถานะ
- [ ] identifier ถาวรของงาน (`externalJobId`) และเลขที่แสดงผล
- [ ] เวลาเริ่ม/จบตามแผน · timezone · งานหลายวันมีไหม
- [ ] รายการสถานะทั้งหมด + transition
- [ ] สถานที่ (ชื่อ/ที่อยู่/พิกัด) มีไหม
- [ ] การยกเลิก/ลบงานแสดงอย่างไร (soft delete? หายไปจาก API?)
- [ ] มี field version / updatedAt / etag สำหรับตรวจข้อมูลใหม่กว่าไหม
- [ ] งานเดียวเปลี่ยนทีม/กล้องกลางทางได้ไหม

**สถานะปลายทางของใบงาน**
- [ ] งานที่ไม่เคยถูก check-in เลย Booking POST สถานะ Completed หรือ Cancelled มาไหม (ใบ `Planned` ของเราปิดตาม Booking เท่านั้น — DL37)
- [ ] งานที่ถูกลบใน Booking POST มาเป็นสถานะยกเลิกไหม (ห้ามหายไปเฉย ๆ)

**Deep link (แทน write-back — DL31, ยังใช้ตาม DL46)**
- [ ] Booking app ใส่ลิงก์ `https://{host}/work-orders/by-booking/{externalJobId}` ในหน้าใบงานได้ไหม · ใครในฝั่ง Booking จะกดเปิด (ต้องมีบัญชีเว็บ `ADMIN` / `OPERATOR` / `VIEWER` ในระบบนี้ — หัวหน้าทีมใช้แอปมือถือ ไม่มีหน้าเว็บ DL47)

**Data governance**
- [ ] field ไหนเป็นข้อมูลส่วนบุคคล (ลูกค้า/ผู้ติดต่อ) · ระบบเราเก็บได้แค่ไหน

**ทีม DSS / infra (แยกจาก Booking)**
- [ ] ตั้ง retention วิดีโอ 3 เดือนบน DSS
- [ ] capacity ของ DSS middleware เมื่อระบบเดิมและระบบใหม่ poll พร้อมกัน (R12)

---

## 9.5 Decision Log (ที่ตัดสินแล้วในการออกแบบนี้)

| # | Decision | เหตุผล | ใครตัดสิน |
|---|---|---|---|
| DL1 | Booking เป็นต้นทางใบงานเดียว — ไม่มี flow สร้าง/อนุมัติ/มอบหมาย | ลดขนาดระบบ · ไม่มีสองแหล่งความจริง | ผู้ใช้ |
| DL2 | 1 Booking = 1 WO · หลาย session ต่อ WO | | ผู้ใช้ |
| DL3 | บริษัทเดียว + แผนก · Operator เห็นแผนกย่อย (Q16) | | ผู้ใช้ |
| DL4 | Mobile API สำหรับ **Operator/Admin/Viewer** (monitoring + ตรวจหลักฐาน) · FCM · device registry · ไม่มี PIN · ไม่มี my-jobs | ผู้ใช้แอปคือฝั่งตรวจสอบ ไม่ใช่ภาคสนาม (Q18) · **แก้โดย DL47**: แอปมือถือเป็นของหัวหน้าทีม (`TEAM_LEADER`) เท่านั้น — live กล้องของตัวเอง + รายละเอียดใบงาน · FCM / device registry / ไม่มี PIN ยังใช้ | ผู้ใช้ |
| DL5 | เก็บ MP4 export, live wall, talk, Entra SSO | ยืนยันอีกครั้งโดย DL48: talk และ GPS history เป็นฟีเจอร์ที่ต้องมี แม้ requirement ฉบับ 2026-11-12 ระบุเป็น Optional | ผู้ใช้ |
| DL6 | Modular monolith + process roles | ขนาดทีม/ระบบ · reuse | ผู้ออกแบบ |
| DL7 | แยก TrackingSession ออกจาก WorkOrder · ไม่มี pseudo work order | แก้ design smell ของ reference | ผู้ออกแบบ |
| DL8 | Session engine แบบ level-triggered sweep + DB constraint | self-healing, idempotent | ผู้ออกแบบ |
| DL9 | Matching อ่าน local projection ไม่เรียก Booking สด | Booking ล่มไม่กระทบ · อธิบายย้อนหลังได้ | ผู้ออกแบบ |
| DL10 | `WorkOrders.BookingJobId` nullable · เปิดกล้องแต่ไม่พบ Booking ให้สร้างใบงานไว้ก่อน (Q11) | requirement + ผู้ใช้ยืนยัน · **แก้โดย DL33**: `BookingJobId` NOT NULL · ระบบไม่สร้างใบงานเอง · session ที่ไม่พบ Booking ค้าง `AwaitingMatch` | ผู้ใช้ |
| DL11 | UNKNOWN คำนวณจากอายุข้อมูล ไม่เขียน null | บทเรียน `clearPlatformStatuses()` ของ reference | ผู้ออกแบบ |
| DL12 | API ใช้ camelCase ทั้งหมด | ลดความสับสนของ reference ที่ปน 2 แบบ | ผู้ออกแบบ |
| DL13 | ผู้ปิดใบงาน = หัวหน้าทีมและแอดมิน **โดยทำ check-out ฝั่ง Booking** | ผู้ใช้ยืนยันว่า "ปิดได้ทั้งหัวหน้าทีมและแอดมินระบบ" และ "สถานะอ้างอิง check-in/check-out ของ Booking" | ผู้ใช้ |
| DL14 | Role เหลือ 3 ตัว: `ADMIN`, `OPERATOR` (รวม Supervisor + Dispatcher เดิม), `VIEWER` · void = `ADMIN` เฉพาะใบที่ไม่ผูก Booking · audit log = `ADMIN` (Q19) | ไม่มีงานสร้าง/อนุมัติ/มอบหมายใบงาน · ไม่มีผู้ใช้ภาคสนามในระบบนี้ · **แก้โดย DL33** (ส่วน void): ไม่มี void แล้ว — ทุกใบผูก Booking · **แก้โดย DL47** (ส่วนผู้ใช้ภาคสนาม): เพิ่ม role ที่ 4 `TEAM_LEADER` (scope `team`, mobile เท่านั้น) · 3 role เว็บคงชื่อเดิม ไม่ใช้คำว่า Safety (DL48) | ผู้ใช้ |
| DL15 | **สถานะใบงานตาม Booking check-in/check-out**: check-out ⇒ Closed · check-in ใหม่ ⇒ reopen · ไม่มีปุ่มปิด/reopen/ยืนยันสถานะในระบบนี้ · การเปิดดูใบงานทำได้ตลอดภายใน retention (Q1, Q2, Q8, Q9) | | ผู้ใช้ |
| DL16 | ไม่มี role หัวหน้าทีมในระบบนี้ · หัวหน้าทีมใช้ Booking app · ทีม/หัวหน้าทีมยังเก็บเป็นข้อมูลเพื่อจับคู่ (Q18) | **แก้โดย DL47**: หัวหน้าทีมมีบัญชีในระบบนี้ (role `TEAM_LEADER`) ใช้แอปมือถือ · check-in / check-out ยังทำใน Booking app เหมือนเดิม | ผู้ใช้ |
| DL17 | กล้องต้องเปิดต่อเนื่อง ≥ 15 นาทีจึงนับเป็นงาน · งานที่ยังไม่ check-out ถือเป็นใบเดิม แม้กล้องดับไปชาร์จแล้วเปิดใหม่ · window ±60 นาที · แนะนำได้ถึง 3 ชม. (Q3) | | ผู้ใช้ |
| DL18 | กล้องชาร์จที่ฐานไม่เปิดใบงาน (Q15) — vendor ไม่มี charging state (Q21) จึงตรวจ 2 ชั้น: `Depots` + fix ล่าสุด · auto-void ใบรวมที่ไม่มี recording | วิธีตรวจ = ผู้ออกแบบ · **แก้โดย DL33** (ส่วน auto-void): ไม่มีใบรวมให้ void · session ที่ฐานได้ `IdleOrCharging` | ผู้ใช้ + ผู้ออกแบบ |
| DL19 | ไม่ย้ายข้อมูลจากระบบเดิม — ระบบเดิมเป็น reference เท่านั้น (Q13) | | ผู้ใช้ |
| DL20 | Retention: GPS 3 เดือน · ใบงาน 3 เดือน · audit log 12 เดือน · วิดีโอ DSS 3 เดือน (infra จัดการ) · ไม่มี archive (Q12) | | ผู้ใช้ |
| DL21 | **การผูกกล้องกับงาน/ทีม (รวมกล้องสำรอง) มาจาก Booking เท่านั้น** — `DeviceRefs` ในใบงาน และ/หรือ sync กล้องประจำทีม · ระบบเราไม่มีหน้าจอผูกกล้อง (Q4, Q20) | ข้อมูลกล้องตรงกันระหว่าง 2 ระบบ | ผู้ใช้ |
| DL22 | สลับงานอัตโนมัติ A→B + flag (Q5) · Booking ยกเลิก ⇒ "ยกเลิกโดย Booking" และตรวจหลักฐานได้ (Q6) · Operator เป็นเจ้าของคิวตรวจสอบ (Q7) · 1 คน 1 ทีม เปลี่ยนหัวหน้ามีผลทันที (Q10) | **แก้โดย DL33** (ส่วนคิวตรวจสอบ): ไม่มีคิวตรวจสอบ · Operator ไม่มีหน้าที่ link / classify | ผู้ใช้ |
| DL23 | ใบรวม: poll Booking ต่อเนื่อง ถ้าไม่มีข้อมูลที่ตรงกันภายใน **240 นาที** นับจากเปิด ⇒ ปิด (`NoBookingData`) · ผูก Booking แล้วไม่มี check-out **36 ชม.** ⇒ alert · ไม่มี check-out **7 วัน** ⇒ ปิดอัตโนมัติ (`SafetyTimeout`) (Q23) | **แก้โดย DL33** (ส่วน 240 นาที): ไม่มีใบรวมและ `NoBookingData` แล้ว · alert 36 ชม. และ `SafetyTimeout` 7 วันยังใช้ | ผู้ใช้ |
| DL24 | SLA คิวตรวจสอบ **36 ชม.** — เกินแล้ว alert Operator + Admin (Q7) | **แก้โดย DL33**: ไม่มีคิวตรวจสอบและ SLA · `NeedsReview` เหลือเป็น badge ในหน้าใบงาน + alert Admin | ผู้ใช้ |
| DL25 | พัฒนา Booking integration บน **mock adapter ก่อน** รอ spec จากทีม Booking (Q14) | | ผู้ใช้ |
| DL26 | ฐาน/จุดชาร์จรองรับหลายจุด · ใช้พิกัด mock ไปก่อน (Q22) | | ผู้ใช้ |
| DL27 | กล้องที่ Booking ยังไม่ผูกกับทีม/งาน ⇒ สร้าง **ใบรวมของกล้อง** (`TeamId` ว่าง) + alert · link ได้เมื่อ Booking ส่งข้อมูล · ใบรวมที่ปิดด้วย `NoBookingData` เข้าคิวตรวจสอบ | ทำให้ Q11 (สร้างใบงานไว้ก่อน) กับ Q20 (ผูกกล้องจาก Booking เท่านั้น) ใช้ร่วมกันได้ · **แก้โดย DL33**: ไม่มีใบรวม · session ค้าง `AwaitingMatch` / `NoTeam` รอ Booking | ผู้ออกแบบ |
| DL28 | auto-void ใบรวมที่ไม่มี recording · ใบรวมที่ปิดด้วย `NoBookingData` ⇒ `NeedsReview` (เข้าคิว SLA 36 ชม.) | ทำให้คิวตรวจสอบไม่ถูกข้ามเพราะใบรวมปิดเร็ว · **แก้โดย DL33**: ไม่มี auto-void และคิวตรวจสอบ | ผู้ออกแบบ |
| DL29 | deploy ตาม topology ของระบบเดิมที่รันอยู่ (`psd-bwc-frontend`): ingress → nginx ของ `web` → proxy `/api/`, `/api/talk/ws`, `/socket.io/` ไป API ด้วย `BACKEND_URL` (แทน ingress แยก path ตามแบบเดิมของ Part 2 §2.3) | ใช้ pipeline / gitops ชุดเดียวกับระบบเดิมได้ · same-origin ไม่ต้องตั้ง cookie ข้ามโดเมน | ผู้ใช้ |
| DL30 | **ไม่ใช้ BRMS MQ** — สถานะกล้องมาจาก DSS เท่านั้น (StatusPoll device list + GpsPoll `/location`) · ไม่ port `device-status-mq` · enum `StateSource` = 3 (BrmsMq) สงวนไว้ ห้ามใช้เลขซ้ำ | รู้กล้องหลุด/กลับมาช้าลงได้ถึง 1 รอบ poll (30 วินาที) · **แก้โดย DL32**: ตัด StatusPoll เหลือ GpsPoll อย่างเดียว | ผู้ใช้ |
| DL31 | **เชื่อม Booking แบบ pull อย่างเดียว**: change feed ทุก 2 นาที (ตัวหลัก) + full reconcile รายคืน 02:00 / หลัง breaker ปิด + `fetchJob` จากปุ่ม refresh · **ไม่รับ webhook จาก Booking** (ตัด `POST /integration/booking/webhooks`, HMAC ขาเข้า, rate limit `booking-webhook`) · **ไม่ส่ง write-back** (ตัด `IntegrationOutbox`, job `booking-outbox`, `OutboxDispatcher`, `pushEvent`, flag `booking.writeback-enabled`) · Booking app เปิดดูหลักฐานผ่าน deep link `/work-orders/by-booking/{externalJobId}` · สเปก API ที่ขอจาก Booking อยู่ใน Part 7 §7.2.1 | งานหลักคือ live / playback / หลักฐาน — ใบงานช้า ~2 นาทีไม่กระทบ · ไม่ต้องเปิด endpoint สาธารณะหรือดูแล secret ขาเข้า · ทีม Booking ทำแค่ API ให้ดึง · เพิ่ม event แบบ `{ eventId, jobId, version }` ได้ภายหลังถ้าต้องการความเร็ว · **แก้โดย DL46**: Smart Booking POST ใบงานเข้ามาเอง · ตัด change feed 2 นาที · read API เหลือเป็น optional · ยังไม่ส่ง write-back และยังใช้ deep link | ผู้ใช้ |
| DL32 | **สถานะกล้องมาจาก GpsPoll อย่างเดียว** — `/location` ของ DSS middleware ให้ทั้ง GPS และ online/offline ในรอบเดียว (ทุก 15 วินาที, concurrency 8) · ตัด `StatusPoll` (DSS device list), setting `status.poll-interval-seconds` และ device webhook `/integration/webhooks/device-*` (DSS ไม่มี push อยู่แล้ว) · enum `StateSource` 1 (DssDeviceList) และ 4 (Webhook) สงวนไว้ ห้ามใช้เลขซ้ำ · แก้ DL30 | poll ชุดเดียว ระบบเรียบง่ายกว่า · ยอมให้สถานะช้าได้ระดับนาทีเมื่อกล้องเยอะ (R3) เพราะสถานะบนหน้าจอดึงจาก DSS ตอนเปิดดู และ session ใช้ debounce 15 นาที | ผู้ใช้ |
| DL33 | **ใบงานมาจาก Booking เท่านั้น — ระบบไม่สร้างใบงานเอง และไม่มีการผูกด้วยมือ**: inbox processor (worker `integration`) upsert `WorkOrders` 1:1 กับ `BookingJobs` ทันทีที่ sync — ไม่มีทางอื่นที่สร้างใบงาน · `BookingJobId` NOT NULL · `UQ_WO_BookingJob` เป็น unique ธรรมดา · สถานะตาม Booking เท่านั้น: Open / Closed / Cancelled (`Voided`, `Merged` และ CloseReason `NoBookingData` สงวนไว้ ห้ามใช้เลขซ้ำ) · alert 36 ชม. ไม่มี check-out และ `SafetyTimeout` 7 วันยังใช้ · matching อัตโนมัติอย่างเดียว: ได้ candidate เดียว ⇒ attach · ไม่มีหรือหลาย candidate ⇒ session ค้าง `AwaitingMatch` / `NoTeam` ไม่สร้างใบงาน แล้ว rematch อัตโนมัติเมื่อ Booking เปลี่ยน (ภายใน `booking.rematch-horizon-hours`) · ตัดใบรวม, ปิด `NoBookingData` 240 นาที, auto-void, `LinkStatus`, link / unlink / merge / void, คิวตรวจสอบ + SLA, classify ด้วยมือ (permission `work-orders:link`, `work-orders:void`, `sessions:classify`) · `NeedsReview` เหลือเป็น badge ในหน้าใบงาน + alert Admin · กล้องที่ฐาน ⇒ session `IdleOrCharging` (ระบบตั้งเองเท่านั้น) · session ที่ไม่มีใบงานดูจาก `/recordings` · Operator = เฝ้าดู (แผนที่, live, live wall, talk), playback / export หลักฐาน, จัดการทีม, รับทราบ alert · แก้ DL10, DL14 (void), DL18 (auto-void), DL22 (คิวตรวจสอบ), DL23 (240 นาที), DL24, DL27, DL28 | ผู้ใช้: "ข้อมูลใบงานทั้งหมดต้องอิงจาก booking จะไม่สร้างใบงานเอง" · session ที่จับคู่ไม่ได้ "รอ Booking อย่างเดียว" · ไม่มีสองแหล่งความจริง ไม่มีใบงานขยะ และไม่มีงาน manual ให้ Operator | ผู้ใช้ |
| DL34 | **ไฟล์ export MP4 เก็บบน Local disk (PVC) · ไม่ใช้ MinIO / object storage**: `STORAGE_DRIVER=local` mount ทั้ง `api` และ `worker-media` · `worker-media` เขียนไฟล์ · `api` stream ให้ดาวน์โหลดผ่าน download ticket · ลบไฟล์หลัง 24 ชม. (`EvidenceCleanup`) · แถว `EvidenceExports` เก็บ 12 เดือน · วิดีโอหลักฐานตัวจริงอยู่บน Dahua DSS Platform (retention 3 เดือน, infra) | ไฟล์ export เป็นสำเนาชั่วคราว — ต้นฉบับอยู่บน DSS · ไม่ต้องดูแล object storage เพิ่ม · ต้อง mount PVC ร่วมกัน (R16) | ผู้ใช้ |
| DL35 | **ไม่ push สถานะ online/offline แบบ real-time ไปหน้าจอ**: ตัด Socket.IO event `device:status` (และการ emit จาก `device-status`) · `DeviceState` ยังอัปเดตจาก GpsPoll และใช้ภายใน session engine · หน้าจอที่แสดงสถานะกล้อง (รายการ / รายละเอียดอุปกรณ์ / ก่อนเปิด live) ดึงสถานะจาก DSS ตอนเปิดผ่าน API (`api` → DSS middleware) · `gps:batch` และแผนที่ real-time คงเดิม · event อื่น (`session:*`, `workorder:changed`, `alert:new` …) คงเดิม | สถานะจาก GpsPoll ช้าได้ระดับนาที (R3, DL32) — ดึงจาก DSS ตอนเปิดหน้าจอได้ค่าสดกว่า · ลด event ที่ต้อง push | ผู้ใช้ |
| DL36 | **เมนูหลัก 2 เมนู: Live และ หลักฐาน**: (1) **Live** = `/live-wall` + ดูสดจากรายการอุปกรณ์ (streaming + talk) · (2) **หลักฐาน** `/evidence` (port `client/src/features/evidence` ของ reference): ตารางใบงาน (จาก Booking) → เลือกกล้อง + ช่วงเวลาจาก session ของใบงาน → playback / ดาวน์โหลด MP4 · export ใช้ซ้ำงานเดิมเมื่อกล้อง + channel + start/end ตรงกันทุกค่าและยัง queued / processing / ready ที่ยังไม่หมดอายุ ไม่งั้นสร้าง export job ใหม่ · `/recordings` คงไว้สำหรับค้นรายกล้อง (session ที่ไม่มีใบงาน) · ตัด `/work-orders/review` (DL33) | งานหลักของผู้ใช้คือดูสดและตรวจ / ส่งออกหลักฐาน | ผู้ใช้ |
| DL37 | **สถานะใบงาน `Planned` (รอเริ่ม) + MEDIUM ผูกอัตโนมัติ + หน้าแรกคง Dashboard**: ใบงานที่ sync มาแต่ยังไม่ check-in มีสถานะใหม่ `6 Planned` → check-in ⇒ Open → check-out ⇒ Closed · Booking ยกเลิก ⇒ Cancelled · ใบ Planned ปิดเมื่อ Booking ส่ง Completed / Cancelled เท่านั้น · alert 36 ชม. และ `SafetyTimeout` 7 วันนับจาก check-in (`OpenedAt`, null ขณะ Planned) · session ที่ได้ candidate เดียวแบบ MEDIUM (ช่วงขยาย ±3 ชม. หรือสถานะ Booking map ไม่ได้) attach อัตโนมัติเหมือน HIGH · AMBIGUOUS / NONE ยังรอ (`AwaitingMatch`) · หน้าแรก `/` = Dashboard เดิม เมนูหลัก Live + หลักฐานอยู่ใน nav (DL36) | แยกงานที่ยังไม่เริ่มออกจากงานที่กำลังทำ · ตัวนับ 36 ชม. / 7 วันไม่ปิดงานล่วงหน้าผิด · หลักฐานเข้าใบงานได้มากขึ้นโดยไม่มีคนต้องตรวจ | ผู้ใช้ |
| DL38 | **แผนกของใบงานมาจาก Booking**: Booking ส่ง `departmentRef` มากับทุกใบงาน → map ด้วย `Departments.BookingDepartmentRef` (คอลัมน์ใหม่ แบบเดียวกับ `Teams.BookingTeamRef`) → `BookingJobs.DepartmentId` → `WorkOrders.DepartmentId` (อัปเดตทุก sync) · map ไม่ได้ ⇒ แผนก root (เห็นเฉพาะ scope `all`) + `MappingIssues` 6 UnknownDepartmentRef + alert `BOOKING_MAPPING_ISSUES` | ใบงานทุกใบต้องมีแผนกเพื่อคุม data scope · ข้อมูลใบงานทั้งหมดอิง Booking (DL33) · เดิมใช้แผนกของทีม ซึ่งว่างเมื่อหาทีมไม่เจอ | ผู้ใช้ |
| DL39 | **คงการแยก process `api` / `worker-tracking` / `worker-integration` / `worker-media`** (ยืนยัน DL6) แม้รันบน server เครื่องเดียว · กันงานแปลงไฟล์แย่งเครื่องด้วย Kubernetes `resources` (`worker-media` มี limits · `api` มี requests) + env `EVIDENCE_EXPORT_CONCURRENCY` (default 1, ≤ 8) · คิวยาวให้เพิ่ม pod `worker-media` | export หลายไฟล์พร้อมกันต้องไม่ทำให้ api / live / แผนที่ช้า · แยก process กัน event loop, crash และ deploy · limit กันการแย่ง CPU / RAM / network / disk บนเครื่องเดียวกัน | ผู้ใช้ |
| DL40 | **ชื่อเรียก server กล้อง = "Dahua DSS Platform"** (VMS ของ Dahua) ไม่ใช่ "PSD DSS Server" · ความเป็นเจ้าของแสดงด้วยกลุ่ม **PSD on-premise** ใน diagram ที่ครอบ PSD Server (VM ที่รัน DSS middleware) กับ Dahua DSS Platform · IP ยังไม่ทราบ ใส่ `xxx.xxx.x.xx` ไว้ก่อน | ชื่อ vendor ตรงกับผลิตภัณฑ์ · ไม่ปนกับ PSD Server และ DSS middleware | ผู้ใช้ |
| DL41 | **Deploy ลง Kubernetes namespace `team3` เดิม** ร่วมกับระบบเดิม (`psd-bwc-*`) · namespace = พื้นที่ของทีม ไม่ใช่ชื่อระบบ · ชื่อ Deployment / Service ต้องไม่ชนของเดิม · `BACKEND_URL` = `http://<api-service>.team3.svc:3000` | ใช้ pipeline / gitops / สิทธิ์ของทีมชุดเดิมได้ทันที · แลกกับ quota ที่ใช้ร่วมกัน (ต้องตั้ง requests / limits ตาม DL39) | ผู้ใช้ |
| DL42 | **ชื่อระบบ = PSD Body worn camera** · ใช้ในเอกสาร diagram และ UI · repo / ชื่อโค้ดยังเป็น `psd-bodycam-v1.0` | ผู้ใช้กำหนดชื่อระบบ | ผู้ใช้ |
| DL43 | **ทั้งระบบรันบน PSD on-premise**: Kubernetes cluster (`team3`), data tier, PSD Server (VM Ubuntu · DSS middleware) และ Dahua DSS Platform อยู่ใน data center ของ PSD · ภายนอก: ผู้ใช้, Entra ID, FCM, Booking (**[Assumption]**), กล้อง (4G) · แสดงเป็นกลุ่ม PSD on-premise ใน infra diagram เท่านั้น (system diagram ไม่แสดงตำแหน่งติดตั้ง) | cluster เรียก DSS middleware ผ่าน IP ภายในได้ตรง · ต้องเปิด firewall ขาออกไป Entra / FCM / Booking | ผู้ใช้ |
| DL44 | **PSD Server เครื่องเดียว (VM Ubuntu)** รัน Kubernetes namespace `team3` (web / api / worker-\*), data tier (PostgreSQL / Redis / PVC) และ DSS middleware (systemd นอก K8s) · **Dahua DSS Platform อยู่คนละเครื่อง** (VM Windows · on-prem เหมือนกัน) | API ↔ DSS middleware ไม่ออก network · PVC ใช้ ReadWriteOnce ได้ · แลกกับ single point of failure (R17) | ผู้ใช้ |
| DL45 | **cache สถานะกล้องบนหน้าจอใน Redis** (ต่อ DL35): `api` เก็บสถานะ online / offline ที่ดึงจาก DSS ไว้ที่ key `device-status:{deviceId}` (prefix ต่อ environment) อายุ setting ใหม่ `status.display-cache-seconds` (default 10, 0–60, 0 = ไม่ cache) ใช้ร่วมทุก api pod · `GET /devices` อ่านแบบ `MGET` แล้วถาม DSS เฉพาะกล้องที่ไม่มีใน cache · response มี `platformStatusFetchedAt` · Redis ล่ม ⇒ ข้าม cache ถาม DSS ตรง (fail-open) · session engine ไม่ใช้ cache นี้ · **ไม่ใช้ Redis เป็น cache ข้อมูลทั่วไป** (ข้อมูลภายนอกเก็บเป็น projection ใน PostgreSQL) | DL35 ทำให้ทุกการเปิดหน้ารายการ / รายละเอียด / live wall ยิง DSS middleware ซึ่งช้าอยู่แล้ว (R3) · หลาย Operator เปิดพร้อมกันไม่ควรคูณโหลด · สถานะเก่าได้ ≤ 10s ยอมรับได้เพราะหน้าจอไม่ได้ push อยู่แล้ว | ผู้ใช้ + ผู้ออกแบบ (ค่า TTL) |
| DL46 | **Smart Booking POST ใบงานเข้ามาเอง (push) แทน pull**: endpoint ใหม่ `POST /api/integration/booking/jobs` บน process `api` (`@Public` + `BookingInboundAuthGuard` HMAC-SHA256 หรือ `X-Api-Key` · rate limit `booking-inbound` · body ≤ 256 KB) → ตรวจ DTO → `IntegrationInbox` (`Channel` 1 Push, dedupe `eventId` หรือ `{jobId}:{version ?? updatedAt}`) → ตอบ `202 accepted` / `200 duplicate` → queue `booking-inbox` → inbox processor (worker `integration`) upsert `BookingJobs` + `WorkOrders` 1:1 ตามเดิม · contract v1 เป็นของเรา (Part 7 §7.2) · ใบงานมี **DO / SH** (`BookingJobs.DoNo` / `ShNo` — ความหมาย [Assumption], ใช้แสดงผล + ค้นหา) และเวลา check-in / check-out · ตัด change feed 2 นาที, `fetchChangedSince`, `IntegrationSyncState.Cursor` (→ `LastReceivedAt`), setting `booking.sync-interval-seconds` · read API (`fetchJob`, reconcile รายคืน) เป็น optional ตาม `BOOKING_PROVIDER_DRIVER=none\|mock\|http` · `booking.stale-after-minutes` เปลี่ยนความหมายเป็นอายุ backlog ของ inbox · setting ใหม่ `booking.inbound-silence-alert-hours` (24) + alert 17 `BOOKING_INBOUND_SILENT` · แก้ DL31 | ผู้ใช้: "ฝั่ง booking จะทำการ post มาหากมีการสร้างใบงาน … จะไม่เป็นการ pull ทุก 2 นาทีแล้ว" · ใบงานเข้าระบบภายในวินาที · แลกกับ endpoint ที่ระบบภายนอกเรียกได้ (R18) และ POST ที่หายไปเรารู้ไม่ได้เอง (R13 — พึ่ง retry ของ Booking + alert 17) · POST ทุกครั้งที่ใบงานเปลี่ยน = [Assumption] (A4) | ผู้ใช้ (ตัวเลือก auth / response / setting = ผู้ออกแบบ) |
| DL47 | **แอปมือถือสำหรับหัวหน้าทีม**: role ใหม่ `TEAM_LEADER` + data scope ใหม่ `team` (ทีมที่ผู้ใช้เป็นหัวหน้าอยู่ — `Employees.UserId` → `TeamMembers` Leader ที่ active · ใบงานที่ `BookingJobs.TeamId` หรือ `LeaderEmployeeId` ตรง · กล้องของทีม + กล้องใน `DeviceRefs` ของใบงาน Planned / Open) · permission: `work-orders:read`, `booking:read`, `devices:read`, `streaming:view-live`, `notifications:read` · แอปทำ 2 อย่าง: live กล้องของตัวเอง + รายละเอียดใบงาน (`/mobile/me`, `/mobile/jobs`, `/mobile/jobs/:workOrderId`, `/streams/live`) · ไม่มี playback, GPS, สถานะกล้อง, user management บนมือถือ · `TEAM_LEADER` ไม่มีหน้าเว็บ · push FCM "ใบงานใหม่ของทีม" (ผู้ออกแบบ) · Socket.IO room `team:{id}` · ตัด `/mobile/overview` และแอปของ Operator/Admin/Viewer · แก้ DL4, DL14 (ส่วนผู้ใช้ภาคสนาม), DL16 | requirement ฉบับ 2026-11-12 §4: ผู้ใช้แอปคือหัวหน้าทีม · ฟังก์ชันอื่นอยู่บนเว็บ · วิธี login ของหัวหน้าทีม: ได้ทั้ง Entra และ password (DL49) | ผู้ใช้ (Q24) |
| DL48 | **ยึด [requirement ฉบับ 2026-11-12](../requirements/2026-11-12-body-camera-requirements.md) ทั้งฉบับ** (Q24 — ผู้ใช้ตอบ "ทั้งฉบับ") โดยมีข้อยกเว้น (Q25): (1) ชื่อ role ไม่ใช้คำว่า "Safety" — แอดมิน = `ADMIN`, ผู้จัดการแผนก/ฝ่าย = `OPERATOR` (scope แผนก), `VIEWER` คงไว้ · ไม่เปลี่ยนชื่อ role (2) **GPS History และ Two-way audio (talk) เป็นฟีเจอร์ที่ต้องมี** อยู่ใน P1 / P4 ตามเดิม (requirement §3.3 ระบุเป็น Optional) · Camera status monitoring อยู่บนเว็บเท่านั้น · รายละเอียด Smart Booking API ทุกข้อยังเป็น [Assumption] (requirement §8) | requirement ฉบับใหม่เป็นแหล่งความจริงของขอบเขต · ผู้ใช้: "ไม่ต้องมีคำว่า safety ก็ได้มันเฉพาะไป" และ "ข้อ 4 ต้องมี" | ผู้ใช้ |
| DL49 | **Login หัวหน้าทีม + เจ้าของแอปมือถือ** (ตอบ OQ1 = Q26, OQ2 = Q27): (1) หัวหน้าทีม login ได้**ทั้งสองแบบ** — มีบัญชี Microsoft Entra ⇒ Entra SSO (`POST /auth/azure`, match `AzureObjectId` แล้ว fallback email) · ไม่มี ⇒ **username/password แบบ reference** (`POST /auth/login`, `Users.PasswordHash` argon2, lockout ตาม Settings `auth.*`, JWT 15 นาที + refresh rotation แบบ body-mode ของ mobile) · บัญชีเดียวมีได้ทั้งสองทาง · `ADMIN` สร้างบัญชีใน User Management ผูกพนักงาน (`Employees.UserId`) และตั้งรหัสผ่านเริ่มต้นเมื่อไม่มี Entra (2) **แอปมือถือพัฒนาโดยทีมเราเอง** (ทีมเดียวกับ web / backend) · ฟังก์ชัน live + รายละเอียดใบงาน (DL47) เป็น**ขอบเขตเริ่มต้น** — ทีมปรับ / เพิ่ม / ลดฟังก์ชันได้เอง โดยเพิ่ม endpoint ใต้ `/api/mobile/*` และ permission ของ `TEAM_LEADER` ผ่าน data migration · ทุกฟังก์ชันยังผ่าน permission + scope `team` ของ backend · stack และที่เก็บโค้ดของแอป ทีมเลือกเอง (ไม่กระทบ backend) | ผู้ใช้: "รองรับทั้งสองแบบ หากไม่มี Microsoft Entra สามารถเข้างานระบบด้วย username/password ได้แบบระบบที่ ref" · "คนในทีม สามารถปรับแต่งหรือเพิ่ม ลด ฟังก์ชันได้หมด" · auth ของ reference มีทั้งสองทางอยู่แล้ว (Part 1 §1.3) จึงไม่ต้องสร้างใหม่ | ผู้ใช้ |
