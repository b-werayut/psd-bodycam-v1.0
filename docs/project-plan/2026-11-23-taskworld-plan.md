# แผนงาน Taskworld — PSD Body worn camera

> แผนประมาณการสำหรับลง Taskworld อิงจาก blueprint และ roadmap ของระบบนี้ (`docs/blueprint/08-implementation-roadmap.md`)
> ส่งงาน **31 ม.ค. 2570** (วันอาทิตย์ ⇒ ส่งมอบจริงศุกร์ 29 ม.ค. 2570)
> ประเมินจากเวลาทำงานจริงของแต่ละ task (เริ่มจากศูนย์ ไม่นับงานที่ทำล่วงหน้าไว้)
> สมมติทีม: Backend 3 · Web 2 · Mobile 1 · Middleware 1 · DevOps 1 · QA 1 · ทำขนานกันตามสาย

**วิธีอ่าน**
- แถว **ตัวหนา** = main task · แถว `└` = subtask (ใช้ช่วงวันของ main task ถ้าไม่ระบุวันเอง)
- tag ของ subtask: `[Backend]` `[Web]` `[Mobile]` `[Middleware]` `[Infra]` `[QA]`
- `[Middleware]` = DSS middleware repo `psd-bwc-dss-services` (FastAPI ระหว่างระบบนี้กับ Dahua DSS)
- วัน = วันทำงาน (จ.–ศ.) ไม่นับวันหยุด: 7 ธ.ค. (ชดเชยวันพ่อ), 10 ธ.ค. (วันรัฐธรรมนูญ), 31 ธ.ค., 1 ม.ค. — ตรวจกับปฏิทินบริษัทอีกครั้ง
- ช่อง Roadmap = phase ใน blueprint Part 8 (P0–P6)

## ภาพรวม

| Phase | ช่วงเวลา | ระยะ |
|---|---|---|
| Analysis & Design | Nov 16 – Nov 27, 2026 (Smart Booking spec ถึง Dec 18) | 2 สัปดาห์ |
| Development | Nov 30 – Dec 30, 2026 (หลัง Design sign-off) | ~5 สัปดาห์ |
| SIT | Dec 21, 2026 – Jan 8, 2027 (เตรียม Dec 21–30 · ทดสอบ Jan 4–8) | 1 สัปดาห์ + เตรียม |
| UAT | Jan 4 – Jan 15, 2027 (เตรียม Jan 4–8 · ทดสอบ Jan 11–15) | 1 สัปดาห์ + เตรียม |
| Deploy | Jan 18 – Jan 29, 2027 | 2 สัปดาห์ |

**Milestones**
- Nov 27 — Design sign-off
- Dec 14 — Tracking ready (แผนที่สด + สถานะกล้อง + ประวัติเส้นทาง)
- Dec 25 — Evidence ready (ใบงานจาก simulator + ภาพสด / วิดีโอย้อนหลัง / export)
- Dec 30 — Code complete + เชื่อม Smart Booking จริง (ถ้าได้ spec ทัน)
- Jan 8 — SIT sign-off
- Jan 15 — UAT sign-off
- Jan 22 — Production go-live (Web)
- Jan 29 — แอปผ่าน store review + ส่งมอบงาน

---

## 1. Analysis & Design (Nov 16 – Nov 27)

