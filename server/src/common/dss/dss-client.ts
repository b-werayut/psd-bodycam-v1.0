/** Injection token of the one DSS client (driver `dss` | `mock`). */
export const DSS_CLIENT = Symbol('DSS_CLIENT');

export type VendorLocation = {
  lat: number;
  lng: number;
  /** device time; null = DSS sent none (the caller uses now) */
  recordedAt: Date | null;
  speedKph: number | null;
};

/** One `/location` answer: GPS + online/offline in one call (DL32). null = unknown, never guessed. */
export type VendorDeviceReading = {
  vendorDeviceId: string;
  online: boolean | null;
  location: VendorLocation | null;
};

export type VendorDevice = {
  vendorDeviceId: string;
  deviceName: string | null;
  vendorType: string | null;
  model: string | null;
  serialNo: string | null;
  online: boolean | null;
};

/** `complete` = false when DSS says there are more devices than it sent (paged response). */
export type VendorInventory = { devices: VendorDevice[]; complete: boolean; fetchedAt: Date };

export interface DssClient {
  /** Throws when DSS cannot be reached or answers non-2xx; resolves for offline / unknown. */
  fetchReading(vendorDeviceId: string): Promise<VendorDeviceReading>;
  /** Throws on any failure: an empty list must never mean "every camera is gone". */
  listDevices(): Promise<VendorInventory>;
}
