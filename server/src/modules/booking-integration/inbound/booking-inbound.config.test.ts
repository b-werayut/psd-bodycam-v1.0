import { describe, expect, it } from 'vitest';
import { readBookingInboundConfig } from './booking-inbound.config';

describe('readBookingInboundConfig', () => {
  it('defaults to hmac + v1', () => {
    expect(readBookingInboundConfig({})).toEqual({ auth: 'hmac', secrets: [], allowedCidrs: [], mapper: 'v1' });
  });

  it('parses secrets and cidrs with trimming', () => {
    const cfg = readBookingInboundConfig({
      BOOKING_INBOUND_AUTH: 'api-key',
      BOOKING_INBOUND_SECRETS: ' a , b ',
      BOOKING_INBOUND_ALLOWED_CIDRS: '10.0.0.0/8, 2001:db8::/32',
    });
    expect(cfg).toEqual({ auth: 'api-key', secrets: ['a', 'b'], allowedCidrs: ['10.0.0.0/8', '2001:db8::/32'], mapper: 'v1' });
  });

  it('more than 2 secrets throws naming BOOKING_INBOUND_SECRETS', () => {
    expect(() => readBookingInboundConfig({ BOOKING_INBOUND_SECRETS: 'a,b,c' })).toThrow(/BOOKING_INBOUND_SECRETS/);
  });

  it('unknown mapper throws naming BOOKING_INBOUND_MAPPER', () => {
    expect(() => readBookingInboundConfig({ BOOKING_INBOUND_MAPPER: 'smart-booking' })).toThrow(/BOOKING_INBOUND_MAPPER/);
  });

  it('unknown auth throws naming BOOKING_INBOUND_AUTH', () => {
    expect(() => readBookingInboundConfig({ BOOKING_INBOUND_AUTH: 'basic' })).toThrow(/BOOKING_INBOUND_AUTH/);
  });

  it('a malformed cidr throws naming BOOKING_INBOUND_ALLOWED_CIDRS', () => {
    expect(() => readBookingInboundConfig({ BOOKING_INBOUND_ALLOWED_CIDRS: 'nope' })).toThrow(/BOOKING_INBOUND_ALLOWED_CIDRS/);
  });
});
