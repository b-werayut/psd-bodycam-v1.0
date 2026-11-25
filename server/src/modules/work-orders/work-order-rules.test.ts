import { describe, expect, it } from 'vitest';
import {
  decideWorkOrderStatus, formatWorkOrderNo, isCheckedIn, workOrderPeriod, workOrderTitle, type CurrentWorkOrder, type JobFacts, type WoStatus,
} from './work-order-rules';

const now = new Date('2026-11-25T03:00:00Z');
const t = (s: string) => new Date(s);
const cur = (status: WoStatus, closedAt: Date | null, closeReason: 1 | 3 | null = status === 2 ? 1 : null, openedAt: Date | null = null): CurrentWorkOrder => ({ status, closeReason, openedAt, closedAt });
const job = (o: Partial<JobFacts> = {}): JobFacts => ({ status: 1, checkInAt: null, checkOutAt: null, ...o });

describe('decideWorkOrderStatus (design §4.7)', () => {
  it('new, no check-in ⇒ Planned', () => {
    expect(decideWorkOrderStatus(null, job(), now)).toEqual({ status: 6, closeReason: null, openedAt: null, closedAt: null, flagChangedAfterClose: false });
  });
  it('IN_PROGRESS without check-in stays Planned', () => {
    expect(decideWorkOrderStatus(cur(6, null), job({ status: 3 }), now).status).toBe(6);
  });
  it('check-in ⇒ Open, openedAt = checkInAt', () => {
    const d = decideWorkOrderStatus(cur(6, null), job({ status: 3, checkInAt: t('2026-11-25T01:00:00Z') }), now);
    expect(d).toEqual({ status: 1, closeReason: null, openedAt: t('2026-11-25T01:00:00Z'), closedAt: null, flagChangedAfterClose: false });
  });
  it('check-out ⇒ Closed BookingCheckout, closedAt = checkOutAt', () => {
    const d = decideWorkOrderStatus(cur(1, null), job({ checkInAt: t('2026-11-25T01:00:00Z'), checkOutAt: t('2026-11-25T02:00:00Z') }), now);
    expect(d).toMatchObject({ status: 2, closeReason: 1, closedAt: t('2026-11-25T02:00:00Z') });
  });
  it('check-out without check-in ⇒ Closed', () => {
    expect(decideWorkOrderStatus(null, job({ checkOutAt: t('2026-11-25T02:00:00Z') }), now).status).toBe(2);
  });
  it('Completed without checkOutAt ⇒ Closed at now', () => {
    expect(decideWorkOrderStatus(cur(1, null), job({ status: 4, checkInAt: t('2026-11-25T01:00:00Z') }), now))
      .toMatchObject({ status: 2, closeReason: 1, closedAt: now });
  });
  it('Completed again on a Closed order keeps its closedAt', () => {
    const closedAt = t('2026-11-24T00:00:00Z');
    expect(decideWorkOrderStatus(cur(2, closedAt), job({ status: 4 }), now).closedAt).toEqual(closedAt);
  });
  it('check-in after check-out on a Closed order ⇒ Open again, closedAt null', () => {
    const d = decideWorkOrderStatus(
      cur(2, t('2026-11-25T02:00:00Z')),
      job({ checkInAt: t('2026-11-25T02:30:00Z'), checkOutAt: t('2026-11-25T02:00:00Z') }),
      now,
    );
    expect(d).toEqual({ status: 1, closeReason: null, openedAt: t('2026-11-25T02:30:00Z'), closedAt: null, flagChangedAfterClose: false });
  });
  it('cancel on Planned / Open ⇒ Cancelled, closedAt = now', () => {
    for (const status of [6, 1] as const) {
      expect(decideWorkOrderStatus(cur(status, null), job({ status: 5 }), now))
        .toEqual({ status: 3, closeReason: null, openedAt: null, closedAt: now, flagChangedAfterClose: false });
    }
    expect(decideWorkOrderStatus(null, job({ status: 5 }), now).status).toBe(3);
  });
  it('cancel on Closed ⇒ stays Closed, echoes closeReason / openedAt / closedAt, flagChangedAfterClose', () => {
    const closedAt = t('2026-11-25T02:00:00Z');
    const openedAt = t('2026-11-25T01:00:00Z');
    expect(decideWorkOrderStatus(cur(2, closedAt, 1, openedAt), job({ status: 5 }), now))
      .toEqual({ status: 2, closeReason: 1, openedAt, closedAt, flagChangedAfterClose: true });
  });
  it('cancel on a Closed order with SafetyTimeout (3) keeps closeReason 3', () => {
    const closedAt = t('2026-11-25T02:00:00Z');
    const openedAt = t('2026-11-20T01:00:00Z');
    expect(decideWorkOrderStatus(cur(2, closedAt, 3, openedAt), job({ status: 5, checkInAt: t('2026-11-25T00:00:00Z') }), now))
      .toEqual({ status: 2, closeReason: 3, openedAt, closedAt, flagChangedAfterClose: true });
  });
  it('repeated canonical 4 on a Closed order echoes closeReason / openedAt / closedAt', () => {
    const closedAt = t('2026-11-24T00:00:00Z');
    const openedAt = t('2026-11-23T00:00:00Z');
    expect(decideWorkOrderStatus(cur(2, closedAt, 3, openedAt), job({ status: 4 }), now))
      .toEqual({ status: 2, closeReason: 3, openedAt, closedAt, flagChangedAfterClose: false });
  });
  it('checkInAt == checkOutAt ⇒ Closed', () => {
    const same = t('2026-11-25T01:00:00Z');
    expect(decideWorkOrderStatus(null, job({ checkInAt: same, checkOutAt: same }), now))
      .toMatchObject({ status: 2, closeReason: 1, closedAt: same });
  });
  it('canonical 4 with a later check-in ⇒ Closed (spec precedence)', () => {
    const d = decideWorkOrderStatus(null, job({ status: 4, checkInAt: t('2026-11-25T02:30:00Z'), checkOutAt: t('2026-11-25T02:00:00Z') }), now);
    expect(d).toMatchObject({ status: 2, closeReason: 1, closedAt: t('2026-11-25T02:00:00Z') });
  });
  it('check-in on a Cancelled order ⇒ Open', () => {
    const d = decideWorkOrderStatus(cur(3, now), job({ status: 3, checkInAt: t('2026-11-25T02:00:00Z') }), now);
    expect(d).toEqual({ status: 1, closeReason: null, openedAt: t('2026-11-25T02:00:00Z'), closedAt: null, flagChangedAfterClose: false });
  });
  it('cancel on a Cancelled order keeps its closedAt', () => {
    const closedAt = t('2026-11-24T00:00:00Z');
    expect(decideWorkOrderStatus(cur(3, closedAt), job({ status: 5 }), now).closedAt).toEqual(closedAt);
  });
});

