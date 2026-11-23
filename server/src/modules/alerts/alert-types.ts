// Alert types (Part 5 §5.6). Numbers are append-only; P1 writes only 13.
export const ALERT_TYPE = {
  DEVICE_VENDOR_MISSING: 13,
} as const;

export type AlertType = (typeof ALERT_TYPE)[keyof typeof ALERT_TYPE];

export const ALERT_SEVERITY = { INFO: 1, WARNING: 2, CRITICAL: 3 } as const;

export const ALERT_STATUS = { NEW: 1, ACKNOWLEDGED: 2, RESOLVED: 3, DISMISSED: 4 } as const;

/** One open alert per camera for "gone from the DSS device list". */
export const vendorMissingDedupeKey = (deviceId: bigint | string) => `13:device:${deviceId}`;
