import { Logger } from '@nestjs/common';
import { dssAuthorizationHeader, dssRequest } from './dss-auth';
import type { DssClient, VendorDevice, VendorDeviceReading, VendorInventory, VendorLocation } from './dss-client';
import type { DssConfig } from './dss-config';

export const DSS_SUCCESS_CODE = 1000;
export const DSS_DEVICE_OFFLINE_CODE = 5000;

type DssLocationData = {
  deviceCode?: string | null;
  gpsX?: number | string | null;
  gpsY?: number | string | null;
  status?: string | number | null;
  updateTime?: number | string | null;
};

type DssLocationBody = { code?: number; desc?: string; data?: DssLocationData | null };

type DssDeviceRow = {
  deviceCode?: string | number | null;
  deviceName?: string | null;
  deviceType?: string | number | null;
  deviceTypeName?: string | null;
  deviceModel?: string | null;
  serialNo?: string | null;
  status?: number | string | null;
};

type DssDeviceListBody = {
  code?: number;
  desc?: string;
  data?: DssDeviceRow[] | { totalCount?: string | number | null; pageData?: DssDeviceRow[] | null } | null;
};

/** psd-bwc-dss-services over HTTP: `POST /api/v1/location`, `GET /api/v1/devices`. No retry. */
export class DssHttpClient implements DssClient {
  private readonly logger = new Logger(DssHttpClient.name);

  constructor(private readonly config: DssConfig) {}

  async fetchReading(vendorDeviceId: string): Promise<VendorDeviceReading> {
    const body = await this.request('/api/v1/location', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: vendorDeviceId }),
    });
    const payload = parseJson(body) as DssLocationBody | undefined;
    const reading = parseDssReading(payload, vendorDeviceId);
    if (reading.online === null && payload?.code !== DSS_SUCCESS_CODE) {
      this.logger.debug(
        `DSS replied code=${String(isObject(payload) ? payload.code : 'n/a')} for ${vendorDeviceId} - treating status as unknown`,
      );
    }
    return reading;
  }

  async listDevices(): Promise<VendorInventory> {
    const body = await this.request('/api/v1/devices', { method: 'GET' });
    const payload = parseJson(body);
    if (payload === undefined) throw new Error('DSS returned a device list that is not JSON');
    const typed = payload as DssDeviceListBody;
    if (!isObject(typed) || typed.code !== DSS_SUCCESS_CODE) {
      const code = isObject(typed) ? String(typed.code) : 'n/a';
      const desc = isObject(typed) && typed.desc ? `: ${typed.desc}` : '';
      throw new Error(`DSS rejected the device list request (code=${code}${desc})`);
    }
    const parsed = parseDssDeviceList(typed);
    if (!parsed.complete) {
      this.logger.warn(
        `DSS reports more devices than it returned (returned ${parsed.devices.length}) - the list is incomplete, so cameras missing from it will not be marked as missing`,
      );
    }
    return { ...parsed, fetchedAt: new Date() };
  }

  private async request(path: string, init: RequestInit): Promise<string> {
    const url = `${this.config.baseUrl}${path}`;
    const res = await dssRequest(
      url,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: await dssAuthorizationHeader(this.config.apiKey ?? ''),
        },
      },
      this.config.timeoutMs,
    );
    if (!res.ok) throw new Error(`DSS replied ${res.status}: ${res.text.slice(0, 200)}`);
    return res.text;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function locationData(payload: unknown): DssLocationData | null {
  if (!isObject(payload) || payload.code !== DSS_SUCCESS_CODE) return null;
  return isObject(payload.data) ? (payload.data as DssLocationData) : null;
}

export function parseDssReading(payload: DssLocationBody | undefined, vendorDeviceId: string): VendorDeviceReading {
  return { vendorDeviceId, online: parseDssOnline(payload), location: parseDssLocation(payload) };
}

/** 1000 ⇒ `data.status` ("1" online) · 5000 ⇒ offline · anything else ⇒ null (never guessed). */
export function parseDssOnline(payload: DssLocationBody | undefined): boolean | null {
  if (!isObject(payload)) return null;
  if (payload.code === DSS_DEVICE_OFFLINE_CODE) return false;
  const data = locationData(payload);
  return data ? parseDssStatus(data.status) : null;
}

/** gpsX = longitude, gpsY = latitude. (0,0) = no satellite fix yet ⇒ null. DSS sends no speed. */
export function parseDssLocation(payload: DssLocationBody | undefined): VendorLocation | null {
  const data = locationData(payload);
  if (!data) return null;
  const lat = toFiniteNumber(data.gpsY);
  const lng = toFiniteNumber(data.gpsX);
  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, recordedAt: parseDssUpdateTime(data.updateTime), speedKph: null };
}

/** Unix seconds (what DSS sends); values above 1e12 are taken as milliseconds. */
export function parseDssUpdateTime(raw: number | string | null | undefined): Date | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  const date = new Date(value > 1e12 ? value : value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDssStatus(raw: string | number | null | undefined): boolean | null {
  const value = toFiniteNumber(raw);
  return value === null ? null : value === 1;
}

export function parseDssDeviceList(payload: DssDeviceListBody | undefined): Omit<VendorInventory, 'fetchedAt'> {
  const data = payload?.data;
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.pageData) ? data.pageData : [];
  const totalRaw = isObject(data) ? (data as { totalCount?: unknown }).totalCount : null;
  const total = totalRaw === null || totalRaw === undefined || String(totalRaw).trim() === '' ? null : Number(totalRaw);
  const totalCount = total !== null && Number.isFinite(total) && total >= 0 ? total : null;

  const devices: VendorDevice[] = [];
  for (const row of rows) {
    const code = isObject(row) ? row.deviceCode : null;
    if (code === undefined || code === null || String(code).trim() === '') continue;
    devices.push({
      vendorDeviceId: String(code).trim(),
      deviceName: emptyToNull(row.deviceName),
      vendorType: vendorTypeOf(row),
      model: emptyToNull(row.deviceModel),
      serialNo: emptyToNull(row.serialNo),
      online: parseDssStatus(row.status),
    });
  }
  return { devices, complete: totalCount === null || totalCount <= rows.length };
}

/** `deviceTypeName` first; a bare numeric `deviceType` says nothing about the kind. */
function vendorTypeOf(row: DssDeviceRow): string | null {
  const byName = emptyToNull(row.deviceTypeName);
  if (byName !== null) return byName;
  const value = row.deviceType === null || row.deviceType === undefined ? '' : String(row.deviceType).trim();
  return value === '' || /^\d+$/.test(value) ? null : value;
}

function emptyToNull(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  return value === '' ? null : value;
}

function toFiniteNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
