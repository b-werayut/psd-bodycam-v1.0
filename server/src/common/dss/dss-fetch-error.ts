/**
 * undici โยน `TypeError: fetch failed` เหมือนกันหมดไม่ว่าจะพังเพราะ DNS, พอร์ตปิด,
 * firewall บล็อก หรือ cert ไม่ผ่าน — สาเหตุจริงซ่อนอยู่ใน `error.cause.code`
 * ไฟล์นี้ดึงสาเหตุนั้นออกมาต่อกับ URL ที่เรียก ให้ข้อความเดียวบอกได้เลยว่าต้องไปแก้ที่ไหน
 */

const MAX_CAUSE_DEPTH = 5;

const CAUSE_HINTS: Record<string, string> = {
  ENOTFOUND: 'Host name not found (DNS) - check that this machine can resolve the name and the URL in env is spelled correctly',
  EAI_AGAIN: 'DNS timed out or failed temporarily - check cluster DNS or outbound network',
  ECONNREFUSED: 'Reached the host but the port is closed - check that DSS listens on this port and the port number is correct',
  ECONNRESET: 'Connection was reset by the peer - possibly https was used against a plain http port',
  EPROTO: 'TLS handshake failed - possibly https was used against a plain http port',
  ETIMEDOUT: 'Connection timed out - usually a firewall/NetworkPolicy blocking outbound traffic',
  UND_ERR_CONNECT_TIMEOUT:
    'Connection timed out - usually a firewall/NetworkPolicy blocking outbound traffic',
  EHOSTUNREACH: 'No route to host',
  ENETUNREACH: 'No route to network',
  CERT_HAS_EXPIRED: 'The TLS certificate of the host has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The TLS certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'The TLS certificate is self-signed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify the TLS certificate of the host',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The name in the URL does not match the TLS certificate of the host',
};

/** ตัด query string + user:password ออก เหลือแค่ที่อยู่ที่เอาไปไล่ต่อได้ */
export function dssEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // ปล่อยค่าดิบให้เห็น เพราะ URL พังมักมาจาก env ที่ติดเครื่องหมายคำพูดหรือช่องว่างมาด้วย
    return `'${url.slice(0, 120)}' (malformed URL)`;
  }
}

/** เดินตามสาย cause (รวม AggregateError ที่ undici ใช้ตอนลองหลาย IP) หา error code */
export function fetchCauseCode(error: unknown, depth = 0): string | null {
  if (!error || typeof error !== 'object' || depth > MAX_CAUSE_DEPTH) return null;

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim() !== '') return code.trim();

  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    for (const entry of nested) {
      const found = fetchCauseCode(entry, depth + 1);
      if (found) return found;
    }
  }

  return fetchCauseCode((error as { cause?: unknown }).cause, depth + 1);
}

/** ข้อความล่างสุดที่อ่านรู้เรื่อง ใช้ตอนไม่มี error code ให้ยึด */
export function fetchCauseMessage(error: unknown, depth = 0): string | null {
  if (!error || typeof error !== 'object' || depth > MAX_CAUSE_DEPTH) return null;

  const deeper =
    fetchCauseMessage((error as { cause?: unknown }).cause, depth + 1) ??
    (Array.isArray((error as { errors?: unknown }).errors)
      ? fetchCauseMessage(((error as { errors: unknown[] }).errors ?? [])[0], depth + 1)
      : null);
  if (deeper) return deeper;

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim() !== '' && message !== 'fetch failed') {
    return message.trim();
  }
  return null;
}

export function describeDssFetchFailure(url: string, error: unknown): string {
  const where = `Call to DSS at ${dssEndpointLabel(url)} failed`;
  const code = fetchCauseCode(error);

  if (code) {
    const hint = CAUSE_HINTS[code];
    return hint ? `${where} (${code}: ${hint})` : `${where} (${code})`;
  }

  const message = fetchCauseMessage(error);
  return message ? `${where}: ${message}` : `${where} (network connection failed)`;
}
