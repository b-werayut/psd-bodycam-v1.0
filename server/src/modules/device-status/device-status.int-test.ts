import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, resetDevices, type HttpContext } from '../../test/int-helpers';
import { DeviceStatusService } from './device-status.service';

let ctx: HttpContext;
let a: bigint;
let b: bigint;

const service = () => new DeviceStatusService(ctx.app.get<DrizzleDB>(DRIZZLE));
const stateOf = async (id: bigint) => (await ctx.sql`select * from "DeviceState" where "DeviceId" = ${id}`)[0];
const historyOf = (id: bigint) =>
  ctx.sql`select * from "DeviceStatusHistory" where "DeviceId" = ${id} order by "Id"`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const addDevice = async (code: string, withState = true) => {
  const [row] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Kind") values (${code}, ${code}, 1) returning "Id"`;
  if (withState) await ctx.sql`insert into "DeviceState" ("DeviceId") values (${row.Id})`;
  return row.Id as bigint;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
  a = await addDevice('T4-A');
  b = await addDevice('T4-B');
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await ctx.close();
});

describe('DeviceStatusService.applyObservations', () => {
  it('first observation sets state, StateSince and one history row (source 2 DssLocation)', async () => {
    const result = await service().applyObservations([{ deviceId: a, state: 2 }]);
    expect(result.changed).toEqual([{ deviceId: a, from: null, to: 2 }]);

    const state = await stateOf(a);
    expect(state).toMatchObject({ PlatformState: 2, StateSource: 2, LastSource: 2, LastOnlineObservedAt: null });
    expect(state.StateSince).toBeInstanceOf(Date);
    expect(state.LastObservedAt).toEqual(state.StateSince);
    const history = await historyOf(a);
    expect(history.map((h) => [h.FromState, h.ToState, h.Source])).toEqual([[null, 2, 2]]);
  });

  it('offline → online: new StateSince, LastOnlineObservedAt, a second history row', async () => {
    const s = service();
    await s.applyObservations([{ deviceId: a, state: 2 }]);
    const before = await stateOf(a);
    await pause(5);
    const result = await s.applyObservations([{ deviceId: a, state: 1 }]);
    expect(result.changed).toEqual([{ deviceId: a, from: 2, to: 1 }]);

    const after = await stateOf(a);
    expect(after.PlatformState).toBe(1);
    expect(after.StateSince.getTime()).toBeGreaterThan(before.StateSince.getTime());
    expect(after.LastOnlineObservedAt).toEqual(after.LastObservedAt);
    expect((await historyOf(a)).map((h) => [h.FromState, h.ToState])).toEqual([
      [null, 2],
      [2, 1],
    ]);
  });

  it('the same state 3 times: StateSince and history stay, LastObservedAt moves on', async () => {
    const s = service();
    await s.applyObservations([{ deviceId: a, state: 1 }]);
    const first = await stateOf(a);
    for (let i = 0; i < 3; i++) {
      await pause(5);
      expect((await s.applyObservations([{ deviceId: a, state: 1 }])).changed).toEqual([]);
    }
    const last = await stateOf(a);
    expect(last.StateSince).toEqual(first.StateSince);
    expect(last.LastObservedAt.getTime()).toBeGreaterThan(first.LastObservedAt.getTime());
    expect(await historyOf(a)).toHaveLength(1);
  });

  it('a worker restart (new service instance) keeps StateSince of an unchanged state', async () => {
    await service().applyObservations([{ deviceId: a, state: 1 }]);
    const before = await stateOf(a);
    await pause(5);
    await service().applyObservations([{ deviceId: a, state: 1 }]);
    const after = await stateOf(a);
    expect(after.StateSince).toEqual(before.StateSince);
    expect(after.PlatformState).toBe(1);
    expect(await historyOf(a)).toHaveLength(1);
  });

  it('nothing observed leaves the row alone (no null written)', async () => {
    const s = service();
    await s.applyObservations([{ deviceId: a, state: 1 }]);
    const before = await stateOf(a);
    await s.applyObservations([]);
    expect(await stateOf(a)).toEqual(before);
  });

  it('two batches in opposite order at once do not deadlock', async () => {
    const s = service();
    const results = await Promise.all([
      s.applyObservations([
        { deviceId: b, state: 1 },
        { deviceId: a, state: 1 },
      ]),
      s.applyObservations([
        { deviceId: a, state: 2 },
        { deviceId: b, state: 2 },
      ]),
    ]);
    expect(results).toHaveLength(2);
    expect([1, 2]).toContain((await stateOf(a)).PlatformState);
  });

  it('a device without a DeviceState row is skipped, not an error', async () => {
    const lonely = await addDevice('T4-C', false);
    await expect(service().applyObservations([{ deviceId: lonely, state: 1 }])).resolves.toEqual({ changed: [] });
  });
});
