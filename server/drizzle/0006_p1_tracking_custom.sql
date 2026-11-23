-- P1 custom SQL (Part 4 §4.9): what drizzle-kit cannot express.
-- GpsLocations is partitioned by month on "RecordedAt" (typed table in src/db/schema.partitioned.ts).
-- Later months come from the worker job PartitionMaintenance (2 months ahead, idempotent).
CREATE TABLE "GpsLocations" (
  "DeviceId"       bigint           NOT NULL,
  "RecordedAt"     timestamptz      NOT NULL,
  "ReceivedAt"     timestamptz      NOT NULL DEFAULT now(),
  "Lat"            double precision NOT NULL,
  "Lng"            double precision NOT NULL,
  "SpeedKph"       real,
  "Heading"        smallint,
  "AltitudeM"      real,
  "SatelliteCount" smallint,
  "IsValidFix"     boolean          NOT NULL DEFAULT true,
  "BatteryPercent" smallint,
  CONSTRAINT "PK_GpsLocations" PRIMARY KEY ("DeviceId", "RecordedAt")
) PARTITION BY RANGE ("RecordedAt");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GpsLocations_default" PARTITION OF "GpsLocations" DEFAULT;
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
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "GpsLocations" FOR VALUES FROM (%L) TO (%L)',
      'GpsLocations_' || to_char(month_start + make_interval(months => i), 'YYYYMM'),
      from_ts,
      to_ts
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- on the parent table: every partition (including future ones) gets it
CREATE INDEX "IX_GpsLocations_RecordedAt_brin" ON "GpsLocations" USING brin ("RecordedAt");
--> statement-breakpoint
-- two leaders of one team never overlap in time; tstzrange(a, NULL) has no upper bound
ALTER TABLE "TeamMembers" ADD CONSTRAINT "EX_TeamMembers_LeaderNoOverlap"
  EXCLUDE USING gist ("TeamId" WITH =, tstzrange("ValidFrom", "ValidTo", '[)') WITH &&)
  WHERE ("Role" = 1);
--> statement-breakpoint
-- P1 settings (Part 3 §3.11). Bounds live in src/common/settings/setting-spec.ts.
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('gps.poll-interval-seconds', '15', 2, 'tracking', 'รอบการดึงตำแหน่งและสถานะกล้องจาก DSS (วินาที) · status.unknown-after-seconds ต้องไม่น้อยกว่า 2 เท่าของค่านี้'),
  ('status.unknown-after-seconds', '120', 2, 'tracking', 'ไม่ได้ข้อมูลจากกล้องนานเกินนี้ (วินาที) ถือว่าไม่ทราบสถานะ'),
  ('status.display-cache-seconds', '10', 2, 'tracking', 'อายุ cache สถานะกล้องที่แสดงบนหน้าจอ (วินาที) · 0 = ไม่ cache'),
  ('depot.fix-max-age-minutes', '30', 2, 'tracking', 'อายุสูงสุดของตำแหน่งล่าสุดที่ใช้ตรวจว่ากล้องอยู่ที่ฐาน (นาที)'),
  ('tracking.stop-min-minutes', '5', 2, 'tracking', 'จอดนิ่งนานอย่างน้อยเท่านี้จึงแสดงเป็นจุดจอดในประวัติเส้นทาง (นาที)'),
  ('tracking.stop-radius-meters', '50', 2, 'tracking', 'รัศมีที่ถือว่ายังจอดอยู่ที่เดิมในประวัติเส้นทาง (เมตร)')
ON CONFLICT ("SettingKey") DO NOTHING;
