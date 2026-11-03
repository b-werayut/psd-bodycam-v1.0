# Part 9 — Risks & Open Questions

---

## 9.1 Technical Risks

| # | Risk | ผลกระทบ | โอกาส | Mitigation |
|---|---|---|---|---|
| R1 | **Booking job ไม่มี identifier ที่ map เป็นทีม/หัวหน้าทีมได้** | สูง — matching อัตโนมัติทำไม่ได้ เหลือ manual link | กลาง | ถามทีม Booking ก่อนเริ่ม P3 (§9.4) · รองรับทั้ง `BookingTeamRef` (ทีม/รถ/กะ) และ `BookingEmployeeRef` · วัด match rate ตั้งแต่ pilot · manual link เป็น fallback ที่ใช้งานได้จริง |
| R2 | **Online ≠ กำลังใช้งาน** (กล้องชาร์จค้าง/เปิดทิ้งที่ฐาน) | WO ขยะ / alert รบกวน | สูง | `workorder.create-when-unmatched` ปิดได้ · 1 WO unlinked ต่อทีม (`UQ_WO_OpenUnlinkedPerTeam`) · idle close · classify "ชาร์จ/ทดสอบ" · (ภายหลัง) geofence ฐาน + heuristic จาก recording |
| R3 | **Throughput ของ DSS `/location`** (ต่อเครื่อง ~51s/78 เครื่อง ⇒ ~3.3 นาที/300 เครื่อง) | ตำแหน่ง/สถานะช้า | สูง | ใช้ DSS device list เป็น bulk status feed (ต้องยืนยันว่า real-time) · ขอ batch location endpoint จากทีม middleware · GPS poll แยกจาก status poll |
| R4 | เวลาของสถานะ = เวลาที่ระบบได้รับ ไม่ใช่เวลาที่อุปกรณ์เปลี่ยน | เวลาเริ่ม/จบ session คลาดเคลื่อน ≤ 1 รอบ poll | แน่นอน | ระบุใน UI ("โดยประมาณ") · `StartInferred` · เปิด BRMS MQ เพื่อลด latency |
| R5 | ผูกกล้องสำรองผิดทีม | หลักฐานผิดงาน (compliance) | กลาง | กล้องสำรองต้องผูกด้วย Temporary assignment · heuristic แนะนำเท่านั้น ไม่ผูกอัตโนมัติ · alert `CAMERA_ACTIVE_NO_TEAM` |
| R6 | Retention วิดีโอบน DSS สั้นกว่าความต้องการหลักฐาน | ดูย้อนหลังไม่ได้ | ไม่ทราบ | ยืนยัน retention DSS · export MP4 สำหรับงานสำคัญ · `RecordingSegments` บอกว่ามีไฟล์ช่วงไหน |
| R7 | Managed Postgres ไม่มี `btree_gist` | ไม่มี exclusion constraint | ต่ำ | fallback: partial unique + ตรวจ overlap ใต้ row lock (Part 4 §4.6) |
| R8 | ข้อมูล Booking เปลี่ยนหลัง WO ปิด | ใบงานไม่ตรง Booking | กลาง | `NeedsReview` + alert · ต้องมีเจ้าของคิว (Open Question) |
| R9 | DSS HLS ไม่ตรง spec (iOS AVPlayer — ระบุใน `docs/NEXT-STEPS.md` ของ reference) | mobile เล่นวิดีโอไม่ได้ | กลาง | ทดสอบ iOS เร็ว · ทางเลือก MediaMTX relay |
| R10 | Redis เป็น single point (realtime, lock, queue, breaker) | realtime/queue หยุด | ต่ำ–กลาง | Redis persistence + HA (Sentinel/managed) · health check · tracking หยุด sweep อย่างปลอดภัยเมื่อไม่มี lock |
| R11 | PDPA: GPS และวิดีโอเป็นข้อมูลส่วนบุคคลของพนักงาน | ความเสี่ยงกฎหมาย | กลาง | retention ชัดเจน · audit การดู/export ทุกครั้ง · least privilege · DPIA · redact `BookingJobs.Raw` |
| R12 | ระบบเดิมกับระบบใหม่ poll DSS พร้อมกันช่วงเปลี่ยนผ่าน | โหลด DSS middleware เพิ่มเท่าตัว | กลาง | ตกลงช่วง parallel run · ปิด GpsPoll/CameraSession ของระบบเดิมเมื่อ cut-over |
| R13 | ข้อมูลนำเข้าจากระบบเดิมไม่สะอาด (`CompanyId = null`, demo accounts) | ข้อมูลเพี้ยนตั้งแต่วันแรก | กลาง | import แบบ dry-run + รายงาน · ไม่นำ demo accounts (`EMP-DEMO-*`) |
| R14 | ความรู้เชิงกติกาฝังอยู่ใน `CLAUDE.md` 400KB ของ reference | port แล้วหลุดกติกาสำคัญ | กลาง | port test ของ module ที่ reuse มาด้วย · Part 1 §1.7 สรุปบทเรียนหลัก |
| R15 | Clock ของอุปกรณ์เพี้ยน | GPS อนาคต/อดีตผิด | ต่ำ | ปฏิเสธเวลาอนาคตเกิน 2 นาที · ตัดสินสถานะด้วย DB clock เท่านั้น |