| # | Task | Start | Due | วัน | หมายเหตุ |
|---|---|---|---|---|---|
| 1.1 | **Database Design** | Nov 16 | Nov 24 | 7 | blueprint Part 4 |
| | └ ตาราง, constraint, index, partition, retention | | | | |
| | └ ER diagram | | | | |
| 1.2 | **Design DSS Middleware** | Nov 17 | Nov 24 | 6 | repo `psd-bwc-dss-services` |
| | └ Diagram การทำงาน (ระบบนี้ ↔ middleware ↔ Dahua DSS: ภาพสด, ย้อนหลัง, GPS, talk) | | | | |
| | └ ออกแบบ endpoint เพิ่ม (batch location) + API spec | | | | |
| 1.3 | **UX/UI Design** | Nov 16 | Nov 24 | 7 | blueprint Part 6 |
| | └ [Web] โครงหน้าจอ 12 เมนู + design system | | | | |
| | └ [Mobile] หน้าจอแอปหัวหน้าทีม (login, ใบงาน, ภาพสด) | | | | |
| 1.4 | **Requirement Analysis** | Nov 23 | Nov 24 | 2 | task ใหม่ |
| | └ วิเคราะห์ requirement (Web, Mobile, Smart Booking, กล้อง / DSS) | | | | |
| | └ จัดทำ Scope of Work + SRS | | | | |
| 1.5 | **System Architecture Design** | Nov 23 | Nov 24 | 2 | task ใหม่ · blueprint Part 2 |
| | └ Architecture (api / worker, modules, Redis, realtime) + diagram | | | | |
| | └ Infrastructure diagram (K8s, PostgreSQL, Redis, storage, DSS middleware) | | | | |
| 1.6 | **Business Workflow Design** | Nov 23 | Nov 24 | 2 | task ใหม่ · blueprint Part 3 |
| | └ Session ของกล้อง (เปิด / ปิด / แบ่งช่วง / ชาร์จที่ฐาน) | | | | |
| | └ ใบงานตามสถานะ Smart Booking + การ match กล้องกับใบงานอัตโนมัติ | | | | |
| 1.7 | **API & Integration Design** | Nov 23 | Nov 25 | 3 | task ใหม่ · blueprint Part 5, Part 7 |
| | └ REST API + realtime events + permission matrix | | | | |
| | └ Smart Booking inbound contract v1 + checklist คำถามทีม Smart Booking | | | | |
| | └ Mobile API (หัวหน้าทีม) | | | | |
| 1.8 | **Implementation Roadmap & Risk** | Nov 23 | Nov 24 | 2 | task ใหม่ · blueprint Part 8, Part 9 |
| 1.9 | **Design Review & Sign-off** | Nov 24 | Nov 27 | 4 | |
| | └ Meeting Review Design | Nov 24 | Nov 25 | 2 | |
| | └ Revise Design | Nov 24 | Nov 25 | 2 | |
| | └ Meeting Review Final Design | Nov 27 | Nov 27 | 1 | |
| 1.10 | **Smart Booking Spec** | Nov 23 | Dec 18 | 18 | task ใหม่ · ส่ง contract v1 + checklist ให้ทีม Smart Booking แล้วรอ spec / sandbox — ต้องได้ก่อน Dec 18 |

---

## 2. Development (Nov 30 – Dec 30)

เริ่มหลัง Design sign-off (Nov 27) · ประเมินจากเวลาทำงานจริงของแต่ละสาย ทำขนานกัน:
Backend 1 (Foundation → Sessions / ใบงาน → Dashboard) · Backend 2 (Tracking → ภาพสด / วิดีโอ → Hardening) · Backend 3 (รับใบงาน → Matching → Smart Booking จริง) · Web 1 · Web 2 · Mobile · Middleware · DevOps

