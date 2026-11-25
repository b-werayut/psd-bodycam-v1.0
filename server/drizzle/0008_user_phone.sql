ALTER TABLE "Users" ADD COLUMN "Phone" varchar(30);
--> statement-breakpoint
UPDATE "Users" AS u SET "Phone" = e."Phone"
FROM "Employees" AS e
WHERE e."UserId" = u."Id" AND e."IsDeleted" = false AND e."Phone" IS NOT NULL;