---

## 9.2 Open Business Rules

| # | คำถาม | ค่าที่ออกแบบไว้ชั่วคราว | กระทบ |
|---|---|---|---|
| Q1 | Booking `Completed` ปิด WO อัตโนมัติไหม | ปิด (`workorder.close-on-booking-completed = true`) | lifecycle |
| Q2 | หัวหน้าทีมปิด WO ก่อน Booking ได้ไหม · ต้องแจ้งกลับ Booking ไหม | ปิดได้ · write-back ปิดไว้ | outbox |
| Q3 | ค่า tolerance: debounce 5 นาที · merge gap 15 นาที · window ±60 นาที · ช่วงขยาย 3 ชม. | ตามนี้ (ปรับใน Settings) | matching |
| Q4 | กล้องสำรอง: ผูกทีมไว้ล่วงหน้า หรือผูกตอนใช้ · หัวหน้าทีมผูกเองในแอปได้ไหม | Admin/Supervisor/Dispatcher ผูกเป็น Temporary ตอนใช้ | P1/P5 |
| Q5 | กล้องเปิดค้างข้ามงาน A→B ให้ระบบสลับใบงานอัตโนมัติตามเวลาในแผนได้ไหม | ได้ (`matching.auto-switch-enabled`) + flag ตรวจสอบ | matching |
| Q6 | Booking ยกเลิกงานที่มีการใช้กล้องแล้ว ทำอย่างไร | WO `Cancelled` + review ถ้ามี recording | lifecycle |
| Q7 | ใครเป็นเจ้าของคิวตรวจสอบ (Unlinked / Ambiguous / NeedsReview) และ SLA | Dispatcher ของแผนก | process |
| Q8 | หัวหน้าทีมยืนยัน "ระบบแนะนำ" เองได้ไหม | ยังไม่เปิด (`work-orders:confirm-own`) | mobile |
| Q9 | ใคร reopen ได้ ภายในกี่ชั่วโมง | Admin/Supervisor ภายใน 72 ชม. | permission |
| Q10 | 1 คนอยู่ได้ทีมเดียวใช่ไหม · เปลี่ยนหัวหน้าทีมมีผลเมื่อไร | ทีมเดียว · มีผลทันที (`effectiveAt` ได้) | teams |
| Q11 | กล้องเปิดแต่ไม่พบ Booking ให้สร้าง WO Unlinked หรือเก็บเป็น session รอ | สร้าง (`workorder.create-when-unmatched = true`) | R2 |
| Q12 | Retention: GPS / status / WO / audit (PDPA) และ retention วิดีโอบน DSS | GPS 12 เดือน · WO ≥ 5 ปี · audit 24 เดือน | Part 4 §4.5 |
| Q13 | ย้ายข้อมูลอะไรจากระบบเดิม (อุปกรณ์/พนักงาน/ผู้ใช้/ประวัติ GPS/ใบงาน CAM) · ระบบเดิมจะปิดเมื่อไร หรือรันคู่กัน | ย้าย master data เท่านั้น · ไม่ย้ายประวัติ | P6, R12 |
| Q14 | Check-in/out หน้างาน (รอทีม Booking) — ถ้ามี จะเป็นสัญญาณยืนยัน match ที่แรงที่สุด | ไม่อยู่ในขอบเขต · โครงสร้างรองรับ | P5+ |
| Q15 | มีช่วงเวลาที่ไม่ควรเปิด session เลยไหม (เช่น นอกเวลางาน, ที่ฐาน) | ไม่มี | R2 |
| Q16 | โครงสร้างแผนกและการแบ่งสิทธิ์ (Supervisor เห็นแผนกย่อยด้วยไหม) | เห็น subtree | scope |
| Q17 | "แอดมินระบบ" ที่ปิดใบงานได้ หมายถึง role `ADMIN` อย่างเดียว หรือรวม Supervisor/Dispatcher ด้วย | `ADMIN` อย่างเดียว (เปิดเพิ่มได้ผ่าน role-permission matrix) | permission |
| Q18 | ลูกทีม (ไม่ใช่หัวหน้า) ต้องมีบัญชีใช้แอปไหม | ไม่ — แอปสำหรับหัวหน้าทีมเท่านั้น | mobile, users |

---

## 9.3 Assumptions ที่ใช้ในเอกสาร (ต้องยืนยัน)

| # | Assumption | ถ้าไม่จริง |
|---|---|---|
| A1 | ใช้ DSS middleware + BRMS ชุดเดิม และ provider ของ reference ใช้ต่อได้ | ต้องเขียน provider ใหม่ (port interface เดิมไว้แล้ว) |
| A2 | DSS device list คืน status ที่สดพอเป็น bulk status feed | status poll ต้องพึ่ง `/location` รายเครื่อง (ช้า — R3) |
| A3 | Postgres 16 managed รองรับ `btree_gist` และ partition | ใช้ fallback (R7) |
| A4 | Booking มี REST query ตามช่วงเวลา หรือ changed-since | ใช้ CSV import ระหว่างรอ |
| A5 | Booking job มี planned start/end | ใช้ทั้งวัน + confidence MEDIUM |
| A6 | กล้องทุกตัวเป็น bodycam channel เดียว | ต้องเพิ่ม channel ใน session/recording |
| A7 | ใช้ Microsoft Entra tenant เดิม | ปรับค่า config เท่านั้น |