| # | Task | Start | Due | วัน | Roadmap / หมายเหตุ |
|---|---|---|---|---|---|
| 2.1 | **Foundation** | Nov 30 | Dec 15 | 10 | P0 |
| | └ [Infra] Project setup + Entra app registration | Nov 30 | Dec 1 | 2 | |
| | └ [Backend] DB baseline + migrations, roles / permissions / settings | Nov 30 | Dec 1 | 2 | |
| | └ [Backend] Login password + Entra SSO + refresh token + lockout | Dec 2 | Dec 4 | 3 | |
| | └ [Backend] API ผู้ใช้ / role / พนักงาน / ผู้ใช้จาก Entra | Dec 8 | Dec 11 | 3 | |
| | └ [Backend] Audit log, ตั้งค่าระบบ, realtime gateway, health check, Swagger | Dec 14 | Dec 15 | 2 | |
| | └ [Web] App shell 12 เมนู + design system + login | Nov 30 | Dec 4 | 5 | |
| | └ [Web] ผู้ใช้ระบบ, พนักงาน, ผู้ใช้จาก Entra, ประวัติการใช้งาน, ตั้งค่าระบบ | Dec 8 | Dec 15 | 5 | |
| 2.2 | **Devices & Real-time Tracking** | Nov 30 | Dec 14 | 9 | P1 |
| | └ [Backend] DB schema กล้อง / สถานะ / GPS + partition รายเดือน | Nov 30 | Dec 1 | 2 | |
| | └ [Backend] DSS client + DSS simulator + sync รายชื่อกล้อง + แจ้งเตือนกล้องหาย | Dec 2 | Dec 4 | 3 | |
| | └ [Backend] GPS poll + สถานะ online / offline + GPS pipeline + realtime push | Dec 8 | Dec 9 | 2 | |
| | └ [Backend] API สถานะกล้อง + ตำแหน่งปัจจุบัน + ประวัติเส้นทาง | Dec 11 | Dec 14 | 2 | |
| | └ [Web] แผนที่ติดตาม | Nov 30 | Dec 9 | 7 | |
| | └ [Web] ประวัติเส้นทาง | Dec 11 | Dec 14 | 2 | |
| 2.3 | **DSS Middleware** | Nov 30 | Dec 22 | 15 | repo `psd-bwc-dss-services` |
| | └ [Middleware] Batch location: ตำแหน่ง + สถานะหลายกล้องใน request เดียว | Nov 30 | Dec 4 | 5 | ขอทีละกล้อง ⇒ poll 100 กล้องใช้ ~65 วินาที/รอบ |
| | └ [Middleware] ตรวจ / ปรับ API ให้ครบตามระบบนี้ (รายชื่อกล้อง + สถานะ, ค้นวิดีโอรายกล้อง + วัน, playback ตามช่วงเวลา, ดาวน์โหลด HLS สำหรับ export MP4, talk) | Dec 8 | Dec 11 | 3 | |
| | └ [Middleware] ส่ง key + คู่มือให้ทีม Smart Booking ดึงรายชื่อกล้อง | Dec 14 | Dec 15 | 2 | |
| | └ [Middleware] CI/CD + deploy (systemd บน PSD Server) + request log ชี้ database ของระบบนี้ | Dec 16 | Dec 18 | 3 | |
| | └ [Middleware] อัปเดต API spec | Dec 21 | Dec 22 | 2 | |
| 2.4 | **Smart Booking Inbound (simulator)** | Nov 30 | Dec 11 | 8 | P3a · ใช้ simulator จนกว่าจะได้ spec จริง |
| | └ [Backend] API รับใบงาน (POST) + auth (HMAC / API key) + rate limit | Nov 30 | Dec 1 | 2 | |
| | └ [Backend] Inbox + queue + retry / dead letter | Dec 2 | Dec 3 | 2 | |
| | └ [Backend] แปลงข้อมูลใบงาน + สร้าง / อัปเดตใบงาน (check-in / check-out / ยกเลิก) | Dec 4 | Dec 8 | 2 | |
| | └ [Backend] สร้างทีม / เปลี่ยนหัวหน้าทีมจากข้อมูลใบงาน | Dec 9 | Dec 9 | 1 | |
| | └ [Backend] Booking simulator (ใบงานใหม่, check-in, check-out, ยกเลิก, ส่งซ้ำ, สลับลำดับ, burst) | Dec 11 | Dec 11 | 1 | |
| 2.5 | **Camera Sessions & Work Orders** | Dec 16 | Dec 25 | 8 | P2 · ต่อจาก 2.2 + 2.4 |
| | └ [Backend] Session engine (เปิด / ปิด / แบ่งช่วงการใช้กล้อง ทุก 30 วินาที) | Dec 16 | Dec 18 | 3 | |
| | └ [Backend] API ใบงาน (list / detail / timeline / กล้อง / ช่วงเวลางาน) | Dec 21 | Dec 22 | 2 | |
| | └ [Backend] กล้องชาร์จที่ฐาน + ใบงานไม่มี check-out (ป้ายต้องตรวจสอบ 36 ชม. / ปิดอัตโนมัติ 7 วัน) | Dec 23 | Dec 23 | 1 | |
| | └ [Backend] Recording index + แจ้งเตือนกล้อง (เปิดกล้องไม่มีทีม, บันทึกนอกเวลางาน) | Dec 24 | Dec 25 | 2 | |
| | └ [Web] หน้า ใบงาน | Dec 16 | Dec 21 | 4 | |
| | └ [Web] หน้า รายละเอียดใบงาน | Dec 22 | Dec 25 | 4 | |
| 2.6 | **Auto Matching** | Dec 14 | Dec 25 | 10 | P3b |
| | └ [Backend] Match กล้องกับใบงานอัตโนมัติ (กล้องในใบงาน → ทีม → หัวหน้าทีม) + บันทึกผล | Dec 14 | Dec 17 | 4 | |
| | └ [Backend] Match ใหม่อัตโนมัติเมื่อข้อมูลใบงานเปลี่ยน | Dec 18 | Dec 21 | 2 | |
| | └ [Backend] แจ้งเตือนการเชื่อมต่อ (ข้อมูลค้าง, ไม่มีข้อมูลเข้า, ประมวลผลไม่ได้ + ปุ่มประมวลผลใหม่) | Dec 22 | Dec 23 | 2 | |
| | └ [Web] Panel ข้อมูลงาน (เลข Booking / DO / SH) + แถบแจ้งข้อมูลไม่อัปเดต | Dec 24 | Dec 25 | 2 | |
| 2.7 | **Live Streaming, Playback & Evidence** | Dec 15 | Dec 25 | 9 | P4 |
| | └ [Backend] Live / playback stream + จำกัดสิทธิ์ต่อกล้อง | Dec 15 | Dec 17 | 3 | |
| | └ [Backend] Talk (two-way audio) | Dec 18 | Dec 21 | 2 | |
| | └ [Backend] ค้นวิดีโอรายกล้อง + วัน พร้อมป้ายใบงาน | Dec 22 | Dec 22 | 1 | |
| | └ [Backend] Export MP4 + ลบไฟล์หลัง 24 ชม. | Dec 23 | Dec 24 | 2 | |
| | └ [Web] ภาพสดหลายจอ + talk | Dec 15 | Dec 18 | 4 | |
| | └ [Web] Dialog ดูสด + talk (จากหน้า ใบงาน, รายละเอียดใบงาน, แผนที่ติดตาม) | Dec 21 | Dec 21 | 1 | |
| | └ [Web] วิดีโอย้อนหลัง (เลือกกล้อง + วัน → เล่น / ดาวน์โหลด) | Dec 22 | Dec 24 | 3 | |
| | └ [Web] Dialog วิดีโอของใบงาน (เฉพาะช่วง check-in – check-out) | Dec 25 | Dec 25 | 1 | |
| 2.8 | **Dashboard & Notifications** | Dec 28 | Dec 30 | 3 | |
| | └ [Backend] API แดชบอร์ด + แจ้งเตือน (รับทราบ / ปิดเรื่อง) | Dec 28 | Dec 29 | 2 | |
| | └ [Web] แดชบอร์ด | Dec 28 | Dec 30 | 3 | |
| | └ [Web] แจ้งเตือน | Dec 28 | Dec 30 | 3 | |
| 2.9 | **Mobile App (หัวหน้าทีม)** | Nov 30 | Dec 30 | 21 | P5 |
| | └ [Mobile] Design UX/UI แอป | Nov 30 | Dec 4 | 5 | |
| | └ [Backend] Role หัวหน้าทีม + สิทธิ์เห็นเฉพาะทีมตัวเอง | Dec 8 | Dec 9 | 2 | |
| | └ [Backend] Mobile API: ข้อมูลผู้ใช้, รายการ / รายละเอียดใบงาน, ภาพสดเฉพาะกล้องของทีม | Dec 11 | Dec 14 | 2 | |
| | └ [Backend] ลงทะเบียนเครื่อง + push "ใบงานใหม่ของทีม" (FCM) | Dec 15 | Dec 15 | 1 | |
| | └ [Mobile] Login (Entra SSO + username / password) + PIN | Dec 16 | Dec 18 | 3 | |
| | └ [Mobile] รายการ / รายละเอียดใบงาน | Dec 21 | Dec 23 | 3 | |
| | └ [Mobile] ภาพสดกล้องของทีม | Dec 24 | Dec 28 | 3 | |
| | └ [Mobile] Push notification + deep link | Dec 29 | Dec 30 | 2 | |
| | └ [Web] หน้า "ใช้งานผ่านแอปมือถือ" เมื่อหัวหน้าทีม login เว็บ | Dec 30 | Dec 30 | 1 | |
| 2.10 | **Infra & CI/CD** | Dec 14 | Dec 18 | 5 | ต้องเสร็จก่อนเตรียม SIT |
| | └ [Infra] Docker images (api, worker + ffmpeg, web) | | | | |
| | └ [Infra] CI: lint, typecheck, unit, integration, coverage | | | | |
| | └ [Infra] gitops: env, database, storage วิดีโอ export | | | | |
| 2.11 | **Smart Booking Integration (ของจริง)** | Dec 28 | Dec 30 | 3 | P3c · ต้องได้ spec / sandbox จากข้อ 1.10 |
| | └ [Backend] ตกลง contract + auth / secret / IP กับทีม Smart Booking | | | | |
| | └ [Backend] Mapper ตาม payload จริง (ถ้าไม่ใช่ v1) + contract test | | | | |
| | └ [Backend] Read API + reconcile รายคืน | | | | ทำเฉพาะเมื่อ Smart Booking มี read API |
| | └ [Backend] ทดสอบกับ sandbox Smart Booking | | | | |
| 2.12 | **Hardening** | Dec 25 | Dec 30 | 4 | P6 |
| | └ [Backend] Retention (GPS 3 เดือน, ใบงาน 3 เดือน, audit 12 เดือน) + cleanup jobs | | | | |
| | └ [Infra] Monitoring: metrics + dashboard + alert rules | | | | |
| | └ [QA] Load test รวม DSS middleware (กล้อง 100, ผู้ใช้ 100, ภาพสด 16 จอ, burst ใบงาน) | | | | |
| | └ [QA] Security review (OWASP ASVS L2, secret scan, dependency audit) + PDPA | | | | |
| | └ [Infra] Backup / restore drill + runbooks | | | | |

