# P0 Client Completion (2026-11-20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดช่องว่างของ `client/` P0 ที่เหลือ — หน้า ผู้ใช้ระบบ ตามกติกา `COMPANY_ADMIN` (DL51, DL55), หน้า ผู้ใช้จาก Entra `/entra-users` (DL53) และต่อ API จริงของ server บนเครื่อง dev local (DL63)

**Architecture:** Vite + React 18 + TanStack Query + zustand · design system เดิม (OKLCH tokens, `client/DESIGN.md`, `components/ui`, `components/command-center`) · ทุกหน้าใช้ `api` จาก `lib/apiClient.ts` · การตัดสินสิทธิ์จริงอยู่ที่ server — client แค่ซ่อน / ล็อกตามข้อมูลที่ server ส่งมา (`availableActions`, `reservedPermissions`)

**Tech Stack:** ของเดิมใน `client/package.json` · ไม่เพิ่ม dependency

**Spec:** Part 5 §5.2 (Users, Roles, Employees), §5.7 · Part 6 (routes, หน้า ผู้ใช้จาก Entra) · DL51, DL53, DL55, DL63 · server contract: `docs/superpowers/plans/2026-11-20-p0-server-foundation.md` Task 4, 7, 9 · reference: `C:\Git\Internal-BodyCam\client\src\features\users\EntraUsersPage.tsx`, `entraSync.ts`, `entraBulk.ts`, `entraLink.ts` · แผนนี้แทน `2026-11-04-p0-client-foundation.md`

## สถานะตั้งต้น (มีแล้ว — ไม่ต้องทำซ้ำ)

- shell + nav 12 เมนู 4 กลุ่ม, design tokens + guard tests, i18n th/en (parity test), providers, `apiClient` (single-flight refresh + retry `REFRESH_RACE`), `usePermission`, `Can`, router + 404 / errorElement, `RealtimeProvider` (`session:revoked`)
- หน้า login (password + Entra), พนักงาน, ผู้ใช้ระบบ + matrix สิทธิ์, ตั้งค่าระบบ, ประวัติการใช้งาน · `RoleCode` มี `COMPANY_ADMIN` แล้ว · `PERMISSION_CATALOG` 24 ตัว
- `client/Dockerfile` (stage `runner`, nginx 8080, `BACKEND_URL`) · unit test 376 ตัวผ่าน
- ทั้งหมดนี้ยังไม่เคยต่อ server จริง (server P0 ยังไม่มี endpoint)

## Global Constraints

- ห้ามแก้ `C:\Git\Internal-BodyCam` และ repo บน Azure (`psd-bwc-frontend`)
- ข้อความ UI ผ่าน i18n เท่านั้น ค่าเริ่มต้นไทย · เพิ่ม key ต้องเพิ่มทั้ง `th` และ `en` (parity test)
- ใช้ primitives / composites เดิมตาม `client/DESIGN.md` · design guard tests ต้องผ่าน (light / dark)
- ไม่ตัดสินสิทธิ์ฝั่ง client เอง: ปุ่มต่อแถวผู้ใช้ตาม `availableActions` · ช่อง matrix ที่ล็อกตาม `reservedPermissions` · รายการ role ตาม `GET /roles` (server ซ่อน `ADMIN` ให้แล้ว)
- error จาก server แสดง `message` ภาษาไทยตามที่ server ส่ง (`apiErrorOf`)
- **ทำบน `main` และห้าม commit** (กติกาผู้ใช้ 2026-11-04): ห้าม `git add` / `commit` / `stash` / `reset` / `checkout` บน repo · ขั้น "Commit" ของแต่ละ task = เสนอ commit message ให้ผู้ใช้ commit เอง
- ledger ของแผนเดิม: `.superpowers/sdd/2026-11-04-p0-client-foundation/progress.md` (rulings CR1–CR9 + รายการ residual ที่ park ไว้ — Task 3 ของแผนนี้เก็บรายการที่กระทบการต่อ server จริง)

