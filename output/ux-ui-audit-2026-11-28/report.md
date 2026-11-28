# UX/UI audit — PSD Body Worn Camera

วันที่ตรวจ: 28 พฤศจิกายน 2026 · โหมดการใช้งานหลัก: Operate · เป้าหมาย: ตรวจทุกหน้าที่มี route ในโปรเจกต์

**ผลประเมิน: มีระบบการออกแบบที่สวย สม่ำเสมอ และเหมาะกับงานปฏิบัติการแล้ว แต่ยังไม่พร้อมรับรองว่า UX/UI ผ่านทุกเกณฑ์** ควรแก้ contrast ของช่องกรอก การคืน keyboard focus และการเข้าถึงคำสั่งในพื้นที่แคบก่อน จากนั้นตรวจมือถือและหน้าที่ต้องใช้ Super Admin ให้ครบ การตรวจครั้งนี้ไม่ได้แก้ UI หรือข้อมูลธุรกิจ

## Audit Health Score

| มิติ | คะแนน | หลักฐานสำคัญ |
|---|---:|---|
| Accessibility | 2/4 | มี labels, landmarks, skip link และ focus rings แต่ขอบช่องกรอก contrast ต่ำ และปิดฟอร์มผู้ใช้แล้ว focus กลับไป BODY |
| Performance | 3/4 | แบ่ง route เป็น lazy chunks แล้ว แต่โลโก้ใน sidebar 430,158 bytes และ build ยังเตือน chunks เกิน 500 kB |
| Theming | 3/4 | light/dark ใช้ semantic tokens สอดคล้องกัน แต่แผนที่ยังสว่างมากใน dark mode |
| Responsive Design | 3/4* | มี breakpoint, drawer, ตารางที่เลื่อนได้ด้วย keyboard และขนาด controls สำหรับ coarse pointer; ตาราง desktop ยังซ่อนคำสั่งด้านขวา |
| Implementation Integrity | 3/4 | ระบบ component และ visual language ต่อเนื่องกันทั้งโปรเจกต์; ยังมีจุดขาดต่อใน focus และข้อมูลสิทธิ์ที่แสดงเป็นรหัส |
| **รวม** | **14/20 — Good (เบื้องต้น)** | **ควรแก้มิติที่อ่อนก่อน sign-off** |

*Responsive เป็นคะแนนเบื้องต้นจากโค้ดร่วมกับ desktop ที่ 1280×720 ไม่ใช่ผลรับรองบนมือถือจริง: Browser viewport API ไม่เปลี่ยนขนาดจริงแม้สั่ง 390×844 จึงไม่ใช้ภาพ desktop มาอ้างว่าเป็น mobile evidence

## Implementation Integrity Verdict

**ผ่านด้านความเป็นระบบของงานออกแบบ**: graphite navigation, navy actions, Noto Sans Thai, neutral data panels, page hierarchy และสถานะที่มีทั้งสีและข้อความ ทำงานเป็นภาษาภาพเดียวกัน Login แบบ Prism Glass เป็นข้อยกเว้นที่ตั้งใจไว้ใน `client/DESIGN.md` จึงไม่ถือว่าเป็นความไม่สม่ำเสมอ หน้าแรกที่เป็นทางลัดตามสิทธิ์เหมาะกับขอบเขตปัจจุบัน ไม่จำเป็นต้องเติม metric ที่ระบบยังไม่มี

Detector สแกน `client/src` ได้ **0 primary findings และ 26 advisories** (สี 16, radius 8, type size 2) ตัวเลขนี้ไม่ใช่จำนวน UX bugs: ตัวอย่าง 13px อยู่ใน test fixture, 9999px ใช้กับ scrollbar/voice capsule, 1px ใช้กับเส้น navigation และหลายสีเป็น auth/media exceptions ต้องทบทวนบริบท ไม่ควรเปลี่ยนทุกจุดตาม detector อัตโนมัติ ส่วนสีที่ซ้ำใน auth styles เป็นโอกาสรวบรวม tokens เมื่อมีการแก้บริเวณนั้นครั้งต่อไป

## ขอบเขตและวิธีตรวจ

