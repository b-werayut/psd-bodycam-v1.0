import { describe, expect, it } from 'vitest';
import type { BookingInboundConfig } from './booking-inbound.config';
import { checkInboundAuth, signBody } from './inbound-auth';

const NOW = Date.parse('2026-11-25T03:00:00Z');
const TS = '1795575600';
const body = Buffer.from('{"job":{"jobId":"J1"}}');

const cfg = (over: Partial<BookingInboundConfig> = {}): BookingInboundConfig => ({
  auth: 'hmac',
  secrets: ['s1', 's2'],
  allowedCidrs: [],
  mapper: 'v1',
  ...over,
});

const hmacInput = (over: { ts?: string; secret?: string; raw?: Buffer; ip?: string; nowMs?: number } = {}) => {
  const ts = over.ts ?? TS;
  const headers: Record<string, string | undefined> = {
    'x-booking-timestamp': ts,
    'x-booking-signature': signBody(over.secret ?? 's1', ts, body),
  };
  return { headers, rawBody: over.raw ?? body, ip: over.ip ?? '203.0.113.9', nowMs: over.nowMs ?? NOW };
};

describe('signBody', () => {
  it('returns sha256=<hex>', () => {
    expect(signBody('s', TS, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe('checkInboundAuth', () => {
  it('a correct signature with the second secret passes', () => {
    expect(checkInboundAuth(hmacInput({ secret: 's2' }), cfg())).toEqual({ ok: true });
  });

  it('header names are matched case-insensitively', () => {
    const input = hmacInput();
    const headers = { 'X-Booking-Timestamp': input.headers['x-booking-timestamp'], 'X-Booking-Signature': input.headers['x-booking-signature'] };
    expect(checkInboundAuth({ ...input, headers }, cfg())).toEqual({ ok: true });
  });

  it('a body changed by one byte fails as signature', () => {
    const tampered = Buffer.from('{"job":{"jobId":"J2"}}');
    expect(checkInboundAuth(hmacInput({ raw: tampered }), cfg())).toEqual({ ok: false, reason: 'signature' });
  });

  it('a missing signature header fails as signature', () => {
    const input = hmacInput();
    delete input.headers['x-booking-signature'];
    expect(checkInboundAuth(input, cfg())).toEqual({ ok: false, reason: 'signature' });
  });

  it('301 s old fails as timestamp; 300 s passes', () => {
    expect(checkInboundAuth(hmacInput({ nowMs: NOW + 301_000 }), cfg())).toEqual({ ok: false, reason: 'timestamp' });
    expect(checkInboundAuth(hmacInput({ nowMs: NOW + 300_000 }), cfg())).toEqual({ ok: true });
    expect(checkInboundAuth(hmacInput({ nowMs: NOW - 300_000 }), cfg())).toEqual({ ok: true });
    expect(checkInboundAuth(hmacInput({ nowMs: NOW - 301_000 }), cfg())).toEqual({ ok: false, reason: 'timestamp' });
  });

  it('a timestamp in milliseconds fails as timestamp', () => {
    expect(checkInboundAuth(hmacInput({ ts: '1795575600000' }), cfg())).toEqual({ ok: false, reason: 'timestamp' });
  });

  it('a missing or non numeric timestamp fails as timestamp', () => {
    const input = hmacInput();
    input.headers['x-booking-timestamp'] = 'abc';
    expect(checkInboundAuth(input, cfg())).toEqual({ ok: false, reason: 'timestamp' });
    delete input.headers['x-booking-timestamp'];
    expect(checkInboundAuth(input, cfg())).toEqual({ ok: false, reason: 'timestamp' });
  });

  it('api-key mode compares X-Api-Key', () => {
    const base = { rawBody: body, ip: '203.0.113.9', nowMs: NOW };
    const c = cfg({ auth: 'api-key' });
    expect(checkInboundAuth({ ...base, headers: { 'x-api-key': 's2' } }, c)).toEqual({ ok: true });
    expect(checkInboundAuth({ ...base, headers: { 'x-api-key': 'nope' } }, c)).toEqual({ ok: false, reason: 'api-key' });
    expect(checkInboundAuth({ ...base, headers: {} }, c)).toEqual({ ok: false, reason: 'api-key' });
  });

  it('an ip outside BOOKING_INBOUND_ALLOWED_CIDRS fails as cidr', () => {
    const c = cfg({ allowedCidrs: ['10.0.0.0/8'] });
    expect(checkInboundAuth(hmacInput({ ip: '192.168.1.5' }), c)).toEqual({ ok: false, reason: 'cidr' });
    expect(checkInboundAuth(hmacInput({ ip: '10.1.2.3' }), c)).toEqual({ ok: true });
  });

  it('an IPv4-mapped IPv6 address is checked as IPv4', () => {
    const c = cfg({ allowedCidrs: ['10.0.0.0/8'] });
    expect(checkInboundAuth(hmacInput({ ip: '::ffff:10.1.2.3' }), c)).toEqual({ ok: true });
    expect(checkInboundAuth(hmacInput({ ip: '::ffff:192.168.1.5' }), c)).toEqual({ ok: false, reason: 'cidr' });
  });

  it('IPv6 cidrs work', () => {
    const c = cfg({ allowedCidrs: ['2001:db8::/32'] });
    expect(checkInboundAuth(hmacInput({ ip: '2001:db8::1' }), c)).toEqual({ ok: true });
    expect(checkInboundAuth(hmacInput({ ip: '2001:db9::1' }), c)).toEqual({ ok: false, reason: 'cidr' });
  });

  it('an unparseable ip fails as cidr when cidrs are set', () => {
    expect(checkInboundAuth(hmacInput({ ip: 'garbage' }), cfg({ allowedCidrs: ['10.0.0.0/8'] }))).toEqual({ ok: false, reason: 'cidr' });
  });

  it('no secrets configured fails as not-configured', () => {
    expect(checkInboundAuth(hmacInput(), cfg({ secrets: [] }))).toEqual({ ok: false, reason: 'not-configured' });
  });
});
