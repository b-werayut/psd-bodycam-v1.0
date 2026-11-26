import { Logger } from '@nestjs/common';
import type { DssClient, VendorDevice, VendorDeviceReading, VendorInventory } from './dss-client';

const BASE_LAT = 13.7563;
const BASE_LNG = 100.5018;
/** ≈ 110 m */
const RADIUS_DEG = 0.001;
const CYCLE_MS = 10 * 60_000;

export const mockDeviceId = (index: number) => `SIM-${String(index).padStart(4, '0')}`;

const indexOf = (vendorDeviceId: string): number | null => {
  const match = /^SIM-(\d{4,})$/.exec(vendorDeviceId);
  return match ? Number(match[1]) : null;
};

/**
 * The simulator (DL56, `DSS_DRIVER=mock`): N bodycams `SIM-0001`…, each circling its own point near
 * Bangkok. Every 10th camera is offline; every other 7th is online indoors (no GPS fix).
 */
export class DssMockClient implements DssClient {
  private readonly logger = new Logger(DssMockClient.name);
  private warned = false;

  constructor(
    private readonly count: number,
    private readonly now: () => number = Date.now,
  ) {}

  listDevices(): Promise<VendorInventory> {
    this.warnOnce();
    const devices: VendorDevice[] = [];
    for (let i = 1; i <= this.count; i++) {
      devices.push({
        vendorDeviceId: mockDeviceId(i),
        deviceName: `กล้องจำลอง ${i}`,
        vendorType: 'MPT',
        model: 'DH-MPT230',
        serialNo: `SIMSN${String(i).padStart(6, '0')}`,
        online: i % 10 !== 0,
      });
    }
    return Promise.resolve({ devices, complete: true, fetchedAt: new Date(this.now()) });
  }

  fetchReading(vendorDeviceId: string): Promise<VendorDeviceReading> {
    this.warnOnce();
    const index = indexOf(vendorDeviceId);
    if (index === null || index < 1 || index > this.count) {
      return Promise.resolve({ vendorDeviceId, online: null, location: null });
    }
    if (index % 10 === 0) return Promise.resolve({ vendorDeviceId, online: false, location: null });
    if (index % 7 === 0) return Promise.resolve({ vendorDeviceId, online: true, location: null });

    const now = this.now();
    const offset = hashToUnit(vendorDeviceId);
    const angle = 2 * Math.PI * ((now % CYCLE_MS) / CYCLE_MS + offset);
    return Promise.resolve({
      vendorDeviceId,
      online: true,
      location: {
        lat: BASE_LAT + (offset - 0.5) * 0.08 + RADIUS_DEG * Math.sin(angle),
        lng: BASE_LNG + (hashToUnit(`${vendorDeviceId}:lng`) - 0.5) * 0.08 + RADIUS_DEG * Math.cos(angle),
        recordedAt: new Date(now),
        speedKph: 4,
      },
    });
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(`Using ${this.count} simulated cameras (DSS_DRIVER=mock) - status and coordinates are not real`);
  }
}

/**
 * FNV-1a + the murmur3 finaliser: ids that differ in the last character (SIM-0001, SIM-0002, …) land far
 * apart, so the simulated cameras cover the city instead of a line.
 */
function hashToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}