- ใช้ code และ screenshots ที่เก็บใหม่ในการตรวจครั้งนี้เท่านั้น ไม่ใช้ภาพหรือคำกล่าวว่า “passed” จาก design-qa รอบก่อนเป็นหลักฐาน
- ตรวจ current working tree ซึ่งมีงานแก้ค้างอยู่ก่อนเริ่ม audit; ไม่ถือว่าผลนี้ผูกกับ clean commit
- Browser: Codex in-app browser, `http://localhost:5173`, viewport ที่ยืนยันจาก DOM คือ 1280×720; บางภาพ full-page สูงกว่า viewport
- ใช้บัญชี local demo Operator และ Admin ตาม runbook เพื่ออ่านหน้าที่อนุญาต ตรวจ form โดยไม่สร้างหรือแก้บัญชี ไม่แก้ roles/settings ไม่ส่งเสียง ไม่เริ่ม live session หรือสร้าง MP4 export
- เปิดดู light/dark, ไทย/English, camera selection, history deep link, form cancel/Escape, filtered-empty, permission-denied และ 404
- บัญชี Super Admin ตามค่าเริ่มต้นใน runbook เข้าระบบไม่ได้ จึงตรวจเนื้อหาภายใน Settings/Audit Logs จากโค้ดและ tests เท่านั้น พร้อมเก็บภาพ permission-denied แยกไว้ ไม่มีการข้ามสิทธิ์หรือเปลี่ยนรหัสผ่าน
- มีเพียงกล้อง offline ในข้อมูลที่เห็น จึงยังไม่ได้ยืนยัน live video, talk, การเล่นไฟล์จริง และการดาวน์โหลด MP4 แบบ end-to-end
- Browser viewport override ไม่ทำงานจริงทั้งกับ tab เดิมและ tab ใหม่ จึงยังไม่ได้พิสูจน์ reflow ที่ 320/390/768px, touch gestures, 200–400% zoom, text-spacing overrides หรือ physical devices
- ยังไม่ได้ทดสอบด้วย screen reader และไม่ได้วัด production LCP/INP/CLS จึงไม่ใช่ใบรับรอง WCAG หรือ Core Web Vitals

## รายการตรวจทุกหน้า

| # | หน้า / route | สภาพที่ตรวจ | ผลและข้อสังเกต |
|---:|---|---|---|
| 1 | Login `/login` | ภาพจริง, sign-in, validation | สวยและ hierarchy ชัด; ช่องกรอกมี label, แสดง/ซ่อน password และ error ที่อ่านเข้าใจได้ ดูภาพ 01–02 |
| 2 | Home `/` | ภาพจริงตามสิทธิ์ Operator | เรียบร้อยและใช้งานตรงไปตรงมา; แสดงปลายทางจริงตามสิทธิ์ ไม่มี metric สมมติ ดูภาพ 03 |
| 3 | Work orders `/work-orders` | populated list, detail dialog | รูปแบบตารางและ status สม่ำเสมอ; รหัสอ้างอิงยาวทำให้แถวสูง อ่านช้าลงเมื่อมีข้อมูลมาก ดูภาพ 04–05 |
| 4 | Work-order detail `/work-orders/:id` | ข้อมูลจริงจาก local demo | แบ่งข้อมูลงานกับแผนที่ชัด; heading ข้าม h1 ไป h3 ควรปรับตามบริบท ดูภาพ 21, finding F07 |
| 5 | Tracking `/tracking` | เลือกกล้อง, popup, light/dark, English | directory และแผนที่ใช้งานสัมพันธ์กัน; แจ้งพิกัดเก่าและปิด live สำหรับกล้อง offline ได้ชัดเจน; dark basemap ยังสว่าง ดูภาพ 06–07, 24–25 |
| 6 | History ใน Tracking `?view=history` | deep link จากกล้อง | ส่งกล้อง/ช่วงเวลามาต่อได้; มีข้อความไม่มีข้อมูลและแสดงช่วงเวลา ดูภาพ 08 |
| 7 | Route history `/tracking/history` | initial empty state | อธิบายให้เลือกกล้องก่อน, จำกัดช่วงเวลา 36 ชั่วโมง, fields มี labels; ยังไม่ได้เห็น route ที่มี GPS samples ในรอบนี้ ดูภาพ 09 |
| 8 | Evidence `/evidence` | idle, camera selection, no recordings | player 16:9 และ timeline ชัด แต่ action หลักอยู่ในแผงที่ต้องเลื่อนภายใน ดูภาพ 10–11, finding F04 |
| 9 | Live Wall `/live-wall` | 6/16 ช่อง, offline camera | แบ่งจอและสถานะเลือกจอชัด, มีทางเลือก click แทน drag; empty hint ถูกตัดใน 16 ช่อง ดูภาพ 12–13, finding F10 |
| 10 | Users `/users` | list, create dialog, cancel/Escape, search-empty, dark | ฟอร์มอ่านง่ายและมี required/optional copy; actions หลุดไปนอกส่วนที่เห็น และ focus ไม่คืน trigger ดูภาพ 15–16, 23, 26; findings F02–F03 |
| 11 | Roles tab ใน Users | read-only matrix | แบ่ง resource groups ดี แต่ใช้ permission codes เป็นชื่อหลักและหัวคอลัมน์ไม่ตามเมื่อเลื่อน ดูภาพ 17, finding F06 |
| 12 | Entra users `/entra-users` | populated directory, summaries | แยกสรุป สถานะ และ bulk actions ชัด; คำสั่งรายแถวด้านขวาถูกตัดใน viewport นี้ ดูภาพ 18, finding F03 |
| 13 | Audit Logs `/audit-logs` | source/tests + permission-denied | มี search debounce, action/result/date filters, pagination, loading/error/empty, table caption และ copy feedback; **ยังไม่ยืนยันภาพภายในด้วย Super Admin** ดูภาพ 20 |
| 14 | Settings `/settings` | source/tests + permission-denied | มี grouping, labels, min/max validation, inline errors, save/reset และ rollback ของ boolean เมื่อ save ล้มเหลว; **ยังไม่ยืนยันภาพภายในด้วย Super Admin** ดูภาพ 19 |
| 15 | Not found `/*` | ภาพจริง | ข้อความและทางกลับหน้าแรกชัด ดูภาพ 22 |
| 16 | RouteErrorPage | source/tests | มี alert และ reload action, nested error ไม่สร้าง main ซ้อน; **ไม่ได้สร้าง runtime crash เพื่อเก็บภาพ** |