---

## 3. SIT (Dec 21 – Jan 8)

| # | Task | Start | Due | วัน | หมายเหตุ |
|---|---|---|---|---|---|
| 3.1 | **Prepare SIT** | Dec 21 | Dec 30 | 8 | ทำขนานกับ Development |
| | └ [QA] Test plan + test cases (Web / Mobile / Integration) | | | | |
| | └ [Infra] Deploy SIT environment (server, DB, DSS middleware, Booking simulator) | | | | |
| | └ [QA] Test data (พนักงาน, ผู้ใช้, กล้อง, ใบงานตัวอย่าง) | | | | |
| 3.2 | **SIT Round 1** | Jan 4, 2027 | Jan 6, 2027 | 3 | |
| | └ [QA] Web (ทุกเมนู ทุก role) | | | | |
| | └ [QA] Mobile (หัวหน้าทีม) | | | | |
| | └ [QA] Integration Smart Booking (end-to-end) | | | | |
| | └ [QA] Integration DSS middleware / กล้องจริง (ภาพสด, วิดีโอย้อนหลัง, GPS, talk) | | | | |
| 3.3 | **SIT Bug fix & Retest** | Jan 6, 2027 | Jan 8, 2027 | 3 | |
| 3.4 | **SIT Sign-off** | Jan 8, 2027 | Jan 8, 2027 | 1 | |

