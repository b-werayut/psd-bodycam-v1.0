-- Reference data (P0): roles, permission catalog, default role grants, auth settings.
-- Source of truth: src/common/auth/permission-catalog.ts (Part 5 §5.7) — reference-data.int-test.ts checks this file against it.
-- Idempotent (ON CONFLICT DO NOTHING): a re-run never overwrites grants or settings an ADMIN has changed.
-- Later phases add a NEW migration together with the catalog change; never edit this one after go-live.
INSERT INTO "Roles" ("Code", "Name", "Description", "IsSystem") VALUES
  ('ADMIN', 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบของทีมพัฒนา/ดูแลระบบ — ข้ามการตรวจสิทธิ์และขอบเขตข้อมูล (ยังถูกบันทึก audit)', true),
  ('COMPANY_ADMIN', 'ผู้ดูแลบริษัท', 'ผู้ดูแลบริษัท — สิทธิ์ของผู้ปฏิบัติการ + จัดการพนักงานและผู้ใช้ (ยกเว้นบัญชีผู้ดูแลระบบ)', true),
  ('OPERATOR', 'ผู้ปฏิบัติการ', 'ผู้ปฏิบัติการ — ติดตามกล้อง ดูภาพสด/ย้อนหลัง export วิดีโอ และรับทราบแจ้งเตือน', true),
  ('VIEWER', 'ผู้ดูข้อมูล', 'ผู้ดูข้อมูล — ดูแดชบอร์ด แผนที่ ใบงาน และแจ้งเตือนได้อย่างเดียว', true)
ON CONFLICT ("Code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Permissions" ("Code", "Resource", "Action") VALUES
  ('dashboard:view', 'dashboard', 'view'),
  ('tracking:view', 'tracking', 'view'),
  ('tracking:history', 'tracking', 'history'),
  ('work-orders:read', 'work-orders', 'read'),
  ('work-orders:edit-note', 'work-orders', 'edit-note'),
  ('booking:read', 'booking', 'read'),
  ('booking:refresh', 'booking', 'refresh'),
  ('devices:read', 'devices', 'read'),
  ('org:read', 'org', 'read'),
  ('org:manage', 'org', 'manage'),
  ('users:read', 'users', 'read'),
  ('users:manage', 'users', 'manage'),
  ('roles:manage', 'roles', 'manage'),
  ('streaming:view-live', 'streaming', 'view-live'),
  ('streaming:live-wall', 'streaming', 'live-wall'),
  ('streaming:talk', 'streaming', 'talk'),
  ('playback:view', 'playback', 'view'),
  ('evidence:export', 'evidence', 'export'),
  ('evidence:download', 'evidence', 'download'),
  ('notifications:read', 'notifications', 'read'),
  ('alerts:view', 'alerts', 'view'),
  ('alerts:manage', 'alerts', 'manage'),
  ('audit:view', 'audit', 'view'),
  ('settings:manage', 'settings', 'manage')
ON CONFLICT ("Code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "RolePermissions" ("RoleId", "PermissionId")
SELECT r."Id", p."Id"
FROM (VALUES
  ('ADMIN', 'dashboard:view'),
  ('ADMIN', 'tracking:view'),
  ('ADMIN', 'tracking:history'),
  ('ADMIN', 'work-orders:read'),
  ('ADMIN', 'work-orders:edit-note'),
  ('ADMIN', 'booking:read'),
  ('ADMIN', 'booking:refresh'),
  ('ADMIN', 'devices:read'),
  ('ADMIN', 'org:read'),
  ('ADMIN', 'org:manage'),
  ('ADMIN', 'users:read'),
  ('ADMIN', 'users:manage'),
  ('ADMIN', 'roles:manage'),
  ('ADMIN', 'streaming:view-live'),
  ('ADMIN', 'streaming:live-wall'),
  ('ADMIN', 'streaming:talk'),
  ('ADMIN', 'playback:view'),
  ('ADMIN', 'evidence:export'),
  ('ADMIN', 'evidence:download'),
  ('ADMIN', 'notifications:read'),
  ('ADMIN', 'alerts:view'),
  ('ADMIN', 'alerts:manage'),
  ('ADMIN', 'audit:view'),
  ('ADMIN', 'settings:manage'),
  ('COMPANY_ADMIN', 'dashboard:view'),
  ('COMPANY_ADMIN', 'tracking:view'),
  ('COMPANY_ADMIN', 'tracking:history'),
  ('COMPANY_ADMIN', 'work-orders:read'),
  ('COMPANY_ADMIN', 'work-orders:edit-note'),
  ('COMPANY_ADMIN', 'booking:read'),
  ('COMPANY_ADMIN', 'booking:refresh'),
  ('COMPANY_ADMIN', 'devices:read'),
  ('COMPANY_ADMIN', 'org:read'),
  ('COMPANY_ADMIN', 'org:manage'),
  ('COMPANY_ADMIN', 'users:read'),
  ('COMPANY_ADMIN', 'users:manage'),
  ('COMPANY_ADMIN', 'streaming:view-live'),
  ('COMPANY_ADMIN', 'streaming:live-wall'),
  ('COMPANY_ADMIN', 'streaming:talk'),
  ('COMPANY_ADMIN', 'playback:view'),
  ('COMPANY_ADMIN', 'evidence:export'),
  ('COMPANY_ADMIN', 'evidence:download'),
  ('COMPANY_ADMIN', 'notifications:read'),
  ('COMPANY_ADMIN', 'alerts:view'),
  ('COMPANY_ADMIN', 'alerts:manage'),
  ('OPERATOR', 'dashboard:view'),
  ('OPERATOR', 'tracking:view'),
  ('OPERATOR', 'tracking:history'),
  ('OPERATOR', 'work-orders:read'),
  ('OPERATOR', 'work-orders:edit-note'),
  ('OPERATOR', 'booking:read'),
  ('OPERATOR', 'booking:refresh'),
  ('OPERATOR', 'devices:read'),
  ('OPERATOR', 'org:read'),
  ('OPERATOR', 'streaming:view-live'),
  ('OPERATOR', 'streaming:live-wall'),
  ('OPERATOR', 'streaming:talk'),
  ('OPERATOR', 'playback:view'),
  ('OPERATOR', 'evidence:export'),
  ('OPERATOR', 'evidence:download'),
  ('OPERATOR', 'notifications:read'),
  ('OPERATOR', 'alerts:view'),
  ('OPERATOR', 'alerts:manage'),
  ('VIEWER', 'dashboard:view'),
  ('VIEWER', 'tracking:view'),
  ('VIEWER', 'tracking:history'),
  ('VIEWER', 'work-orders:read'),
  ('VIEWER', 'booking:read'),
  ('VIEWER', 'devices:read'),
  ('VIEWER', 'org:read'),
  ('VIEWER', 'notifications:read'),
  ('VIEWER', 'alerts:view')
) AS g("RoleCode", "PermissionCode")
JOIN "Roles" r ON r."Code" = g."RoleCode"
JOIN "Permissions" p ON p."Code" = g."PermissionCode"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('auth.max-failed-logins', '3', 2, 'auth', 'จำนวนครั้งที่ใส่รหัสผ่านผิดติดกันก่อนล็อกบัญชีชั่วคราว'),
  ('auth.lockout-minutes', '15', 2, 'auth', 'ระยะเวลาล็อกบัญชีหลังใส่รหัสผ่านผิดครบจำนวน (นาที)')
ON CONFLICT ("SettingKey") DO NOTHING;