`PlaceholderPage` ไม่ได้ถูกผูกกับ route ที่ใช้งานใน router ปัจจุบัน และ Notifications เป็นเมนู disabled ที่บอกว่ายังไม่เปิดใช้งาน จึงไม่รายงานว่าเป็นหน้าที่ทำเสร็จแล้ว

## Findings ตามความสำคัญ

จำนวนประเด็นที่รายงาน: **P0 0 · P1 1 · P2 8 · P3 1** ประเด็นด้านมือถือและหน้าที่ติดสิทธิ์เป็นข้อจำกัดการตรวจ ไม่ใช่ bugs ที่ยืนยันแล้ว

### F01 — [P1] ขอบช่องกรอกกลืนกับพื้นหลังในทั้งสองธีม

- **หมวด:** Accessibility / Theming
- **ตำแหน่ง:** `client/src/components/ui/input.tsx:10`, `client/src/styles/tailwind.css:26`, `:85`, `:144`
- **หลักฐาน:** computed styles ของ input ที่ใช้งานได้ใน Users ใช้ border `oklch(0.89 0.014 255)` บน canvas `oklch(0.985 0.004 255)`; ช่องว่างใน user form ใช้ component เดียวกัน ดูภาพ 16 และ 23, ตัวเลขใน `contrast-measurements.json`
- **ค่าที่วัด/คำนวณ:** light border ต่อ canvas **1.33:1**, ต่อ card **1.37:1**; dark ต่อ canvas **1.48:1**, ต่อ card **1.40:1** พื้นในช่องกับพื้นที่รอบข้างมีสีใกล้กันมาก
- **ผลกระทบ:** ผู้ใช้สายตาเลือนรางแยกช่องกรอกว่างออกจากพื้นได้ยาก แม้ข้อความและ focus ring จะอ่านได้ดี
- **มาตรฐาน:** WCAG 2.2 SC 1.4.11 กำหนด 3:1 สำหรับ visual information ที่จำเป็นต่อการระบุ control โดยเฉพาะช่องว่างที่ต้องอาศัยขอบหรือพื้นเพื่อบอกว่ากรอกได้ ไม่ได้หมายความว่าเส้นตกแต่งหรือทุกปุ่มต้องมี border 3:1
- **แนะนำ:** แยก token ของ interactive-control boundary ออกจาก hairline ของ panel/divider และวัดกับพื้นจริงทั้งสองธีม ไม่จำเป็นต้องทำเส้นแบ่งทุกส่วนให้เข้มขึ้น
- **คำสั่งที่เหมาะ:** `$impeccable harden`