---

## 4. UAT (Jan 4 – Jan 15)

| # | Task | Start | Due | วัน | หมายเหตุ |
|---|---|---|---|---|---|
| 4.1 | **Prepare UAT** | Jan 4, 2027 | Jan 8, 2027 | 5 | ทำขนานกับ SIT |
| | └ [QA] UAT scenarios + test script | | | | |
| | └ [QA] คู่มือการใช้งาน (Web + Mobile) | | | | |
| | └ [Infra] บัญชี UAT (ผู้ใช้จาก Entra, หัวหน้าทีม) + master data | | | | |
| | └ [Mobile] Test build (TestFlight / Google Play internal testing) | | | | |
| 4.2 | **UAT with users** | Jan 11, 2027 | Jan 13, 2027 | 3 | |
| | └ [QA] Training + UAT Web | | | | |
| | └ [QA] UAT Mobile (หัวหน้าทีม) | | | | |
| | └ [QA] Pilot กับใบงาน Smart Booking จริง 1–2 ทีม | | | | |
| 4.3 | **UAT Fix issues & Retest** | Jan 12, 2027 | Jan 15, 2027 | 4 | |
| 4.4 | **Prepare store listing** | Jan 11, 2027 | Jan 15, 2027 | 5 | icon, screenshots, privacy policy, demo account สำหรับ reviewer |
| 4.5 | **UAT Sign-off** | Jan 15, 2027 | Jan 15, 2027 | 1 | |