## Review Focus

1. **`COMPANY_ADMIN` เปิดแท็บสิทธิ์** ⇒ เห็น matrix แต่แก้ไม่ได้ ไม่มีแถบบันทึก (Task 1: test)
2. **`ADMIN` แก้ matrix ของ `OPERATOR`** ⇒ ช่อง `audit:view` / `settings:manage` / `roles:manage` ถูกล็อกพร้อมคำอธิบาย ติ๊กไม่ได้ (Task 1: test)
3. **สร้างบัญชีจาก Entra หลายแถวพร้อมกันแล้วบางแถวชน (username / email ซ้ำ)** ⇒ แถวที่สำเร็จถูกสร้าง แถวที่ล้มแสดงข้อความของ server และสรุปจำนวนถูกต้อง (Task 2: test)
4. **server ไม่ได้ตั้ง `GRAPH_*`** ⇒ หน้า ผู้ใช้จาก Entra แสดงข้อความ 400 ของ server ใน `AsyncState` ไม่ใช่หน้าขาว (Task 2: test)
5. **access token หมดอายุระหว่างใช้งานบน server จริง** ⇒ refresh เงียบแล้วทำคำขอเดิมต่อ ไม่เด้งไปหน้า login (Task 4: ตรวจมือ)

---

### Task 1: หน้า ผู้ใช้ระบบ ตาม contract ใหม่ (`availableActions`, `reservedPermissions`, matrix อ่านอย่างเดียว)

**Files:**
- Modify: `client/src/features/users/users.api.ts`, `client/src/features/users/UsersPage.tsx`, `client/src/features/users/components/RolePermissionsPanel.tsx`, `client/src/features/users/testUtils.tsx`, `client/src/i18n/locales/th/users.ts`, `client/src/i18n/locales/en/users.ts`
- Test: `client/src/features/users/UsersPage.test.tsx`, `client/src/features/users/components/RolePermissionsPanel.test.tsx`

**Interfaces:**
- Consumes (server Task 7): `UserRow.availableActions: ('edit' | 'suspend' | 'restore' | 'delete')[]` · `GET /roles` → `{ data: RoleRow[]; total: number; reservedPermissions: string[] }`
- Produces:
  - `type UserAction = 'edit' | 'suspend' | 'restore' | 'delete'` · `UserRow` เพิ่ม `availableActions: UserAction[]`
  - `rolesApi.list(): Promise<{ roles: RoleRow[]; reservedPermissions: string[] }>`
  - `RolePermissionsPanel` props `{ readOnly: boolean }`
  - i18n: `users.permissions.reservedHint` (ไทย: "สิทธิ์นี้สงวนไว้สำหรับผู้ดูแลระบบ"), `users.permissions.readOnlyHint` (ไทย: "ดูได้อย่างเดียว — แก้ตารางสิทธิ์ได้เฉพาะผู้ดูแลระบบ")

- [ ] **Step 1: เขียน test ที่ fail**

```tsx
// UsersPage.test.tsx
it('shows only the row actions the server allows', async () => {
  // แถว A: availableActions ['edit','suspend','delete'] · แถว B (ตัวเอง): ['edit']
  // ⇒ แถว B มีเมนูแก้ไขเท่านั้น ไม่มีระงับ / ลบ · แถว A มีครบ 3 รายการ
});
it('shows the roles tab read-only for users:read without roles:manage', async () => {
  // permissions ['users:read','users:manage'] ⇒ มีแท็บสิทธิ์ · checkbox ทุกช่อง disabled · ไม่มีปุ่มบันทึก · มีข้อความ readOnlyHint
});
// RolePermissionsPanel.test.tsx
it('locks reserved permissions for non-ADMIN roles', async () => {
  // reservedPermissions ['audit:view','settings:manage','roles:manage'] · role OPERATOR
  // ⇒ 3 ช่องนั้น disabled พร้อม reservedHint · ช่องอื่นติ๊กได้ · บันทึกแล้ว payload ไม่มี code สงวน
});
it('keeps the ADMIN column locked as before', async () => { /* role ADMIN ทุกช่อง disabled */ });
```

