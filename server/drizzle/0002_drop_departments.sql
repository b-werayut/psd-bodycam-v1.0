-- Single-department system: drop Departments and every DepartmentId column.
-- Order matters: FKs first, then indexes and columns, then the table (no CASCADE, so an
-- unexpected dependent object fails the migration instead of being dropped silently).
ALTER TABLE "Employees" DROP CONSTRAINT "Employees_DepartmentId_Departments_Id_fk";--> statement-breakpoint
ALTER TABLE "Users" DROP CONSTRAINT "Users_DepartmentId_Departments_Id_fk";--> statement-breakpoint
DROP INDEX "IX_Employees_Department";--> statement-breakpoint
DROP INDEX "IX_Users_Department";--> statement-breakpoint
ALTER TABLE "Employees" DROP COLUMN "DepartmentId";--> statement-breakpoint
ALTER TABLE "Users" DROP COLUMN "DepartmentId";--> statement-breakpoint
DROP TABLE "Departments";
