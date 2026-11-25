import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BookingInboundController } from './booking-inbound.controller';

describe('BookingInboundController', () => {
  it('receive throwing ⇒ 503 SERVICE_UNAVAILABLE', async () => {
    const service = { receive: vi.fn().mockRejectedValue(new Error('db down')) };
    const controller = new BookingInboundController(service as never);
    const res = { setHeader: vi.fn(), status: vi.fn() };
    await expect(
      controller.receive({ eventId: 'e', job: { jobId: 'J', status: 'NEW', version: 1 } }, res as never),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  it('logs a DB failure without the query params (they hold the whole body)', async () => {
    const err = Object.assign(new Error('Failed query: insert ... params: {"job":"SECRET-BODY"}'), {
      name: 'DrizzleQueryError',
      cause: new Error('connection refused'),
    });
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const controller = new BookingInboundController({ receive: vi.fn().mockRejectedValue(err) } as never);
    await expect(
      controller.receive({ eventId: 'e', job: { jobId: 'J', status: 'NEW', version: 1 } }, {} as never),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const logged = spy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('SECRET-BODY');
    spy.mockRestore();
  });
});