---

## 5. Deploy (Jan 18 – Jan 29)

| # | Task | Start | Due | วัน | หมายเหตุ |
|---|---|---|---|---|---|
| 5.1 | **Production Deployment & Configuration** | Jan 18, 2027 | Jan 22, 2027 | 5 | |
| | └ [Infra] เตรียม production (database, Redis, storage, secrets) | | | | |
| | └ [Infra] ตั้งค่า Entra SSO + Microsoft Graph + Smart Booking (secret, firewall) | | | | |
| | └ [Infra] Deploy web + api + worker | | | | |
| | └ [Middleware] Deploy DSS middleware บน PSD Server + ตั้งค่า production | | | | |
| | └ [Infra] Master data (พนักงาน, ผู้ใช้, บัญชีหัวหน้าทีม, ตรวจกล้องจาก DSS ครบ) | | | | |
| | └ [QA] Smoke test + go-live checklist | | | | |
| 5.2 | **Submit App for Store Review** | Jan 20, 2027 | Jan 29, 2027 | 8 | ส่งทันทีที่ production API พร้อม |
| | └ [Mobile] Submit App Store (iOS) + Google Play | | | | |
| | └ [Mobile] แก้ตาม review + ส่งใหม่ | | | | |
| 5.3 | **Go-live & Hypercare** | Jan 25, 2027 | Jan 29, 2027 | 5 | |
| | └ Monitor production + support ผู้ใช้ | | | | |
| | └ แก้ปัญหาบน production | | | | |
| 5.4 | **Project Handover** | Jan 28, 2027 | Jan 29, 2027 | 2 | deadline Jan 31, 2027 |
| | └ ส่งมอบเอกสาร (runbook, คู่มือ, Smart Booking contract) | | | | |
| | └ ส่งมอบงาน / ปิดโปรเจกต์ | | | | |

---

## ความเสี่ยงต่อ timeline

- **Development สั้นกว่า roadmap มาก**: roadmap ประเมิน P1–P6 รวมหลายเดือน แผนนี้มี ~5 สัปดาห์ (Nov 30 – Dec 30) จึงต้องใช้ทีมตามที่สมมติและทำขนานกันทุกสาย · ถ้าคนน้อยกว่านี้หรือไม่ทัน คงฟังก์ชันหลัก (ภาพสด, วิดีโอย้อนหลัง, GPS, ใบงาน, mobile ภาพสด + ใบงาน) แล้วเลื่อนแดชบอร์ด / hardening บางส่วนไปหลัง go-live
- **Smart Booking spec**: ถ้าไม่ได้ภายใน ~Dec 18 ขึ้น production ได้ก่อนในโหมดดูกล้อง / วิดีโอ (session ถูกบันทึกครบ) แล้ว match ใบงานอัตโนมัติเมื่อ Smart Booking เริ่มส่งข้อมูล
- **Pilot สั้น**: roadmap ตั้ง pilot 2 สัปดาห์ (match อัตโนมัติ ≥ 90%) แต่แผนนี้มีแค่ช่วง UAT · ตรวจ match rate ต่อในช่วง hypercare
- **Store review**: Apple อาจ reject แล้วต้องส่งใหม่ · เตรียม store listing + demo account ไว้ตั้งแต่ UAT
- **วันหยุดปลายปี**: ถ้าบริษัทหยุดเพิ่ม (เช่น 28–30 ธ.ค.) ต้องย้าย Smart Booking Integration / Hardening เข้ามาก่อน
