import type { InboundEnvelopeV1 } from '../inbound/inbound-body';
import { payloadHash } from './payload-hash';

export type CanonicalBookingStatus = 1 | 2 | 3 | 4 | 5 | 9;

const STATUS_MAP: Record<string, CanonicalBookingStatus> = {
  NEW: 1, SCHEDULED: 1,
  CONFIRMED: 2, ASSIGNED: 2,
  IN_PROGRESS: 3, ON_SITE: 3,
  DONE: 4, COMPLETED: 4, CLOSED: 4,
  CANCELLED: 5, REJECTED: 5,
};

/** Case- and space-insensitive; anything unknown ⇒ 9. */
export function canonicalStatus(raw: string): CanonicalBookingStatus {
  return STATUS_MAP[raw.trim().toUpperCase()] ?? 9;
}

export type BookingJobSnapshot = {
  externalJobId: string;
  externalJobNo: string | null;
  doNo: string | null;
  shNo: string | null;
  externalVersion: string | null;
  externalUpdatedAt: Date | null;
  status: CanonicalBookingStatus;
  rawStatus: string;
  title: string | null;
  teamRef: string | null;
  leaderRef: string | null;
  scheduledDate: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  deviceRefs: string[];
  siteName: string | null;
  siteAddress: string | null;
  siteLat: number | null;
  siteLng: number | null;
  raw: unknown;
  payloadHash: string;
};

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** Validation lets empty strings through; the mapper treats blank as absent (title, teamRef, leaderRef, deviceRefs). */
const ref = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const date = (v: unknown): Date | null => (typeof v === 'string' ? new Date(v) : null);

export function mapV1(env: InboundEnvelopeV1): BookingJobSnapshot {
  const job = env.job;
  const site = job.site ?? null;
  const deviceRefs = [...new Set((job.deviceRefs ?? []).map((r) => r.trim()).filter((r) => r !== ''))];
  return {
    externalJobId: job.jobId,
    externalJobNo: text(job.jobNo),
    doNo: text(job.doNo),
    shNo: text(job.shNo),
    externalVersion: job.version === undefined || job.version === null ? null : String(job.version),
    externalUpdatedAt: date(job.updatedAt),
    status: canonicalStatus(job.status),
    rawStatus: job.status,
    title: ref(job.title),
    teamRef: ref(job.teamRef),
    leaderRef: ref(job.leaderRef),
    scheduledDate: text(job.scheduledDate),
    plannedStartAt: date(job.plannedStartAt),
    plannedEndAt: date(job.plannedEndAt),
    checkInAt: date(job.checkInAt),
    checkOutAt: date(job.checkOutAt),
    deviceRefs,
    siteName: text(site?.name),
    siteAddress: text(site?.address),
    siteLat: typeof site?.lat === 'number' ? site.lat : null,
    siteLng: typeof site?.lng === 'number' ? site.lng : null,
    raw: env,
    payloadHash: payloadHash(job),
  };
}