### F02 — [P2] ปิด user form แล้ว keyboard focus หลุดไป BODY

- **หมวด:** Accessibility / Implementation Integrity
- **ตำแหน่ง:** `client/src/features/users/UsersPage.tsx:366`, `client/src/features/users/components/UserFormDialog.tsx:121`
- **หลักฐาน:** เปิด “เพิ่มผู้ใช้” แล้วปิดด้วย Cancel และ Escape; DOM ยืนยัน `document.activeElement.tagName === 'BODY'` หลัง dialog หายไป ปุ่มเปิดยังอยู่ในหน้า
- **ผลกระทบ:** ผู้ใช้ keyboard ต้องหาตำแหน่งเดิมใหม่ โดยเฉพาะเมื่อกำลังทำงานกับรายชื่อยาว
- **มาตรฐาน:** WAI-ARIA APG Modal Dialog แนะนำให้คืน focus ไปยังตัวเปิด หรือจุดถัดไปที่เหมาะกับ workflow
- **แนะนำ:** เก็บ ref ของ trigger/row action แล้วคืน focus ใน close lifecycle หรือใช้ DialogTrigger ที่ผูกกับ dialog ให้ถูกต้อง ครอบคลุม Cancel, Escape และ save-success
- **คำสั่งที่เหมาะ:** `$impeccable harden`

### F03 — [P2] คำสั่งรายแถวถูกซ่อนหลัง horizontal scroll แม้บน desktop

- **หมวด:** Responsive / Accessibility / Implementation Integrity
- **ตำแหน่ง:** `client/src/features/users/UsersPage.tsx:198`, `:251`; `client/src/features/users/components/EntraDirectoryTable.tsx:81`, `:138`
- **หลักฐาน:** viewport 1280px, scroll viewport ของ Users กว้าง **972px** แต่ table **1080px**; คอลัมน์เครื่องมือมองไม่เห็นตั้งแต่ต้น Entra table มีขั้นต่ำ 1040px และ 1800px เมื่อเปิดทุกฟิลด์ ดูภาพ 15 และ 18
- **ผลกระทบ:** ต้องเลื่อนไปด้านขวาเพื่อหาคำสั่ง และเสียบริบทว่ากำลังแก้คนใด รูปแบบนี้หนาแน่นเกินพื้นที่ที่มีอยู่
- **มาตรฐาน:** ไม่จัดเป็น WCAG reflow failure จาก horizontal table เพียงอย่างเดียว เพราะตารางมีข้อยกเว้นสำหรับข้อมูลสองมิติ ระบบมี scroll region ที่ focus ได้และ fade hint อยู่แล้ว
- **แนะนำ:** ตรึงคอลัมน์คำสั่งและตัวระบุหลัก หรือย้ายข้อมูลรองไป row detail/column chooser; สำหรับมือถือควรตรวจ task flow ที่แสดง identity, status และ actions ได้พร้อมกัน
- **คำสั่งที่เหมาะ:** `$impeccable adapt`

### F04 — [P2] คำสั่งหลักใน Evidence ไม่อยู่ในส่วนที่เห็นของ inspector

- **หมวด:** Responsive / Implementation Integrity
- **ตำแหน่ง:** `client/src/features/evidence/evidence.css:35`, `client/src/features/evidence/EvidencePage.tsx`
- **หลักฐาน:** แผงตั้งค่าที่ 1280×720 มี client height **355px** แต่ content height **651px**; ส่วนที่เห็นจบระหว่าง selected metadata ก่อนถึงช่วงเวลาและปุ่ม ดูภาพ 10–11
- **ผลกระทบ:** ผู้ใช้เห็นคำแนะนำให้ระบุช่วงเวลา แต่ต้องค้นพบว่ามีพื้นที่เลื่อนอีกชั้นจึงจะถึง “ดูย้อนหลัง” และ “ดาวน์โหลด MP4”
- **แนะนำ:** ทำ action area ให้เห็นต่อเนื่อง เช่น sticky footer ของ inspector หรือเปิดเผยขั้นเลือกช่วงเวลา/ไฟล์ก่อน metadata รอง โดยรักษาภาพ 16:9 และข้อมูลที่จำเป็นไว้
- **คำสั่งที่เหมาะ:** `$impeccable layout`

