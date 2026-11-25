-- Never discard team history that has no corresponding user account.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "TeamMembers" tm JOIN "Employees" e ON e."Id" = tm."EmployeeId"
    WHERE e."UserId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove Employees: link every team member to a user account first';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "Users" ADD COLUMN "BookingEmployeeRef" varchar(64);
--> statement-breakpoint
UPDATE "Users" u SET "BookingEmployeeRef" = e."BookingEmployeeRef"
FROM "Employees" e WHERE e."UserId" = u."Id" AND e."IsDeleted" = false;
--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Users_BookingEmployeeRef" ON "Users" ("BookingEmployeeRef") WHERE "IsDeleted" = false;
--> statement-breakpoint
ALTER TABLE "TeamMembers" ADD COLUMN "UserId" bigint;
--> statement-breakpoint
UPDATE "TeamMembers" tm SET "UserId" = e."UserId" FROM "Employees" e WHERE e."Id" = tm."EmployeeId";
--> statement-breakpoint
ALTER TABLE "TeamMembers" ALTER COLUMN "UserId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "TeamMembers" ADD CONSTRAINT "TeamMembers_UserId_Users_Id_fk"
FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "UQ_TeamMembers_ActiveEmployee";
--> statement-breakpoint
ALTER TABLE "TeamMembers" DROP COLUMN "EmployeeId";
--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_TeamMembers_ActiveUser" ON "TeamMembers" ("UserId") WHERE "ValidTo" IS NULL;
--> statement-breakpoint
DROP TABLE "Employees";
