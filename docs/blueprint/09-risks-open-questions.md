# Part 9 — Risks & Open Questions

> ปรับตามคำตอบของผู้ใช้ 2026-11-04 (2 รอบ) — คำถามที่ตอบแล้วอยู่ใน Decision Log (§9.5) · **ทั้งหมดอาจเปลี่ยนตามข้อมูลจากทีม Booking** (ผู้ใช้ระบุ)

---

## 9.1 Technical Risks

| # | Risk | ผลกระทบ | โอกาส | Mitigation |
|---|---|---|---|---|
| R1 | **Booking ไม่ส่ง check-in/check-out หรือไม่ระบุกล้องในใบงาน** — การผูกกล้องมาจาก Booking เท่านั้น (Q20) | สูงมาก — สถานะใบงานและการจับคู่ทั้งระบบพึ่งข้อมูลนี้ | กลาง | ถามทีม Booking ก่อนเริ่ม P3c (§9.4 ข้อสำคัญที่สุด) · พัฒนาบน mock ไปก่อน (Q14) · Operator link ด้วยมือในคิวตรวจสอบ · `SafetyTimeout` 7 วันกันใบงานค้าง |
| R2 | **ตรวจ "กล้องชาร์จที่ฐาน" ได้ไม่ครบตอนเปิด session** — vendor ไม่มี charging state (Q21) และกล้องในอาคารมักไม่มี GPS | ใบงานขยะ | สูง | ตรวจ 2 ชั้น: `Depots` + fix ล่าสุด · auto-void ใบรวมที่ไม่มี recording · 1 ใบรวมต่อทีม/กล้อง · ปิดใบรวมเมื่อไม่มีข้อมูล Booking 240 นาที |
| R3 | **Throughput ของ DSS `/location`** (ต่อเครื่อง ~51s/78 เครื่อง ⇒ ~3.3 นาที/300 เครื่อง) | ตำแหน่ง/สถานะช้า | สูง | ใช้ DSS device list เป็น bulk status feed (ต้องยืนยันว่า real-time) · ขอ batch location endpoint จากทีม middleware · GPS poll แยกจาก status poll |
| R4 | เวลาของสถานะ = เวลาที่ระบบได้รับ ไม่ใช่เวลาที่อุปกรณ์เปลี่ยน | เวลาเริ่ม/จบ session คลาดเคลื่อน ≤ 1 รอบ poll | แน่นอน | ระบุใน UI ("โดยประมาณ") · `StartInferred` · เปิด BRMS MQ เพื่อลด latency |
| R5 | Booking ระบุกล้องสำรองผิดหรือช้า | หลักฐานอยู่ผิดใบงานชั่วคราว | กลาง | session เข้าใบรวมของกล้อง + alert `CAMERA_ACTIVE_NO_TEAM` · re-match อัตโนมัติเมื่อ Booking แก้ข้อมูล · `MappingIssues` UnknownDeviceRef |
| R6 | **Retention 3 เดือน** (ใบงาน + วิดีโอ DSS) สั้นกว่าความต้องการหลักฐานบางกรณี (ข้อร้องเรียน/คดี) | ข้อมูลหายก่อนต้องใช้ | กลาง | แสดงวันที่จะถูกลบในหน้าใบงาน · export MP4 เก็บนอกระบบก่อนครบกำหนด |
| R7 | Managed Postgres ไม่มี `btree_gist` | ไม่มี exclusion constraint | ต่ำ | fallback: partial unique + ตรวจ overlap ใต้ row lock (Part 4 §4.6) |
| R8 | ข้อมูล Booking เปลี่ยนหลัง WO ปิด | ใบงานไม่ตรง Booking | กลาง | `NeedsReview` + alert · Operator เป็นเจ้าของคิว (SLA 36 ชม.) |
| R9 | DSS HLS ไม่ตรง spec (iOS AVPlayer — ระบุใน `docs/NEXT-STEPS.md` ของ reference) | แอปมือถือของ Operator เล่นวิดีโอไม่ได้ | กลาง | ทดสอบ iOS เร็ว · ทางเลือก MediaMTX relay |
| R10 | Redis เป็น single point (realtime, lock, queue, breaker) | realtime/queue หยุด | ต่ำ–กลาง | Redis persistence + HA · health check · tracking หยุด sweep อย่างปลอดภัยเมื่อไม่มี lock |
| R11 | PDPA: GPS และวิดีโอเป็นข้อมูลส่วนบุคคลของพนักงาน | ความเสี่ยงกฎหมาย | กลาง | retention 3/12 เดือน (ยืนยันแล้ว) · audit การดู/export ทุกครั้ง · least privilege · redact `BookingJobs.Raw` |
| R12 | ระบบเดิมกับระบบใหม่ poll DSS พร้อมกัน (ระบบเดิมยังรันอยู่) | โหลด DSS middleware เพิ่มเท่าตัว | กลาง | ตกลงกับทีม DSS เรื่อง capacity · ปิด GpsPoll/CameraSession ของระบบเดิมสำหรับกล้องที่ย้ายมาระบบใหม่ |
| R13 | Booking ล่มนาน ⇒ ไม่รู้ check-out · ใบรวมถูกปิดเพราะ "ไม่มีข้อมูล Booking" ทั้งที่ Booking แค่ล่ม | ใบงานค้าง Open / ใบรวมปิดเร็วเกิน | กลาง | ปิดย้อนหลังด้วยเวลา check-out จริงหลัง sync กลับ · ใบรวมที่ปิดแล้วยัง link ย้อนหลังได้ภายใน 72 ชม. · banner stale · `SafetyTimeout` 7 วัน |
| R14 | ความรู้เชิงกติกาฝังอยู่ใน `CLAUDE.md` 400KB ของ reference | port แล้วหลุดกติกาสำคัญ | กลาง | port test ของ module ที่ reuse มาด้วย · Part 1 §1.7 สรุปบทเรียนหลัก |
| R15 | Clock ของอุปกรณ์เพี้ยน | GPS อนาคต/อดีตผิด | ต่ำ | ปฏิเสธเวลาอนาคตเกิน 2 นาที · ตัดสินสถานะด้วย DB clock เท่านั้น |