### F05 — [P2] Dark mode ยังแสดง basemap สว่างเต็มพื้นที่ทำงาน

- **หมวด:** Theming
- **ตำแหน่ง:** `client/src/components/map/mapConfig.ts:14`, `client/src/components/map/MapCanvas.tsx:40`
- **หลักฐาน:** ภาพ 24 แสดง shell/directory สีมืด แต่แผนที่ซึ่งครองพื้นที่ส่วนใหญ่ยังเป็นสีอ่อน `tileLayerConfig` ไม่รับ theme
- **ผลกระทบ:** ความสว่างเปลี่ยนมากระหว่างส่วนควบคุมกับแผนที่ ลดประโยชน์ของ dark mode สำหรับการเฝ้าดูในห้องมืด ไม่ใช่ WCAG violation จากการมีแผนที่สีอ่อนเพียงอย่างเดียว
- **แนะนำ:** เลือก basemap ที่รองรับ theme หรือให้ผู้ใช้เลือก map style โดยรักษาความหมายของ status markers และ attribution ของผู้ให้บริการ
- **คำสั่งที่เหมาะ:** `$impeccable harden`

### F06 — [P2] Permission matrix บังคับให้แปลรหัสสิทธิ์เอง

- **หมวด:** Implementation Integrity / Accessibility
- **ตำแหน่ง:** `client/src/features/users/components/RolePermissionsPanel.tsx:173`, `:201`
- **หลักฐาน:** ชื่อรายสิทธิ์หลักเป็น `streaming:talk`, `evidence:export`, `work-orders:edit-note` แม้หมวดใหญ่เป็นไทย และ header ไม่ sticky เมื่อเลื่อนตารางยาว ดูภาพ 17
- **ผลกระทบ:** ผู้ดูแลต้องจำความหมายของ code และจำลำดับ role columns ก่อนพิจารณาสิทธิ์ ซึ่งเป็นงานที่ผิดพลาดแล้วกระทบการใช้งานได้
- **แนะนำ:** แสดงชื่อการกระทำภาษาไทย/English ที่ชัดเจนเป็นหลัก เก็บ code เป็นข้อมูลรอง เพิ่มคำอธิบายเมื่อขอบเขตใกล้เคียงกัน และตรึง column header เพื่อรักษาบริบท
- **คำสั่งที่เหมาะ:** `$impeccable clarify`

### F07 — [P2] Work-order detail route ใช้ heading level ของ dialog

- **หมวด:** Accessibility
- **ตำแหน่ง:** `client/src/features/work-orders/WorkOrderDetailContent.tsx:44`, `:169`
- **หลักฐาน:** `/work-orders/1` มี h1 แล้วต่อด้วยหัวข้อข้อมูลงาน/กล้อง/เหตุการณ์เป็น h3 ส่วนเดียวกันอยู่ใต้ dialog title h2 ได้ถูกต้อง ดูภาพ 21 และ DOM ที่ตรวจ
- **ผลกระทบ:** โครงสร้างหัวข้อบน standalone page ไม่ตรงกับ hierarchy ที่มองเห็น ทำให้การอ่านด้วย heading navigation สับสน
- **แนะนำ:** ส่ง heading level ตามบริบท ให้ section เป็น h2 บน standalone route และคง h3 เมื่ออยู่ภายใต้ dialog h2
- **คำสั่งที่เหมาะ:** `$impeccable harden`

### F08 — [P2] ส่งโลโก้ขนาดใหญ่เกินขนาดที่แสดงใน sidebar