- [ ] **Step 2: Run** `npx vitest run src/features/users` — Expected: FAIL
- [ ] **Step 3: Implement** — `UsersPage` แสดงปุ่มต่อแถวตาม `availableActions` (เลิกคำนวณ `isSelf` เพื่อซ่อนปุ่ม) · แท็บสิทธิ์แสดงเมื่อมี `users:read` และส่ง `readOnly = !canManageRoles` · `RolePermissionsPanel` ล็อกช่องใน `reservedPermissions` ของทุก role ที่ไม่ใช่ `ADMIN` · ปรับ `testUtils.tsx` ให้ fixture มี `availableActions` / `reservedPermissions`
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(client): user actions and permission matrix follow server rules`

### Task 2: หน้า ผู้ใช้จาก Entra `/entra-users`

**Files:**
- Create: `client/src/features/users/EntraUsersPage.tsx`, `entraSync.ts`, `entraBulk.ts`, `entraLink.ts` (port จาก reference)
- Modify: `client/src/features/users/users.api.ts`, `client/src/features/users/userForm.ts`, `client/src/app/router.tsx`, `client/src/app/nav.ts` (`to: '/entra-users'`), `client/src/i18n/locales/th/users.ts`, `client/src/i18n/locales/en/users.ts`
- Test: `EntraUsersPage.test.tsx`, `entraSync.test.ts`, `entraBulk.test.ts`, `entraLink.test.ts` (port), `client/src/app/router.test.tsx`, `client/src/app/nav.test.ts`

**Interfaces:**
- Consumes (server Task 7, 9): `GET /users/entra-directory` และ `POST /users/sync-entra { dryRun, matchByUsername? }` → `EntraSyncResult` (shape ตาม reference client `users.api.ts` · `updates[].patch` ไม่มี `Phone`) · `POST /users { username, fullName, roleCode, email?, azureObjectId? }` · `PATCH /users/:id { azureObjectId }`
- Produces:
  - `usersApi.entraDirectory(): Promise<EntraSyncResult>` · `usersApi.syncEntra(payload: { dryRun: boolean; matchByUsername?: boolean }): Promise<EntraSyncResult>` · `CreateUserPayload.azureObjectId?: string` · `UpdateUserPayload.azureObjectId?: string | null`
  - `userFormFromEntra(source: { upn: string; displayName: string | null; mail: string | null }): UserFormValues` ใน `userForm.ts` (ตัด department / phone ของ reference) · `toCreatePayload` ส่ง `azureObjectId` เมื่อมี
  - `BULK_MAX = 50` · `planBulkCreate(rows: EntraDirectoryRow[]): BulkCandidate[]` (ไม่มี parameter departments) · `bulkPayload(candidate, assignment: { roleCode: string }): CreateUserPayload` · สถานะแถว `EntraRowStatus` ตาม reference (`update` / `keptLocal` / `linked` / `missing` / `conflict`)
  - route `entra-users` (`guardedLazy`, `ROUTE_ACCESS['entra-users']` = `users:manage` มีแล้ว)
  - i18n `users.entraSync.*` th/en ครบตาม key ที่ port มา (ตัด key ของ department / phone)

- [ ] **Step 1: Port unit test** ของ `entraSync.test.ts`, `entraBulk.test.ts`, `entraLink.test.ts` จาก reference (ตัดกรณี department / phone / company) — Run: FAIL
- [ ] **Step 2: เขียน page test ที่ fail**

```tsx
it('lists directory rows with their status', async () => { /* mock entraDirectory ⇒ แถว missing / linked / conflict แสดงป้ายถูก */ });
it('creates several accounts with one role and reports partial failures', async () => {
  // เลือก 3 แถว missing · role OPERATOR · POST ตัวที่ 2 ตอบ 409 USERNAME_TAKEN
  // ⇒ สรุป "สร้างแล้ว 2 · ไม่สำเร็จ 1" และแถวที่ล้มแสดง message ของ server (Review Focus 3)
});
it('shows the server message when Graph is not configured', async () => {
  // entraDirectory ตอบ 400 GRAPH_NOT_CONFIGURED ⇒ AsyncState แสดงข้อความนั้น (Review Focus 4)
});
it('role picker comes from GET /roles', async () => { /* ไม่มี ADMIN เมื่อ server ไม่ส่งมา */ });
// router.test.tsx: /entra-users ด้วย users:manage ⇒ render หน้า · ไม่มีสิทธิ์ ⇒ หน้า 403 เดิม
// nav.test.ts: เมนู ผู้ใช้จาก Entra มี to '/entra-users'
```

- [ ] **Step 3: Run** — Expected: FAIL
- [ ] **Step 4: Implement** port หน้า + helpers ให้เข้ากับ design system ของ repo นี้ (`PageHeader`, `DataTableFrame`, `DataToolbar`, `DataPagination`, `AsyncState`, `confirm-dialog`) · การสร้างหลายรายการเรียก `POST /users` ทีละแถว (≤ 50) แล้วสรุปผล · ปุ่ม sync แบบ apply เรียก `syncEntra({ dryRun: false })` หลังยืนยัน
- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run lint` — Expected: PASS (รวม i18n parity + design guard)
- [ ] **Step 6: Commit** (เสนอ message — ผู้ใช้ commit เอง) `feat(client): Entra users page`