describe('isCheckedIn', () => {
  it('needs checkInAt and no later check-out', () => {
    expect(isCheckedIn(job())).toBe(false);
    expect(isCheckedIn(job({ checkInAt: t('2026-11-25T01:00:00Z') }))).toBe(true);
    expect(isCheckedIn(job({ checkInAt: t('2026-11-25T01:00:00Z'), checkOutAt: t('2026-11-25T02:00:00Z') }))).toBe(false);
    expect(isCheckedIn(job({ checkInAt: t('2026-11-25T01:00:00Z'), checkOutAt: t('2026-11-25T01:00:00Z') }))).toBe(false);
  });
});

describe('work order number and title', () => {
  it('Bangkok month: 2026-11-30T17:30:00Z ⇒ 202612', () => {
    expect(workOrderPeriod(t('2026-11-30T17:30:00Z'))).toBe('202612');
    expect(workOrderPeriod(t('2026-11-30T16:59:59Z'))).toBe('202611');
  });
  it('WO-202611-00042', () => {
    expect(formatWorkOrderNo('202611', 42)).toBe('WO-202611-00042');
    expect(formatWorkOrderNo('202611', 123456)).toBe('WO-202611-123456');
  });
  it('title falls back to jobNo then jobId', () => {
    expect(workOrderTitle({ title: 'T', externalJobNo: 'N', externalJobId: 'J' })).toBe('T');
    expect(workOrderTitle({ title: null, externalJobNo: 'N', externalJobId: 'J' })).toBe('N');
    expect(workOrderTitle({ title: null, externalJobNo: null, externalJobId: 'J' })).toBe('J');
  });
});