- **หมวด:** Performance
- **ตำแหน่ง:** `client/src/components/BrandMark.tsx:1`, `:9`; `client/src/assets/logo/psd-dark.png`
- **หลักฐาน:** production build แสดง logo **430.16 kB**; source ระบุภาพ **932×235px** แต่แสดงที่กว้าง **128px** หรือ 48px เมื่อย่อ sidebar มี JS chunks 613.66 และ 524.95 kB ที่ build เตือนด้วย โดย HLS แยก chunk แล้ว
- **ผลกระทบ:** first load ใช้ bytes มากเกินจำเป็นสำหรับตราขนาดเล็ก โดยเฉพาะเครือข่ายหน้างาน ยังไม่ได้พิสูจน์ว่าทำให้ Core Web Vitals ตก
- **แนะนำ:** เตรียมไฟล์ logo สำหรับขนาดแสดงจริงและ high-DPI เป็น WebP/AVIF หรือ vector ต้นฉบับถ้ามี แล้ววัด network waterfall ก่อนปรับ JS chunks ต่อ
- **คำสั่งที่เหมาะ:** `$impeccable optimize`

### F09 — [P2] ทุก route ใช้ document title เดียวกัน

- **หมวด:** Accessibility / Implementation Integrity
- **ตำแหน่ง:** `client/index.html:7`, `client/src/features/auth/LoginPage.tsx:85`, route metadata
- **หลักฐาน:** title ที่อ่านจาก browser ในหลายหน้าคงเป็น “PSD — Body Worn Camera”; code มีการตั้ง title ใน Login แต่ไม่พบการตั้งตาม route ภายใน
- **ผลกระทบ:** ชื่อ browser tab/history ไม่ช่วยแยกว่ากำลังดู Users, Evidence หรือใบงานใด แม้ page heading และ main-focus จะช่วยภายในหน้าได้
- **แนะนำ:** ตั้ง title จากชื่อ route ที่แปลตามภาษา เช่น “ผู้ใช้ระบบ · PSD Body Worn Camera” และใช้เลขใบงานใน detail page
- **คำสั่งที่เหมาะ:** `$impeccable harden`

### F10 — [P3] Empty-state hint ถูกตัดและซ้ำมากใน Live Wall แบบ 16 ช่อง

- **หมวด:** Responsive / Implementation Integrity
- **ตำแหน่ง:** `client/src/features/streaming/components/LiveWallTile.tsx:198`
- **หลักฐาน:** ภาพ 13 ที่ 1280×720 แสดงข้อความแนะนำหลายบรรทัดใต้ icon ถูกตัดในช่องเล็กทุกช่อง แต่ยังมีคำแนะนำเต็มใน camera directory
- **ผลกระทบ:** ลดความเรียบร้อยของ grid และสร้าง visual noise ในสถานะที่ยังไม่ได้เปิดกล้อง ไม่มีหลักฐานว่าสกัดการทำงาน
- **แนะนำ:** ใช้ empty-state แบบย่อเมื่อ tile เล็ก แสดงคำแนะนำเต็มเพียงจุดเดียว รักษาขนาดและความอ่านง่ายของชื่อจอ
- **คำสั่งที่เหมาะ:** `$impeccable polish`

## สิ่งที่ควรรักษาไว้

- ลำดับ h1, ข้อความอธิบาย, toolbar และ data panel สม่ำเสมอเกือบทุกหน้า
- Navy ใช้กับ actions/links และสีสถานะมาพร้อมข้อความหรือ icon จึงไม่พึ่งสีอย่างเดียว
- Noto Sans Thai และตัวเลข tabular ช่วยให้ข้อมูลไทย เวลา และรหัสอยู่ในระบบเดียวกัน
- Sidebar มี active state, breadcrumbs และ skip-to-main; route change ย้าย focus ไป main
- ตารางมี caption, column scope, scroll hint และ keyboard-focusable scroll viewport จริง ยืนยันจาก DOM ว่า `data-overflow=true` และ `tabindex=0` เมื่อ Users table ล้น
- ฟอร์มผู้ใช้มี label, optional copy, password toggle และ initial focus ที่ถูกต้องภายใน dialog; ปัญหาที่พบคือการคืน focus หลังปิด
- มี loading/error/filtered-empty/permission-denied/404 ที่แยกกัน และ browser console ไม่พบ warn/error ในช่วงหน้าที่ตรวจ
- Route lazy loading, HLS chunk แยก, image dimensions, reduced-motion rules และ existing tests เป็นฐานที่ดี

## การตรวจเชิงเทคนิค