---

## 9.2 Open Business Rules

**ไม่มีคำถามค้างกับผู้ใช้แล้ว** (ตอบครบ 2026-11-04 — ดู §9.5)

สิ่งที่ยังรออยู่เป็น **ข้อมูลจากทีมภายนอก** ซึ่งระหว่างรอใช้ mock ไปก่อน:

| เรื่อง | รอจาก | ระหว่างรอ |
|---|---|---|
| รูปแบบ check-in/check-out · การระบุกล้องในใบงาน · ref ทีม/หัวหน้าทีม (§9.4) | ทีม Booking | mock adapter (Q14) |
| พิกัดฐาน/จุดชาร์จจริง | ผู้ใช้/ฝ่ายปฏิบัติการ | พิกัด mock หลายจุด (Q22) |
| ตั้ง retention วิดีโอ 3 เดือนบน DSS | infra | — |

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
| A8 | **Booking ส่งเวลา check-in/check-out ต่อใบงาน** | สถานะใบงานต้องพึ่ง Booking status (Completed) แทน · ถ้าไม่มีทั้งคู่ ใบงานปิดด้วย SafetyTimeout เท่านั้น |
| A9 | **Booking ระบุกล้องที่ใช้กับงานได้** (`DeviceRefs`) และ/หรือมีข้อมูลกล้องประจำทีม | การผูกกล้องมาจาก Booking เท่านั้น (Q20) ⇒ ถ้าไม่มี ทุก session เป็นใบรวมของกล้องและต้องให้ Operator link ด้วยมือ |

---

## 9.4 Booking Information Checklist

ข้อมูลที่ต้องได้จากทีม Booking **ก่อนเริ่ม P3c** (ระหว่างรอพัฒนาบน mock — Q14):

**สำคัญที่สุด (ระบบพึ่งข้อมูลนี้)**
- [ ] **check-in / check-out**: มีเวลาต่อใบงานไหม · ส่งเป็น event หรือ field · ใครกดได้ (หัวหน้าทีม/แอดมิน) · check-in ซ้ำหลัง check-out ได้ไหม · แก้เวลาย้อนหลังได้ไหม
- [ ] **กล้องที่ใช้กับงาน** (แหล่งเดียวของการผูกกล้อง — Q20): ใบงานระบุกล้องได้ไหม (รวมกล้องสำรองที่เปลี่ยนกลางงาน) · ใช้รหัสอะไร (DeviceCode / Serial / รหัส DSS) · มีข้อมูล "กล้องประจำทีม" ให้ sync ไหม
- [ ] **งานถูกมอบให้อะไร**: ทีม / หัวหน้าทีม / คนขับ / ทะเบียนรถ และรหัสที่ใช้ (ตรงกับรหัสพนักงาน HR ไหม)

