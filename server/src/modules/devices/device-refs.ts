import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { DrizzleExecutor } from '../../db/db.types';
import { Devices } from '../../db/schema';

export type ResolvedDevice = { id: bigint; deviceCode: string; name: string | null; vendorDeviceId: string };

const norm = (value: string) => value.trim().toLowerCase();

/**
 * Booking's camera refs → our cameras (design §4.5). A ref matches `DeviceCode`, then `VendorDeviceId`,
 * then `SerialNo` of a camera that is not deleted, ignoring case and surrounding spaces. Key = the ref
 * exactly as passed; refs that match nothing are absent from the map.
 */
export async function resolveDeviceRefs(db: DrizzleExecutor, refs: string[]): Promise<Map<string, ResolvedDevice>> {
  const out = new Map<string, ResolvedDevice>();
  const wanted = [...new Set(refs.map(norm).filter((r) => r !== ''))];
  if (!wanted.length) return out;

  const rows = await db
    .select({
      id: Devices.Id,
      deviceCode: Devices.DeviceCode,
      name: Devices.Name,
      vendorDeviceId: Devices.VendorDeviceId,
      serialNo: Devices.SerialNo,
    })
    .from(Devices)
    .where(
      and(
        eq(Devices.IsDeleted, false),
        or(
          inArray(sql`lower(${Devices.DeviceCode})`, wanted),
          inArray(sql`lower(${Devices.VendorDeviceId})`, wanted),
          inArray(sql`lower(${Devices.SerialNo})`, wanted),
        ),
      ),
    )
    .orderBy(Devices.Id);

  const byCode = new Map<string, ResolvedDevice>();
  const byVendorId = new Map<string, ResolvedDevice>();
  const bySerial = new Map<string, ResolvedDevice>();
  for (const { serialNo, ...device } of rows) {
    const put = (index: Map<string, ResolvedDevice>, key: string | null) => {
      if (key !== null && !index.has(norm(key))) index.set(norm(key), device);
    };
    put(byCode, device.deviceCode);
    put(byVendorId, device.vendorDeviceId);
    put(bySerial, serialNo);
  }

  for (const ref of refs) {
    const key = norm(ref);
    const device = byCode.get(key) ?? byVendorId.get(key) ?? bySerial.get(key);
    if (device) out.set(ref, device);
  }
  return out;
}
