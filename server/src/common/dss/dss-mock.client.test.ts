import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../geo/haversine';
import { DssMockClient, mockDeviceId } from './dss-mock.client';

describe('DssMockClient (simulator, DSS_DRIVER=mock)', () => {
  it('lists SIM-0001 … SIM-N as complete bodycams', async () => {
    const inventory = await new DssMockClient(100).listDevices();
    expect(inventory.complete).toBe(true);
    expect(inventory.devices).toHaveLength(100);
    expect(inventory.devices[0]).toMatchObject({
      vendorDeviceId: 'SIM-0001',
      vendorType: 'MPT',
      model: 'DH-MPT230',
    });
    expect(inventory.devices[99].vendorDeviceId).toBe('SIM-0100');
    expect(mockDeviceId(7)).toBe('SIM-0007');
  });

  it('every 10th camera is offline with no location, in the list and in /location', async () => {
    const client = new DssMockClient(100);
    const inventory = await client.listDevices();
    expect(inventory.devices.find((d) => d.vendorDeviceId === 'SIM-0010')?.online).toBe(false);
    expect(await client.fetchReading('SIM-0010')).toEqual({ vendorDeviceId: 'SIM-0010', online: false, location: null });
  });

  it('every 7th camera (not 10th) is online indoors: no location', async () => {
    const reading = await new DssMockClient(100).fetchReading('SIM-0007');
    expect(reading.online).toBe(true);
    expect(reading.location).toBeNull();
  });

  it('other cameras move on a ~110 m circle near Bangkok over time', async () => {
    let now = Date.parse('2026-11-23T03:00:00Z');
    const client = new DssMockClient(100, () => now);
    const first = await client.fetchReading('SIM-0001');
    now += 60_000;
    const second = await client.fetchReading('SIM-0001');

    expect(first.online).toBe(true);
    expect(first.location?.recordedAt?.getTime()).toBe(Date.parse('2026-11-23T03:00:00Z'));
    const a = first.location!;
    const b = second.location!;
    expect(haversineMeters(a, b)).toBeGreaterThan(10);
    expect(haversineMeters(a, b)).toBeLessThan(250);
    expect(Math.abs(a.lat - 13.7563)).toBeLessThan(0.06);
    expect(Math.abs(a.lng - 100.5018)).toBeLessThan(0.06);
  });

  it('a camera outside the simulated list is unknown (null), never a guess', async () => {
    expect(await new DssMockClient(3).fetchReading('SIM-0099')).toEqual({
      vendorDeviceId: 'SIM-0099',
      online: null,
      location: null,
    });
  });
});

describe('DssMockClient spread', () => {
  it('cameras spread across the city, not along one line', async () => {
    const client = new DssMockClient(100, () => Date.parse('2026-11-23T03:00:00Z'));
    const lats: number[] = [];
    const lngs: number[] = [];
    for (const id of ['SIM-0001', 'SIM-0002', 'SIM-0003', 'SIM-0004', 'SIM-0005', 'SIM-0006', 'SIM-0008', 'SIM-0009']) {
      const location = (await client.fetchReading(id)).location!;
      lats.push(location.lat);
      lngs.push(location.lng);
    }
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0.02);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(0.02);
  });
});
