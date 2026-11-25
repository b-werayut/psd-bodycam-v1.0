import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, resetDevices, type HttpContext } from '../../test/int-helpers';
import { resolveDeviceRefs } from './device-refs';

let ctx: HttpContext;
let db: DrizzleDB;

const insertDevice = async (code: string, vendorId: string, serialNo: string | null, deleted = false) => {
  const [row] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "SerialNo", "Name", "Kind", "IsDeleted", "DeletedAt")
    values (${code}, ${vendorId}, ${serialNo}, ${'cam ' + code}, 1, ${deleted}, ${deleted ? new Date() : null})
    returning "Id"`;
  return row.Id as bigint;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await ctx.close();
});

describe('resolveDeviceRefs', () => {
  it('matches code, vendor id or serial, ignoring case and spaces; deleted cameras never match', async () => {
    const cam = await insertDevice('BWC-0009', '1000027', 'SN-ABC');
    const other = await insertDevice('BWC-0010', '1000028', null);
    await insertDevice('BWC-DEL', 'V-DEL', 'SN-DEL', true);

    const refs = [' 1000027 ', 'bwc-0009', 'sn-abc', 'Bwc-0010', 'BWC-DEL', 'v-del', 'SN-DEL', 'nope'];
    const found = await resolveDeviceRefs(db, refs);

    expect([...found.keys()].sort()).toEqual([' 1000027 ', 'Bwc-0010', 'bwc-0009', 'sn-abc'].sort());
    expect(found.get(' 1000027 ')).toEqual({ id: cam, deviceCode: 'BWC-0009', name: 'cam BWC-0009', vendorDeviceId: '1000027' });
    expect(found.get('bwc-0009')?.id).toBe(cam);
    expect(found.get('sn-abc')?.id).toBe(cam);
    expect(found.get('Bwc-0010')).toEqual({ id: other, deviceCode: 'BWC-0010', name: 'cam BWC-0010', vendorDeviceId: '1000028' });
  });

  it('no refs (or only blanks) ⇒ empty map', async () => {
    await insertDevice('BWC-0011', '1000029', null);
    expect((await resolveDeviceRefs(db, [])).size).toBe(0);
    expect((await resolveDeviceRefs(db, ['  ', ''])).size).toBe(0);
  });
});
