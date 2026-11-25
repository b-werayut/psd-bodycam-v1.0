-- Keep role IDs and every existing user/grant assignment in place.
DO $$ BEGIN
  IF (SELECT count(*) FROM "Roles" WHERE
      ("Id" = 1 AND "Code" IN ('ADMIN', 'SUPERADMIN')) OR
      ("Id" = 2 AND "Code" IN ('COMPANY_ADMIN', 'ADMIN')) OR
      ("Id" = 3 AND "Code" = 'OPERATOR') OR
      ("Id" = 4 AND "Code" = 'VIEWER')) <> 4
     OR EXISTS (SELECT 1 FROM "Roles" WHERE "Id" = 5 AND "Code" NOT IN ('TEAM_LEADER', 'TEAMLEADER')) THEN
    RAISE EXCEPTION 'Role IDs do not match the expected mapping; resolve role assignments before migrating';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "Roles" SET "Code" = 'SUPERADMIN', "Name" = 'ผู้ดูแลระบบสูงสุด',
  "Description" = 'ผู้ดูแลระบบสูงสุด — จัดการสิทธิ์ ตั้งค่าระบบ และประวัติการใช้งาน', "UpdatedAt" = now()
WHERE "Id" = 1 AND ("Code" <> 'SUPERADMIN' OR "Name" <> 'ผู้ดูแลระบบสูงสุด');
--> statement-breakpoint
UPDATE "Roles" SET "Code" = 'ADMIN', "Name" = 'ผู้ดูแลระบบ',
  "Description" = 'ผู้ดูแลระบบ — จัดการผู้ใช้และงานปฏิบัติการ ยกเว้นบัญชีและสิทธิ์ของ SUPERADMIN', "UpdatedAt" = now()
WHERE "Id" = 2 AND ("Code" <> 'ADMIN' OR "Name" <> 'ผู้ดูแลระบบ');
--> statement-breakpoint
WITH inserted AS (
  INSERT INTO "Roles" ("Id", "Code", "Name", "Description", "IsSystem") OVERRIDING SYSTEM VALUE
  VALUES (5, 'TEAMLEADER', 'หัวหน้าทีม', 'หัวหน้าทีม — ใช้แอปมือถือและข้อมูลของทีมตนเอง', true)
  ON CONFLICT ("Id") DO NOTHING RETURNING "Id"
)
INSERT INTO "RolePermissions" ("RoleId", "PermissionId")
SELECT r."Id", p."Id" FROM inserted r CROSS JOIN "Permissions" p WHERE p."Code" = 'streaming:view-live'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "Roles" SET "Code" = 'TEAMLEADER', "Name" = 'หัวหน้าทีม', "UpdatedAt" = now()
WHERE "Id" = 5 AND ("Code" <> 'TEAMLEADER' OR "Name" <> 'หัวหน้าทีม');
--> statement-breakpoint
SELECT setval(seq::regclass,
  greatest((SELECT max("Id") FROM "Roles"), coalesce(pg_sequence_last_value(seq::regclass), 1)), true)
FROM (SELECT pg_get_serial_sequence('"Roles"', 'Id') AS seq) s;
