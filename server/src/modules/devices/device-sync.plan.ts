import type { VendorDevice } from '../../common/dss/dss-client';

// Pure planning of one DeviceSync run (port of the reference device-sync.plan.ts, bodycam-only:
// no DeviceType, no dashcam, no conflict report — vendor values only fill empty local fields).

const MAX_DEVICE_CODE = 30;
const MAX_NAME = 200;
const MAX_SERIAL_NO = 100;
const MAX_MODEL = 100;

export type LocalDeviceRow = {
  id: bigint;
  deviceCode: string;
  vendorDeviceId: string;
  name: string | null;
  serialNo: string | null;
  model: string | null;
  isDeleted: boolean;
  vendorMissingSince: Date | null;
};

export type SyncSkipReason = 'duplicateInVendorList' | 'unsupportedType' | 'tooLong' | 'localDeleted' | 'deviceCodeTaken';

export type SyncCreate = {
  vendorDeviceId: string;
  deviceCode: string;
  name: string;
  serialNo: string | null;
  model: string | null;
};

export type SyncPlan = {
  creates: SyncCreate[];
  updates: { id: bigint; patch: { Name?: string; SerialNo?: string; Model?: string } }[];
  skips: { vendorDeviceId: string; reason: SyncSkipReason; message: string }[];
  /** live local devices the vendor list does not have (never deleted) */
  missingAtVendor: { id: bigint; deviceCode: string }[];
  /** live local devices the vendor list has */
  seenIds: bigint[];
  unchanged: number;
};

/** Bodycam by type name, model or device name (`\s*(?:-\s*)?` = `\s*-?\s*` without backtracking). */
export function isBodycam(vendorType: string | null, model: string | null, name: string | null): boolean {
  const text = (raw: string | null) => (raw ?? '').toLowerCase().trim();
  const byText = (raw: string | null) => /body\s*(?:-\s*)?cam|\bmpt\b/.test(text(raw));
  return byText(vendorType) || /(^|[^a-z])mpt(?![a-z])/.test(text(model)) || byText(name);
}

export function planDeviceSync(vendor: readonly VendorDevice[], local: readonly LocalDeviceRow[]): SyncPlan {
  const plan: SyncPlan = { creates: [], updates: [], skips: [], missingAtVendor: [], seenIds: [], unchanged: 0 };

  const byVendorId = new Map(local.map((row) => [row.vendorDeviceId, row]));
  const takenCodes = new Map(local.filter((row) => !row.isDeleted).map((row) => [row.deviceCode, row.vendorDeviceId]));
  const seen = new Set<string>();

  for (const device of vendor) {
    const vendorDeviceId = device.vendorDeviceId.trim();
    if (!vendorDeviceId) continue;
    if (seen.has(vendorDeviceId)) {
      plan.skips.push({
        vendorDeviceId,
        reason: 'duplicateInVendorList',
        message: `DSS sent code '${vendorDeviceId}' twice in the same list - using the first`,
      });
      continue;
    }
    seen.add(vendorDeviceId);

    const existing = byVendorId.get(vendorDeviceId);
    if (existing) {
      if (existing.isDeleted) {
        plan.skips.push({
          vendorDeviceId,
          reason: 'localDeleted',
          message: `Camera '${existing.deviceCode}' holding this code was deleted - VendorDeviceId must be unique, so it is not recreated`,
        });
        continue;
      }
      plan.seenIds.push(existing.id);
      fillEmpty(plan, device, existing);
      continue;
    }

    const model = clip(device.model ?? device.vendorType, MAX_MODEL);
    if (!isBodycam(device.vendorType, device.model, device.deviceName)) {
      plan.skips.push({
        vendorDeviceId,
        reason: 'unsupportedType',
        message: `Type '${device.vendorType ?? device.model ?? '-'}' is not a bodycam - this system accepts bodycams only`,
      });
      continue;
    }
    if (vendorDeviceId.length > MAX_DEVICE_CODE) {
      plan.skips.push({
        vendorDeviceId,
        reason: 'tooLong',
        message: `DSS code is ${vendorDeviceId.length} chars long, exceeds DeviceCode (${MAX_DEVICE_CODE})`,
      });
      continue;
    }
    const owner = takenCodes.get(vendorDeviceId);
    if (owner !== undefined) {
      plan.skips.push({
        vendorDeviceId,
        reason: 'deviceCodeTaken',
        message: `Camera code '${vendorDeviceId}' is already used by the camera bound to DSS code '${owner}'`,
      });
      continue;
    }

    plan.creates.push({
      vendorDeviceId,
      deviceCode: vendorDeviceId,
      name: clip(device.deviceName, MAX_NAME) ?? vendorDeviceId,
      serialNo: clip(device.serialNo, MAX_SERIAL_NO),
      model,
    });
    takenCodes.set(vendorDeviceId, vendorDeviceId);
  }

  for (const row of local) {
    if (!row.isDeleted && !seen.has(row.vendorDeviceId)) {
      plan.missingAtVendor.push({ id: row.id, deviceCode: row.deviceCode });
    }
  }
  return plan;
}

function fillEmpty(plan: SyncPlan, device: VendorDevice, local: LocalDeviceRow): void {
  const patch: SyncPlan['updates'][number]['patch'] = {};
  const name = clip(device.deviceName, MAX_NAME);
  const serialNo = clip(device.serialNo, MAX_SERIAL_NO);
  const model = clip(device.model ?? device.vendorType, MAX_MODEL);
  if (name && !local.name?.trim()) patch.Name = name;
  if (serialNo && !local.serialNo?.trim()) patch.SerialNo = serialNo;
  if (model && !local.model?.trim()) patch.Model = model;
  if (Object.keys(patch).length === 0) plan.unchanged++;
  else plan.updates.push({ id: local.id, patch });
}

function clip(raw: string | null | undefined, maxLength: number): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
