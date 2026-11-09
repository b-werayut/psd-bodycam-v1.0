CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "AuditLogs_Id_seq" AS bigint;
--> statement-breakpoint
CREATE TABLE "AuditLogs" (
  "Id"            bigint       NOT NULL DEFAULT nextval('"AuditLogs_Id_seq"'),
  "UserId"        bigint,
  "ActorUsername" varchar(50),
  "ActorRole"     varchar(30),
  "Action"        varchar(50)  NOT NULL,
  "ResourceType"  varchar(50),
  "ResourceId"    bigint,
  "Changes"       jsonb,
  "HttpMethod"    varchar(10),
  "RequestPath"   varchar(300),
  "Result"        smallint     NOT NULL DEFAULT 1,
  "Ip"            varchar(45),
  "UserAgent"     varchar(300),
  "CorrelationId" varchar(64),
  "OccurredAt"    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT "PK_AuditLogs" PRIMARY KEY ("OccurredAt", "Id")
) PARTITION BY RANGE ("OccurredAt");
--> statement-breakpoint
ALTER SEQUENCE "AuditLogs_Id_seq" OWNED BY "AuditLogs"."Id";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AuditLogs_default" PARTITION OF "AuditLogs" DEFAULT;
--> statement-breakpoint
DO $$
DECLARE
  month_start timestamp := date_trunc('month', now() AT TIME ZONE 'UTC');
  i int;
  from_ts timestamptz;
  to_ts timestamptz;
BEGIN
  FOR i IN 0..2 LOOP
    from_ts := (month_start + make_interval(months => i)) AT TIME ZONE 'UTC';
    to_ts := (month_start + make_interval(months => i + 1)) AT TIME ZONE 'UTC';
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "AuditLogs" FOR VALUES FROM (%L) TO (%L)',
      'AuditLogs_' || to_char(month_start + make_interval(months => i), 'YYYYMM'),
      from_ts,
      to_ts
    );
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE INDEX "IX_AuditLogs_Occurred" ON "AuditLogs" ("OccurredAt" DESC);
--> statement-breakpoint
CREATE INDEX "IX_AuditLogs_User" ON "AuditLogs" ("UserId", "OccurredAt" DESC);