### Task 3: แก้ residual ของ session / realtime ที่ park ไว้จากแผนเดิม

> รายการจาก ledger เดิม ("Final residual (parked)") ที่จะเจอทันทีเมื่อต่อ server จริง · รายการ refactor อื่น (M1 cross-feature imports, M2, M3, M9, M10, M12, M14, nginx security headers, bundle split) ยกไปต้น P1 ตาม ruling CR8

**Files:**
- Modify: `client/src/providers/RealtimeProvider.tsx`, `client/src/lib/apiClient.ts`, `client/src/components/layout/AppHeader.tsx`, `client/src/app/providers.tsx`, `client/src/components/AppLayout.tsx`, `client/src/features/auth/LoginPage.tsx`
- Test: `client/src/providers/RealtimeProvider.test.tsx`, `client/src/lib/apiClient.test.ts`, `client/src/components/AppLayout.test.tsx`

**Interfaces:**
- Produces:
  - `RealtimeProvider`: ต่อ socket ใหม่เมื่อ `accessToken` เปลี่ยนและ `!socket.active` (เดิมผูกกับ boolean `hasToken` ⇒ ถูกปฏิเสธตอน server ล่มแล้วไม่กลับมา)
  - `apiClient`: ทุก request บันทึก `epoch` ของ store ตอนส่ง · 401 ที่ `epoch` ไม่ตรงปัจจุบัน ⇒ ไม่ refresh (กัน 401 ค้างจากก่อน logout ทำให้ login กลับเงียบ ๆ / หมุน cookie ระหว่าง logout) · axios `timeout` 15000 ms
  - logout (`AppHeader`): `clear()` ฝั่ง client ก่อนแล้วค่อยส่ง `POST /auth/logout` แบบไม่รอผล · ไม่ส่ง logout เมื่อ session หมดไปแล้ว (token null) และไม่ทับ notice `sessionExpired`
  - `<Toaster />` ตัวเดียวใน `app/providers.tsx` (ลบออกจาก `AppLayout` และ `LoginPage`)

