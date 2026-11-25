-- Rename codes in place; role IDs, user assignments and permission grants stay unchanged.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Roles" WHERE "Id" = 1 AND "Code" IN ('SUPERADMIN', 'SUPER_ADMIN'))
     OR NOT EXISTS (SELECT 1 FROM "Roles" WHERE "Id" = 5 AND "Code" IN ('TEAMLEADER', 'TEAM_LEADER')) THEN
    RAISE EXCEPTION 'Role IDs do not match the expected standard role mapping';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "Roles" SET "Code" = 'SUPER_ADMIN', "UpdatedAt" = now()
WHERE "Id" = 1 AND "Code" = 'SUPERADMIN';
--> statement-breakpoint
UPDATE "Roles" SET "Code" = 'TEAM_LEADER', "UpdatedAt" = now()
WHERE "Id" = 5 AND "Code" = 'TEAMLEADER';
--> statement-breakpoint
UPDATE "Roles" SET "Description" = replace("Description", 'SUPERADMIN', 'SUPER_ADMIN'), "UpdatedAt" = now()
WHERE "Description" LIKE '%SUPERADMIN%';