| รายการ | ผลรอบนี้ |
|---|---|
| `npm run build` ใน client | ผ่าน TypeScript และ Vite production build; มี bundle-size advisory ตามที่ระบุ |
| Focused foundation/layout tests | 7 files / 69 tests ผ่าน |
| `npm test -- --maxWorkers=4` ใน client | **108 files / 953 tests ผ่าน**; เวลา 47.71 วินาที |
| Impeccable detector | 0 primary findings / 26 advisories; เก็บ raw JSON แยก |
| Browser interaction | Sign-in ด้วย local demo, อ่านหน้า, เปิด/ยกเลิกฟอร์ม, selection, filter, language, theme, grid layout และ sign-out |
| สิ่งที่ไม่รับรอง | Live/Talk/MP4 E2E, หน้าภายใน Super Admin, mobile/touch, screen-reader behavior, production performance |

สิ้นสุดการตรวจโดย sign-out จากบัญชีทดสอบ คืนภาษาไทย/light theme และ viewport เดิม ไม่แก้ source UI หรือข้อมูลธุรกิจ

## Recommended Actions

1. **[P1] `$impeccable harden`** — F01 แยก control border token และตรวจ non-text contrast ทั้งสองธีม
2. **[P2] `$impeccable harden`** — F02 คืน focus ให้ dialog trigger; F07 heading ตามบริบท; F09 page titles
3. **[P2] `$impeccable adapt`** — F03 ทำ identity/actions ของ Users และ Entra ให้อยู่ในพื้นที่ใช้งาน และตรวจ viewport 320/390/768/1280px จริง
4. **[P2] `$impeccable layout`** — F04 ให้ action หลักใน Evidence ค้นพบและเข้าถึงได้ง่าย โดยคง player 16:9
5. **[P2] `$impeccable clarify`** — F06 ชื่อสิทธิ์ที่อ่านรู้เรื่อง พร้อมรักษา role-column context
6. **[P2] `$impeccable harden`** — F05 ปรับ map style ให้เหมาะกับ dark mode
7. **[P2] `$impeccable optimize`** — F08 ลด logo payload และวัด production loading
8. **[P3] `$impeccable polish`** — F10 ปรับ dense-grid empty state และทบทวน spacing/type ทุกหน้าหลังแก้ประเด็นหลัก

สามารถให้ดำเนินการทีละรายการ ทั้งหมด หรือเรียงลำดับใหม่ได้ หลังแก้ควรรัน `$impeccable audit` ซ้ำและเก็บคะแนนเทียบ รวมทั้งยืนยันสองหน้า Super Admin และ responsive ใน browser ที่ปรับ viewport ได้จริงก่อน sign-off

## หลักฐานและเกณฑ์อ้างอิง

- ภาพรวมหน้าที่เข้าถึงได้: `overview.jpg` (ภาพ contact sheet ไม่ใช่ mobile evidence)
- ภาพจริงใหม่ 25 ภาพ: หมายเลข 01–13 และ 15–26; ไม่มีหมายเลข 14 เพราะ viewport override ไม่ได้เปลี่ยนเป็นมือถือจริง
- รายละเอียดทั้งหมดพร้อมภาพ: `report.html`
- Raw detector: `detector.json`
- Contrast calculations: `contrast-measurements.json`
- Scroll geometry: `scroll-measurements.json`
- Full client test output: `client-tests.log`
- [WCAG 2.2 — Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): 3:1 สำหรับ visual information ที่จำเป็นในการระบุ control/state โดยมีข้อยกเว้นตามบริบท
- [WCAG 2.2 — Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): ข้อความปกติ 4.5:1, large text 3:1 ไม่ได้ใช้ 4.5:1 กับเส้นขอบทุกอย่าง
- [WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): ตรวจเทียบ 320 CSS px และพิจารณาข้อยกเว้นของข้อมูลสองมิติ เช่น ตาราง/แผนที่
- [WCAG 2.2 — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): AA เริ่มที่ 24×24 CSS px หรือมีข้อยกเว้นที่เข้าเงื่อนไข; 44px เป็นเป้าหมาย touch ที่ดี ไม่ใช่ข้อกำหนด AA สำหรับทุกปุ่ม
- [WAI-ARIA APG — Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus ควรกลับ trigger หรือจุดที่เหมาะกับ workflow หลังปิด dialog
