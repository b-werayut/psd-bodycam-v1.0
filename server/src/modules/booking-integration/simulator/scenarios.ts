import type { InboundEnvelopeV1, InboundJobV1 } from '../inbound/inbound-body';

/** Builds the envelopes the `booking:simulate` CLI sends, playing the role of Smart Booking (v1 contract). */

export type SimOptions = { jobId?: string; camera: string; team: string; leader: string; count: number };

export const SIM_DEFAULTS: SimOptions = { camera: '1000027', team: 'TEAM-DEMO', leader: 'BK-EMP-0002', count: 200 };

export const SIM_SCENARIOS = ['new', 'checkin', 'checkout', 'cancel', 'duplicate', 'out-of-order', 'bad-signature', 'burst', 'demo'] as const;
export type SimScenario = (typeof SIM_SCENARIOS)[number];

export type SimRequest = { envelope: InboundEnvelopeV1; corruptSignature?: boolean };

const BKK_OFFSET_MS = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-8601 with the +07:00 offset (what Booking sends). */
function bkk(d: Date): string {
  const s = new Date(d.getTime() + BKK_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}T${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}+07:00`;
}

/** Midnight Asia/Bangkok of the day containing `d`, shifted by `days`, as an instant. */
function bkkMidnight(d: Date, days = 0): Date {
  const s = new Date(d.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + days) - BKK_OFFSET_MS);
}

const hours = (h: number) => h * 3600_000;

type Shape = {
  jobId: string;
  version: number;
  status: string;
  now: Date;
  opts: SimOptions;
  title: string;
  site: string;
  no: string;
  plannedStartAt: Date;
  plannedEndAt: Date;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  eventId?: string;
};

function job(s: Shape): InboundEnvelopeV1 {
  const j: InboundJobV1 = {
    jobId: s.jobId,
    status: s.status,
    version: s.version,
    updatedAt: bkk(s.now),
    jobNo: `BK-${s.no}`,
    doNo: `DO-${s.no}`,
    shNo: `SH-${s.no}`,
    title: s.title,
    teamRef: s.opts.team,
    leaderRef: s.opts.leader,
    scheduledDate: bkk(s.plannedStartAt).slice(0, 10),
    plannedStartAt: bkk(s.plannedStartAt),
    plannedEndAt: bkk(s.plannedEndAt),
    checkInAt: s.checkInAt ? bkk(s.checkInAt) : null,
    checkOutAt: s.checkOutAt ? bkk(s.checkOutAt) : null,
    deviceRefs: [s.opts.camera],
    site: { name: s.site, address: 'กรุงเทพมหานคร', lat: 13.7563, lng: 100.5018 },
  };
  const env: InboundEnvelopeV1 = { eventType: 'job.updated', occurredAt: bkk(s.now), job: j };
  if (s.eventId) env.eventId = s.eventId;
  return env;
}

function requireJob(name: string, opts: SimOptions): string {
  if (!opts.jobId) throw new Error(`scenario ${name} requires --job <jobId> (an existing job, e.g. the jobId printed by scenario new)`);
  return opts.jobId;
}

export function buildScenario(name: SimScenario, opts: SimOptions, now: Date): SimRequest[] {
  const stamp = now.getTime().toString(36).toUpperCase();
  const freshId = () => opts.jobId ?? `SIM-${stamp}`;
  const start = new Date(now.getTime() + hours(2));
  // For changes to an existing job the server must see a version higher than any it holds from earlier runs:
  // the unix time in seconds grows with every separate CLI run.
  const clockVersion = Math.floor(now.getTime() / 1000);

  const planned = (id: string, no: string, version = 1, eventId?: string): InboundEnvelopeV1 =>
    job({
      jobId: id, version, status: 'SCHEDULED', now, opts, no, eventId,
      title: 'ติดตั้งอุปกรณ์ตามแผน (จำลอง)', site: 'ไซต์งานจำลอง A',
      plannedStartAt: start, plannedEndAt: new Date(start.getTime() + hours(2)),
    });

  switch (name) {
    case 'new':
      return [{ envelope: planned(freshId(), stamp) }];

    case 'checkin': {
      const id = requireJob(name, opts);
      return [{
        envelope: job({
          jobId: id, version: clockVersion, status: 'IN_PROGRESS', now, opts, no: id, title: 'งานตรวจสอบหน้างาน (จำลอง)', site: 'ไซต์งานจำลอง A',
          plannedStartAt: new Date(now.getTime() - hours(1)), plannedEndAt: new Date(now.getTime() + hours(3)), checkInAt: now,
        }),
      }];
    }

    case 'checkout': {
      const id = requireJob(name, opts);
      const checkIn = new Date(now.getTime() - hours(2));
      return [{
        envelope: job({
          jobId: id, version: clockVersion, status: 'COMPLETED', now, opts, no: id, title: 'งานตรวจสอบหน้างาน (จำลอง)', site: 'ไซต์งานจำลอง A',
          plannedStartAt: checkIn, plannedEndAt: now, checkInAt: checkIn, checkOutAt: now,
        }),
      }];
    }

    case 'cancel': {
      const id = requireJob(name, opts);
      return [{
        envelope: job({
          jobId: id, version: clockVersion, status: 'CANCELLED', now, opts, no: id, title: 'งานที่ถูกยกเลิก (จำลอง)', site: 'ไซต์งานจำลอง A',
          plannedStartAt: start, plannedEndAt: new Date(start.getTime() + hours(2)),
        }),
      }];
    }

    case 'duplicate': {
      const id = freshId();
      const eventId = `evt-${id}`;
      return [{ envelope: planned(id, stamp, 1, eventId) }, { envelope: planned(id, stamp, 1, eventId) }];
    }

    case 'out-of-order': {
      // version 3 arrives first; version 2 follows with the same updatedAt, so the version decides: it is
      // ignored (inbox row `Ignored`) and the job keeps version 3's data
      const id = freshId();
      const mk = (version: number, status: string): InboundEnvelopeV1 =>
        job({
          jobId: id, version, status, now, opts, no: stamp, title: 'งานลำดับสลับ (จำลอง)', site: 'ไซต์งานจำลอง A',
          plannedStartAt: start, plannedEndAt: new Date(start.getTime() + hours(2)),
          checkInAt: version >= 3 ? now : null,
        });
      return [{ envelope: mk(3, 'IN_PROGRESS') }, { envelope: mk(2, 'SCHEDULED') }];
    }

    case 'bad-signature':
      return [{ envelope: planned(freshId(), stamp), corruptSignature: true }];

    case 'burst': {
      const out: SimRequest[] = [];
      for (let i = 1; i <= opts.count; i++) out.push({ envelope: planned(`SIM-${stamp}-${i}`, `${stamp}-${i}`) });
      return out;
    }

    case 'demo': {
      const today = bkkMidnight(now);
      const yesterday = bkkMidnight(now, -1);
      const lateToday = new Date(today.getTime() + hours(23));
      const plannedStart = start.getTime() < lateToday.getTime() ? start : lateToday;
      const id = (k: string) => `SIM-${stamp}-${k}`;
      return [
        {
          envelope: job({
            jobId: id('PLANNED'), version: 1, status: 'SCHEDULED', now, opts, no: `${stamp}-P`, title: 'ตรวจเยี่ยมลูกค้า รอเริ่มงาน (จำลอง)', site: 'โรงงานตัวอย่าง สมุทรปราการ',
            plannedStartAt: plannedStart, plannedEndAt: new Date(plannedStart.getTime() + hours(2)),
          }),
        },
        {
          envelope: job({
            jobId: id('OPEN'), version: 1, status: 'IN_PROGRESS', now, opts, no: `${stamp}-O`, title: 'ซ่อมบำรุงเครื่องจักร กำลังดำเนินการ (จำลอง)', site: 'คลังสินค้าตัวอย่าง ลาดกระบัง',
            plannedStartAt: new Date(now.getTime() - hours(1)), plannedEndAt: new Date(now.getTime() + hours(3)), checkInAt: new Date(now.getTime() - hours(1)),
          }),
        },
        {
          envelope: job({
            jobId: id('CLOSED'), version: 1, status: 'COMPLETED', now, opts, no: `${stamp}-C`, title: 'ส่งมอบอุปกรณ์ เสร็จสิ้นเมื่อวาน (จำลอง)', site: 'สำนักงานตัวอย่าง บางนา',
            plannedStartAt: new Date(yesterday.getTime() + hours(8.5)), plannedEndAt: new Date(yesterday.getTime() + hours(12)),
            checkInAt: new Date(yesterday.getTime() + hours(9)), checkOutAt: new Date(yesterday.getTime() + hours(11)),
          }),
        },
      ];
    }
  }
}
