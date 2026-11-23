import { describe, expect, it } from 'vitest';
import type { VendorDevice } from '../../common/dss/dss-client';
import { isBodycam, planDeviceSync, type LocalDeviceRow } from './device-sync.plan';

const vendor = (id: string, extra: Partial<VendorDevice> = {}): VendorDevice => ({
  vendorDeviceId: id,
  deviceName: null,
  vendorType: 'MPT',
  model: null,
  serialNo: null,
  online: true,
  ...extra,
});

const local = (id: number, vendorDeviceId: string, extra: Partial<LocalDeviceRow> = {}): LocalDeviceRow => ({
  id: BigInt(id),
  deviceCode: vendorDeviceId,
  vendorDeviceId,
  name: vendorDeviceId,
  serialNo: null,
  model: null,
  isDeleted: false,
  vendorMissingSince: null,
  ...extra,
});

describe('isBodycam', () => {
  it('matches bodycam by type, model or name', () => {
    expect(isBodycam('MPT', null, null)).toBe(true);
    expect(isBodycam('Body Cam', null, null)).toBe(true);
    expect(isBodycam('body-cam', null, null)).toBe(true);
    expect(isBodycam(null, 'DH-MPT230', null)).toBe(true);
    expect(isBodycam(null, null, 'BodyCam 01')).toBe(true);
  });

  it('rejects dashcams, other kinds and no information at all', () => {
    expect(isBodycam('MDVR', null, null)).toBe(false);
    expect(isBodycam('Dash Cam', null, null)).toBe(false);
    expect(isBodycam('IPC', 'DH-IPC-HFW', 'gate')).toBe(false);
    expect(isBodycam(null, null, null)).toBe(false);
    expect(isBodycam(null, 'MPTX', null)).toBe(false);
  });
});

describe('planDeviceSync', () => {
  it('creates a new bodycam with DeviceCode = vendor id; name falls back to the code, model to the type', () => {
    const plan = planDeviceSync([vendor('1000067', { serialNo: ' SN1 ' })], []);
    expect(plan.creates).toEqual([
      { vendorDeviceId: '1000067', deviceCode: '1000067', name: '1000067', serialNo: 'SN1', model: 'MPT' },
    ]);
    expect(plan.skips).toEqual([]);
  });

  it('skips a camera that is not a bodycam', () => {
    const plan = planDeviceSync([vendor('D1', { vendorType: 'MDVR' }), vendor('X1', { vendorType: null })], []);
    expect(plan.creates).toEqual([]);
    expect(plan.skips.map((s) => [s.vendorDeviceId, s.reason])).toEqual([
      ['D1', 'unsupportedType'],
      ['X1', 'unsupportedType'],
    ]);
  });

  it('uses the first of a duplicated vendor id', () => {
    const plan = planDeviceSync([vendor('A1', { deviceName: 'first' }), vendor('A1', { deviceName: 'second' })], []);
    expect(plan.creates.map((c) => c.name)).toEqual(['first']);
    expect(plan.skips.map((s) => s.reason)).toEqual(['duplicateInVendorList']);
  });

  it('skips a vendor id longer than DeviceCode (30)', () => {
    const plan = planDeviceSync([vendor('X'.repeat(31))], []);
    expect(plan.skips.map((s) => s.reason)).toEqual(['tooLong']);
  });

  it('never re-creates a soft-deleted device (VendorDeviceId is unique forever)', () => {
    const plan = planDeviceSync([vendor('A1')], [local(1, 'A1', { isDeleted: true })]);
    expect(plan.creates).toEqual([]);
    expect(plan.skips.map((s) => s.reason)).toEqual(['localDeleted']);
    expect(plan.missingAtVendor).toEqual([]);
  });

  it('skips when the code is already used by a live device with another vendor id', () => {
    const plan = planDeviceSync([vendor('A1')], [local(1, 'OTHER', { deviceCode: 'A1' })]);
    expect(plan.skips.map((s) => s.reason)).toEqual(['deviceCodeTaken']);
  });

  it('fills only empty local fields and never overwrites', () => {
    const plan = planDeviceSync(
      [vendor('A1', { deviceName: 'vendor name', serialNo: 'SN9', model: 'DH-MPT230' }), vendor('B1', { deviceName: 'x' })],
      [local(1, 'A1', { name: 'local name', serialNo: null, model: null }), local(2, 'B1', { name: 'kept', model: 'MPT' })],
    );
    expect(plan.updates).toEqual([{ id: 1n, patch: { SerialNo: 'SN9', Model: 'DH-MPT230' } }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.seenIds).toEqual([1n, 2n]);
  });

  it('a live local device missing from the vendor list is reported, not deleted', () => {
    const plan = planDeviceSync(
      [vendor('A1')],
      [local(1, 'A1'), local(2, 'GONE'), local(3, 'OLD', { isDeleted: true })],
    );
    expect(plan.missingAtVendor).toEqual([{ id: 2n, deviceCode: 'GONE' }]);
    expect(plan.seenIds).toEqual([1n]);
  });
});
