-- Preserve existing names before removing the combined column. A mononym has an empty surname.
ALTER TABLE "Users" ADD COLUMN "FirstName" varchar(200);
--> statement-breakpoint
ALTER TABLE "Users" ADD COLUMN "LastName" varchar(200);
--> statement-breakpoint
UPDATE "Users"
SET "FirstName" = substring(btrim("FullName", E' \t\n\r\f\v') FROM '^[^[:space:]]*'),
    "LastName" = regexp_replace(btrim("FullName", E' \t\n\r\f\v'), '^[^[:space:]]+[[:space:]]*', '');
--> statement-breakpoint
ALTER TABLE "Users" ALTER COLUMN "FirstName" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "Users" ALTER COLUMN "LastName" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "Users" DROP COLUMN "FullName";