---

## 9.4 Booking Information Checklist

ข้อมูลที่ต้องได้จากทีม Booking **ก่อนเริ่ม P3c** (และควรได้ก่อน P3a เพื่อให้ mock ใกล้ของจริง):

**API & Environment**
- [ ] Base URL ของ dev / staging (sandbox) / production
- [ ] วิธี authenticate (OAuth2 client credentials / API key / mTLS) · อายุ token · การ rotate
- [ ] Rate limit · pagination (cursor/page) · ขนาด page สูงสุด
- [ ] SLA / uptime / maintenance window · ช่องทางติดต่อเมื่อมีปัญหา
- [ ] รูปแบบ error response · การ versioning ของ API

**Job data**
- [ ] ตัวอย่าง payload จริง (redact) ของงานทุกสถานะ
- [ ] identifier ถาวรของงาน (`externalJobId`) และเลขที่แสดงผล
- [ ] **งานถูกมอบให้อะไร: ทีม / หัวหน้าทีม / คนขับ / ทะเบียนรถ / พนักงานหลายคน** และรหัสที่ใช้ (ตรงกับรหัสพนักงาน HR ไหม)
- [ ] เวลาเริ่ม/จบตามแผน · timezone · งานหลายวันมีไหม
- [ ] รายการสถานะทั้งหมด + transition · Booking รายงานเวลาเริ่ม/เสร็จจริงไหม
- [ ] สถานที่ (ชื่อ/ที่อยู่/พิกัด) มีไหม
- [ ] การยกเลิก/ลบงานแสดงอย่างไร (soft delete? หายไปจาก API?)
- [ ] มี field version / updatedAt / etag สำหรับตรวจข้อมูลใหม่กว่าไหม
- [ ] งานเดียวเปลี่ยนทีมกลางทางได้ไหม

**Change feed**
- [ ] มี endpoint changed-since ไหม
- [ ] มี webhook ไหม: event อะไรบ้าง · signing · retry policy · ordering · event id
- [ ] check-in/check-out ฝั่ง Booking (ถ้ามี) ส่งมาให้ได้ไหม

**Write-back**
- [ ] Booking รับข้อมูลจากเราได้ไหม: เลข WO, สถานะ, เวลาเริ่ม/จบจากกล้อง, ลิงก์หลักฐาน
- [ ] รองรับ `Idempotency-Key` ไหม

**Data governance**
- [ ] field ไหนเป็นข้อมูลส่วนบุคคล (ลูกค้า/ผู้ติดต่อ) · ระบบเราเก็บได้แค่ไหน
- [ ] retention ที่ Booking คาดหวังจากฝั่งเรา

---

## 9.5 Decision Log (ที่ตัดสินแล้วในการออกแบบนี้)

| # | Decision | เหตุผล | ใครตัดสิน |
|---|---|---|---|
| DL1 | Booking เป็นต้นทางใบงานเดียว — ไม่มี flow สร้าง/อนุมัติ/มอบหมาย | ลดขนาดระบบ · ไม่มีสองแหล่งความจริง | ผู้ใช้ |
| DL2 | 1 Booking = 1 WO · หลาย session ต่อ WO | | ผู้ใช้ |
| DL3 | บริษัทเดียว + แผนก | | ผู้ใช้ |
| DL4 | เก็บ mobile API (my-jobs, FCM, device registry) ไม่มี PIN | | ผู้ใช้ |
| DL5 | เก็บ MP4 export, live wall, talk, Entra SSO | | ผู้ใช้ |
| DL6 | Modular monolith + process roles | ขนาดทีม/ระบบ · reuse | ผู้ออกแบบ |
| DL7 | แยก TrackingSession ออกจาก WorkOrder · ไม่มี pseudo work order | แก้ design smell ของ reference | ผู้ออกแบบ |
| DL8 | Session engine แบบ level-triggered sweep + DB constraint | self-healing, idempotent | ผู้ออกแบบ |
| DL9 | Matching อ่าน local projection ไม่เรียก Booking สด | Booking ล่มไม่กระทบ · อธิบายย้อนหลังได้ | ผู้ออกแบบ |
| DL10 | `WorkOrders.BookingJobId` nullable (ไม่ใช่ NOT NULL) | requirement ให้รองรับ WO ที่ยัง link ไม่ได้ | ผู้ออกแบบ ตาม requirement |
| DL11 | UNKNOWN คำนวณจากอายุข้อมูล ไม่เขียน null | บทเรียน `clearPlatformStatuses()` ของ reference | ผู้ออกแบบ |
| DL12 | API ใช้ camelCase ทั้งหมด | ลดความสับสนของ reference ที่ปน 2 แบบ | ผู้ออกแบบ |