**API & Environment**
- [ ] Base URL ของ dev / staging (sandbox) / production
- [ ] วิธี authenticate (OAuth2 client credentials / API key / mTLS) · อายุ token · การ rotate
- [ ] Rate limit · pagination (cursor/page) · ขนาด page สูงสุด
- [ ] SLA / uptime / maintenance window · ช่องทางติดต่อเมื่อมีปัญหา
- [ ] รูปแบบ error response · การ versioning ของ API

**Job data**
- [ ] ตัวอย่าง payload จริง (redact) ของงานทุกสถานะ
- [ ] identifier ถาวรของงาน (`externalJobId`) และเลขที่แสดงผล
- [ ] เวลาเริ่ม/จบตามแผน · timezone · งานหลายวันมีไหม
- [ ] รายการสถานะทั้งหมด + transition
- [ ] สถานที่ (ชื่อ/ที่อยู่/พิกัด) มีไหม
- [ ] การยกเลิก/ลบงานแสดงอย่างไร (soft delete? หายไปจาก API?)
- [ ] มี field version / updatedAt / etag สำหรับตรวจข้อมูลใหม่กว่าไหม
- [ ] งานเดียวเปลี่ยนทีม/กล้องกลางทางได้ไหม

**Change feed**
- [ ] มี endpoint changed-since ไหม (ระบบ poll ทุก 2 นาที และใช้ตัดสินใบรวมที่ "ไม่มีข้อมูล Booking 240 นาที")
- [ ] มี webhook ไหม: event อะไรบ้าง (โดยเฉพาะ check-in/check-out) · signing · retry policy · ordering · event id

