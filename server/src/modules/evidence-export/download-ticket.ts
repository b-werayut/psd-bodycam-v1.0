import { openUrl, sealUrl } from '../streaming/url-seal';

export const DOWNLOAD_TICKET_TTL_MS = 60_000;

type TicketPayload = { e: string; u: string; x: number };

/**
 * Download ticket = AES-GCM seal of {export, requester, expiry}. Stateless, so several people can ask
 * for the same file at once; the GCM tag stops forged or edited export ids. Key: streamUrlKey().
 */
export function sealDownloadTicket(
  payload: { exportId: bigint; userId: bigint },
  key: Buffer,
  now: Date = new Date(),
): string {
  const body: TicketPayload = {
    e: payload.exportId.toString(),
    u: payload.userId.toString(),
    x: now.getTime() + DOWNLOAD_TICKET_TTL_MS,
  };
  return sealUrl(JSON.stringify(body), key);
}

export function openDownloadTicket(
  ticket: string,
  key: Buffer,
  now: Date = new Date(),
): { exportId: bigint; userId: bigint } | null {
  let body: TicketPayload;
  try {
    body = JSON.parse(openUrl(ticket, key)) as TicketPayload;
  } catch {
    return null;
  }
  if (typeof body?.x !== 'number' || body.x < now.getTime()) return null;
  if (!/^\d+$/.test(body.e ?? '') || !/^\d+$/.test(body.u ?? '')) return null;
  return { exportId: BigInt(body.e), userId: BigInt(body.u) };
}
