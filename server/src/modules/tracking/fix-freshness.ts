/**
 * How old a fix may be and still count as "now" (live map dimming, history gap threshold):
 * `status.unknown-after-seconds` + 2 × `gps.poll-interval-seconds` (defaults 120 + 30 = 150 s).
 */
export function fixMaxAgeSeconds(unknownAfterSeconds: number, pollIntervalSeconds: number): number {
  return Math.max(1, unknownAfterSeconds) + 2 * Math.max(0, pollIntervalSeconds);
}

/** A future time is "fresh" here; the ingest drops points more than 2 minutes ahead. */
export function isFreshFix(at: Date, now: Date, maxAgeSeconds: number): boolean {
  return (now.getTime() - at.getTime()) / 1000 <= maxAgeSeconds;
}
