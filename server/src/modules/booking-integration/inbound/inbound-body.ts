/** Booking push contract v1 (Part 7 §7.4, design §4.3). Every field is an [Assumption]. */

export type InboundSiteV1 = {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  [extra: string]: unknown;
};

export type InboundJobV1 = {
  jobId: string;
  status: string;
  version?: number;
  updatedAt?: string;
  jobNo?: string;
  doNo?: string;
  shNo?: string;
  title?: string;
  teamRef?: string;
  leaderRef?: string;
  scheduledDate?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  deviceRefs?: string[];
  site?: InboundSiteV1 | null;
  [extra: string]: unknown;
};

export type InboundEnvelopeV1 = {
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  job: InboundJobV1;
  [extra: string]: unknown;
};

export type InboundIssue = { field: string; issue: string };

export type InboundValidation =
  | { ok: true; value: InboundEnvelopeV1 }
  | { ok: false; details: InboundIssue[] };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoWithOffset = (v: string) => ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v));

function isRealDate(v: string): boolean {
  if (!DATE_ONLY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

class Checker {
  readonly issues: InboundIssue[] = [];

  fail(field: string, issue: string): void {
    this.issues.push({ field, issue });
  }

  /** Optional string (null = absent) with a max length; wrong type or too long ⇒ issue. */
  str(obj: Record<string, unknown>, key: string, path: string, max: number): void {
    const v = obj[key];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string') return this.fail(`${path}${key}`, 'ต้องเป็นข้อความ');
    if (v.length > max) this.fail(`${path}${key}`, `ยาวเกิน ${max} ตัวอักษร`);
  }

  /** Optional free text: cut to length instead of rejecting. */
  text(obj: Record<string, unknown>, key: string, path: string, max: number): void {
    const v = obj[key];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string') return this.fail(`${path}${key}`, 'ต้องเป็นข้อความ');
    if (v.length > max) obj[key] = v.slice(0, max);
  }

  date(obj: Record<string, unknown>, key: string, path: string): void {
    const v = obj[key];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string' || !isIsoWithOffset(v)) this.fail(`${path}${key}`, 'ต้องเป็น ISO-8601 ที่มี offset เช่น 2026-11-25T10:00:00+07:00');
  }

  num(obj: Record<string, unknown>, key: string, path: string, min: number, max: number): void {
    const v = obj[key];
    if (v === undefined || v === null) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) this.fail(`${path}${key}`, `ต้องเป็นตัวเลข ${min} ถึง ${max}`);
  }
}

export function validateInboundBody(body: unknown): InboundValidation {
  if (!isObject(body)) return { ok: false, details: [{ field: 'body', issue: 'ต้องเป็น JSON object' }] };
  if (!isObject(body.job)) return { ok: false, details: [{ field: 'job', issue: 'ต้องมี job เป็น object' }] };

  // Work on a copy: free text gets cut, everything else (unknown fields included) stays as sent.
  const value = { ...body, job: { ...body.job } } as Record<string, unknown> & { job: Record<string, unknown> };
  const job = value.job;
  const c = new Checker();

  c.str(value, 'eventId', '', 200);
  c.str(value, 'eventType', '', 50);
  c.date(value, 'occurredAt', '');

  if (typeof job.jobId !== 'string' || job.jobId.length === 0) c.fail('job.jobId', 'จำเป็น และต้องเป็นข้อความ');
  else if (job.jobId.length > 100) c.fail('job.jobId', 'ยาวเกิน 100 ตัวอักษร');
  if (typeof job.status !== 'string' || job.status.length === 0) c.fail('job.status', 'จำเป็น และต้องเป็นข้อความ');
  else if (job.status.length > 50) c.fail('job.status', 'ยาวเกิน 50 ตัวอักษร');

  const hasVersion = job.version !== undefined && job.version !== null;
  const hasUpdatedAt = job.updatedAt !== undefined && job.updatedAt !== null;
  if (!hasVersion && !hasUpdatedAt) {
    c.fail('job.version', 'ต้องมี version หรือ updatedAt อย่างน้อยหนึ่งตัว');
  }
  if (hasVersion && (typeof job.version !== 'number' || !Number.isInteger(job.version) || job.version < 0)) {
    c.fail('job.version', 'ต้องเป็นจำนวนเต็ม ≥ 0');
  }
  c.date(job, 'updatedAt', 'job.');

  for (const key of ['jobNo', 'doNo', 'shNo']) c.str(job, key, 'job.', 50);
  for (const key of ['teamRef', 'leaderRef']) c.str(job, key, 'job.', 64);
  c.text(job, 'title', 'job.', 300);
  for (const key of ['plannedStartAt', 'plannedEndAt', 'checkInAt', 'checkOutAt']) c.date(job, key, 'job.');

  if (job.scheduledDate !== undefined && job.scheduledDate !== null) {
    if (typeof job.scheduledDate !== 'string' || !isRealDate(job.scheduledDate)) c.fail('job.scheduledDate', 'ต้องเป็นรูปแบบ YYYY-MM-DD');
  }

  if (job.deviceRefs !== undefined && job.deviceRefs !== null) {
    if (!Array.isArray(job.deviceRefs)) c.fail('job.deviceRefs', 'ต้องเป็น array ของข้อความ');
    else {
      if (job.deviceRefs.length > 50) c.fail('job.deviceRefs', 'มีได้ไม่เกิน 50 รายการ');
      job.deviceRefs.slice(0, 50).forEach((ref, i) => {
        if (typeof ref !== 'string') c.fail(`job.deviceRefs[${i}]`, 'ต้องเป็นข้อความ');
        else if (ref.length > 64) c.fail(`job.deviceRefs[${i}]`, 'ยาวเกิน 64 ตัวอักษร');
      });
    }
  }

  if (job.site !== undefined && job.site !== null) {
    if (!isObject(job.site)) c.fail('job.site', 'ต้องเป็น object');
    else {
      const site = { ...job.site };
      job.site = site;
      c.text(site, 'name', 'job.site.', 300);
      c.text(site, 'address', 'job.site.', 1000);
      c.num(site, 'lat', 'job.site.', -90, 90);
      c.num(site, 'lng', 'job.site.', -180, 180);
    }
  }

  if (c.issues.length > 0) return { ok: false, details: c.issues };
  return { ok: true, value: value as InboundEnvelopeV1 };
}

/** eventId ?? `${jobId}:${version}` ?? `${jobId}:${updatedAt as ISO UTC with milliseconds}` — expects a validated envelope. */
export function externalEventIdOf(env: InboundEnvelopeV1): string {
  if (typeof env.eventId === 'string' && env.eventId.length > 0) return env.eventId;
  const { jobId, version, updatedAt } = env.job;
  if (version !== undefined && version !== null) return `${jobId}:${version}`;
  return `${jobId}:${new Date(updatedAt as string).toISOString()}`;
}
