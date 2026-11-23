import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { DeviceState, DeviceStatusHistory } from '../../db/schema';
import { decideObservation, PLATFORM_STATE, STATE_SOURCE, type PlatformState } from './observation';

export type Observation = { deviceId: bigint; state: PlatformState };

export type StateChange = { deviceId: bigint; from: PlatformState | null; to: PlatformState };

/**
 * Writes observations to the `DeviceState` hot row (UPDATE only — DeviceSync creates the row).
 * Times come from the DB `now()`. `StateSince` and a `DeviceStatusHistory` row only on a change, so a
 * worker restart or a DSS gap never resets them; nothing observed = the row is not touched (DL11).
 * One short transaction per camera, in `DeviceId` order (global lock order).
 */
@Injectable()
export class DeviceStatusService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async applyObservations(
    items: readonly Observation[],
    source: number = STATE_SOURCE.DSS_LOCATION,
  ): Promise<{ changed: StateChange[] }> {
    const latest = new Map<bigint, Observation>();
    for (const item of items) latest.set(item.deviceId, item);
    const ordered = [...latest.values()].sort((x, y) => (x.deviceId < y.deviceId ? -1 : x.deviceId > y.deviceId ? 1 : 0));

    const changed: StateChange[] = [];
    for (const item of ordered) {
      const change = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ platformState: DeviceState.PlatformState })
          .from(DeviceState)
          .where(eq(DeviceState.DeviceId, item.deviceId))
          .for('update');
        if (!row) return null;

        const decision = decideObservation({ platformState: row.platformState as PlatformState | null }, item.state);
        await tx
          .update(DeviceState)
          .set({
            LastObservedAt: sql`now()`,
            LastSource: source,
            StateSourceObservedAt: sql`now()`,
            ...(item.state === PLATFORM_STATE.ONLINE ? { LastOnlineObservedAt: sql`now()` } : {}),
            ...(decision.changed ? { PlatformState: item.state, StateSince: sql`now()`, StateSource: source } : {}),
            UpdatedAt: sql`now()`,
          })
          .where(eq(DeviceState.DeviceId, item.deviceId));
        if (!decision.changed) return null;

        await tx.insert(DeviceStatusHistory).values({
          DeviceId: item.deviceId,
          FromState: decision.from,
          ToState: decision.to,
          ObservedAt: sql`now()`,
          Source: source,
        });
        return { deviceId: item.deviceId, from: decision.from, to: decision.to };
      });
      if (change) changed.push(change);
    }
    return { changed };
  }
}