**Write-back**
- [ ] Booking รับข้อมูลจากเราได้ไหม: เลข WO, เวลาเริ่ม/จบจากกล้อง, ลิงก์หลักฐาน
- [ ] รองรับ `Idempotency-Key` ไหม

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
| DL4 | Mobile API สำหรับ **Operator/Admin/Viewer** (monitoring + ตรวจหลักฐาน) · FCM · device registry · ไม่มี PIN · ไม่มี my-jobs | ผู้ใช้แอปคือฝั่งตรวจสอบ ไม่ใช่ภาคสนาม (Q18) | ผู้ใช้ |
| DL5 | เก็บ MP4 export, live wall, talk, Entra SSO | | ผู้ใช้ |
| DL6 | Modular monolith + process roles | ขนาดทีม/ระบบ · reuse | ผู้ออกแบบ |
| DL7 | แยก TrackingSession ออกจาก WorkOrder · ไม่มี pseudo work order | แก้ design smell ของ reference | ผู้ออกแบบ |
| DL8 | Session engine แบบ level-triggered sweep + DB constraint | self-healing, idempotent | ผู้ออกแบบ |
| DL9 | Matching อ่าน local projection ไม่เรียก Booking สด | Booking ล่มไม่กระทบ · อธิบายย้อนหลังได้ | ผู้ออกแบบ |
| DL10 | `WorkOrders.BookingJobId` nullable · เปิดกล้องแต่ไม่พบ Booking ให้สร้างใบงานไว้ก่อน (Q11) | requirement + ผู้ใช้ยืนยัน | ผู้ใช้ |
| DL11 | UNKNOWN คำนวณจากอายุข้อมูล ไม่เขียน null | บทเรียน `clearPlatformStatuses()` ของ reference | ผู้ออกแบบ |
| DL12 | API ใช้ camelCase ทั้งหมด | ลดความสับสนของ reference ที่ปน 2 แบบ | ผู้ออกแบบ |
| DL13 | ผู้ปิดใบงาน = หัวหน้าทีมและแอดมิน **โดยทำ check-out ฝั่ง Booking** | ผู้ใช้ยืนยันว่า "ปิดได้ทั้งหัวหน้าทีมและแอดมินระบบ" และ "สถานะอ้างอิง check-in/check-out ของ Booking" | ผู้ใช้ |
| DL14 | Role เหลือ 3 ตัว: `ADMIN`, `OPERATOR` (รวม Supervisor + Dispatcher เดิม), `VIEWER` · void = `ADMIN` เฉพาะใบที่ไม่ผูก Booking · audit log = `ADMIN` (Q19) | ไม่มีงานสร้าง/อนุมัติ/มอบหมายใบงาน · ไม่มีผู้ใช้ภาคสนามในระบบนี้ | ผู้ใช้ |
| DL15 | **สถานะใบงานตาม Booking check-in/check-out**: check-out ⇒ Closed · check-in ใหม่ ⇒ reopen · ไม่มีปุ่มปิด/reopen/ยืนยันสถานะในระบบนี้ · การเปิดดูใบงานทำได้ตลอดภายใน retention (Q1, Q2, Q8, Q9) | | ผู้ใช้ |
| DL16 | ไม่มี role หัวหน้าทีมในระบบนี้ · หัวหน้าทีมใช้ Booking app · ทีม/หัวหน้าทีมยังเก็บเป็นข้อมูลเพื่อจับคู่ (Q18) | | ผู้ใช้ |
| DL17 | กล้องต้องเปิดต่อเนื่อง ≥ 15 นาทีจึงนับเป็นงาน · งานที่ยังไม่ check-out ถือเป็นใบเดิม แม้กล้องดับไปชาร์จแล้วเปิดใหม่ · window ±60 นาที · แนะนำได้ถึง 3 ชม. (Q3) | | ผู้ใช้ |
| DL18 | กล้องชาร์จที่ฐานไม่เปิดใบงาน (Q15) — vendor ไม่มี charging state (Q21) จึงตรวจ 2 ชั้น: `Depots` + fix ล่าสุด · auto-void ใบรวมที่ไม่มี recording | วิธีตรวจ = ผู้ออกแบบ | ผู้ใช้ + ผู้ออกแบบ |
| DL19 | ไม่ย้ายข้อมูลจากระบบเดิม — ระบบเดิมเป็น reference เท่านั้น (Q13) | | ผู้ใช้ |
| DL20 | Retention: GPS 3 เดือน · ใบงาน 3 เดือน · audit log 12 เดือน · วิดีโอ DSS 3 เดือน (infra จัดการ) · ไม่มี archive (Q12) | | ผู้ใช้ |
| DL21 | **การผูกกล้องกับงาน/ทีม (รวมกล้องสำรอง) มาจาก Booking เท่านั้น** — `DeviceRefs` ในใบงาน และ/หรือ sync กล้องประจำทีม · ระบบเราไม่มีหน้าจอผูกกล้อง (Q4, Q20) | ข้อมูลกล้องตรงกันระหว่าง 2 ระบบ | ผู้ใช้ |
| DL22 | สลับงานอัตโนมัติ A→B + flag (Q5) · Booking ยกเลิก ⇒ "ยกเลิกโดย Booking" และตรวจหลักฐานได้ (Q6) · Operator เป็นเจ้าของคิวตรวจสอบ (Q7) · 1 คน 1 ทีม เปลี่ยนหัวหน้ามีผลทันที (Q10) | | ผู้ใช้ |
| DL23 | ใบรวม: poll Booking ต่อเนื่อง ถ้าไม่มีข้อมูลที่ตรงกันภายใน **240 นาที** นับจากเปิด ⇒ ปิด (`NoBookingData`) · ผูก Booking แล้วไม่มี check-out **36 ชม.** ⇒ alert · ไม่มี check-out **7 วัน** ⇒ ปิดอัตโนมัติ (`SafetyTimeout`) (Q23) | | ผู้ใช้ |
| DL24 | SLA คิวตรวจสอบ **36 ชม.** — เกินแล้ว alert Operator + Admin (Q7) | | ผู้ใช้ |
| DL25 | พัฒนา Booking integration บน **mock adapter ก่อน** รอ spec จากทีม Booking (Q14) | | ผู้ใช้ |
| DL26 | ฐาน/จุดชาร์จรองรับหลายจุด · ใช้พิกัด mock ไปก่อน (Q22) | | ผู้ใช้ |
| DL27 | กล้องที่ Booking ยังไม่ผูกกับทีม/งาน ⇒ สร้าง **ใบรวมของกล้อง** (`TeamId` ว่าง) + alert · link ได้เมื่อ Booking ส่งข้อมูล · ใบรวมที่ปิดด้วย `NoBookingData` เข้าคิวตรวจสอบ | ทำให้ Q11 (สร้างใบงานไว้ก่อน) กับ Q20 (ผูกกล้องจาก Booking เท่านั้น) ใช้ร่วมกันได้ | ผู้ออกแบบ |
| DL28 | auto-void ใบรวมที่ไม่มี recording · ใบรวมที่ปิดด้วย `NoBookingData` ⇒ `NeedsReview` (เข้าคิว SLA 36 ชม.) | ทำให้คิวตรวจสอบไม่ถูกข้ามเพราะใบรวมปิดเร็ว | ผู้ออกแบบ |
