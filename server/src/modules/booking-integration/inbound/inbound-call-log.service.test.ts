import { describe, expect, it } from 'vitest';
import { capUtf8, excerptOf, safeErrorSummary } from './inbound-call-log.service';

describe('excerptOf / capUtf8', () => {
  it('caps by UTF-8 bytes and never splits a Thai character', () => {
    const thai = 'ใบงาน'.repeat(3000);
    for (const input of [thai, Buffer.from(thai)]) {
      const out = excerptOf(input)!;
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(4096);
      expect(Buffer.byteLength(out)).toBeGreaterThan(4090 - 3);
      expect(out).not.toContain('�');
      expect(thai.startsWith(out)).toBe(true);
    }
  });

  it('keeps short text as is', () => {
    expect(capUtf8('abc')).toBe('abc');
  });
});

describe('safeErrorSummary', () => {
  it('a DrizzleQueryError-like error is summarised without its params', () => {
    const err = Object.assign(new Error('Failed query: insert into "IntegrationInbox" ...\nparams: {"job":"SECRET-BODY"}'), {
      name: 'DrizzleQueryError',
      cause: new Error('connection refused'),
    });
    const s = safeErrorSummary(err);
    expect(s).toBe('DrizzleQueryError: connection refused');
    expect(s).not.toContain('SECRET-BODY');
    expect(s).not.toContain('params');
  });

  it('without a cause the message is cut to 300 chars', () => {
    expect(safeErrorSummary(new Error('x'.repeat(1000))).length).toBe(300);
  });
});