- [ ] **Step 1: เขียน test ที่ fail** — socket ถูกปฏิเสธ (`connect_error` `unauthorized`) แล้ว `setAuth` ด้วย token ใหม่ ⇒ `connect()` ถูกเรียกอีกครั้ง · 401 ของ request ที่ส่งก่อน `clear()` ⇒ ไม่มีการเรียก `/auth/refresh` · logout ⇒ store ว่างทันทีแม้ `POST /auth/logout` ยังไม่ตอบ · หน้า login หลัง session หมดยังแสดง notice `sessionExpired` หลังกด logout · render app มี Toaster 1 ตัว
- [ ] **Step 2: Run** `npx vitest run src/providers src/lib src/components` — Expected: FAIL
- [ ] **Step 3: Implement** ตาม Interfaces
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `fix(client): realtime reconnect, stale 401 refresh, logout flow`

### Task 4: ต่อ server จริงบนเครื่อง dev local + แก้ contract ที่ไม่ตรง

> ทำหลัง server Task 11 · ใช้ `docs/runbooks/local-dev.md`

**Files:**
- Modify: ไฟล์ที่ contract ไม่ตรง (ถ้ามี) · `client/.env.example` (คำอธิบาย local dev)
- Test: unit test ของจุดที่แก้

- [ ] **Step 1:** รัน server (`start:api:dev` + `start:worker:dev`) กับ DB ที่ seed แล้ว และ `npm run dev` ใน `client/` — Expected: เปิด `http://localhost:5173` เห็นหน้า login
- [ ] **Step 2: ตรวจมือตาม checklist นี้แล้วจดผล:**
  - login `admin` ⇒ เมนู 12 รายการ · login `companyadmin1` ⇒ ไม่มี ประวัติการใช้งาน / ตั้งค่าระบบ · login `viewer1` ⇒ พนักงานอ่านอย่างเดียว ไม่มีเมนู ผู้ใช้ระบบ
  - `companyadmin1`: รายการผู้ใช้ไม่มี `admin` · สร้าง / แก้ / ระงับ / คืนสิทธิ์ / ลบ `OPERATOR` ได้ · matrix อ่านอย่างเดียว
  - `admin`: แก้ matrix ได้ ช่องสงวนล็อก · แก้ setting `auth.max-failed-logins` · audit log มีแถวของการกระทำข้างบน
  - พนักงาน: สร้าง / แก้ / ผูกบัญชี / ลบ · code ซ้ำแสดงข้อความ 409 ของ server
  - ระงับบัญชีที่เปิดอีกแท็บไว้ ⇒ แท็บนั้นออกจากระบบพร้อมข้อความ `auth.sessionRevoked`
  - ตั้ง `ACCESS_TOKEN_TTL=1m` ชั่วคราว ⇒ ใช้งานต่อเกิน 1 นาทีไม่เด้ง login (Review Focus 5)
  - Entra: login SSO (ถ้ามี redirect URI `http://localhost:5173`) · หน้า ผู้ใช้จาก Entra (ถ้าตั้ง `GRAPH_*`) — ไม่มีให้บันทึกว่าค้างไว้
- [ ] **Step 3:** ทุกจุดที่ contract ไม่ตรง ⇒ แก้ฝั่งที่ผิดจาก spec (client หรือ server) พร้อม unit test · ถ้า spec เองผิด แก้ blueprint
- [ ] **Step 4: Run** `npm test && npm run build` ใน `client/` และ `npm run ci` ใน `server/` — Expected: PASS
- [ ] **Step 5: Commit** (เสนอ message — ผู้ใช้ commit เอง) `fix(client): align with the real P0 API`

---

## Done when

- ทุกหน้าของ P0 (login, พนักงาน, ผู้ใช้ระบบ, ผู้ใช้จาก Entra, ตั้งค่าระบบ, ประวัติการใช้งาน) ทำงานกับ server จริงบนเครื่อง dev ตาม checklist ใน Task 4
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` ผ่าน · design guard tests ผ่าน · i18n parity ผ่าน
- acceptance P0 ฝั่ง client (Part 8): sidebar ของ `ADMIN` มี 12 เมนู · หน้าว่างของ shell ตรง DESIGN.md (light / dark) · หน้า ผู้ใช้จาก Entra สร้างบัญชีได้ทั้งทีละรายการและหลายรายการ
