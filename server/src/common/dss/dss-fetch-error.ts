/**
 * undici โยน `TypeError: fetch failed` เหมือนกันหมดไม่ว่าจะพังเพราะ DNS, พอร์ตปิด,
 * firewall บล็อก หรือ cert ไม่ผ่าน — สาเหตุจริงซ่อนอยู่ใน `error.cause.code`
 * ไฟล์นี้ดึงสาเหตุนั้นออกมาต่อกับ URL ที่เรียก ให้ข้อความเดียวบอกได้เลยว่าต้องไปแก้ที่ไหน
 */

const MAX_CAUSE_DEPTH = 5;

const CAUSE_HINTS: Record<string, string> = {
  ENOTFOUND: 'หาชื่อโฮสต์นี้ไม่เจอ (DNS) — ตรวจว่าเครื่องที่รัน resolve ชื่อนี้ได้ และ URL ใน env สะกดถูก',
  EAI_AGAIN: 'DNS ตอบไม่ทัน/ล้มชั่วคราว — ตรวจ DNS ของคลัสเตอร์หรือเครือข่ายขาออก',
  ECONNREFUSED: 'ต่อถึงเครื่องปลายทางแล้วแต่พอร์ตนี้ไม่เปิด — ตรวจว่า DSS ฟังพอร์ตนี้จริงและเลขพอร์ตถูก',
  ECONNRESET: 'ปลายทางตัดการเชื่อมต่อกลางคัน — อาจเรียก https ใส่พอร์ตที่เป็น http ล้วน',
  EPROTO: 'จับมือ TLS ไม่สำเร็จ — อาจเรียก https ใส่พอร์ตที่เป็น http ล้วน',
  ETIMEDOUT: 'ต่อไม่ติดจนหมดเวลา — มักเป็น firewall/NetworkPolicy บล็อกขาออก',
  UND_ERR_CONNECT_TIMEOUT:
    'ต่อไม่ติดจนหมดเวลา — มักเป็น firewall/NetworkPolicy บล็อกขาออก',
  EHOSTUNREACH: 'ไม่มีเส้นทางไปยังเครื่องปลายทาง',
  ENETUNREACH: 'ไม่มีเส้นทางออกไปเครือข่ายปลายทาง',
  CERT_HAS_EXPIRED: 'ใบรับรอง TLS ของปลายทางหมดอายุ',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'ใบรับรอง TLS เป็น self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'ใบรับรอง TLS เป็น self-signed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'ตรวจสอบใบรับรอง TLS ของปลายทางไม่ได้',
  ERR_TLS_CERT_ALTNAME_INVALID: 'ชื่อใน URL ไม่ตรงกับใบรับรอง TLS ของปลายทาง',
};

/** ตัด query string + user:password ออก เหลือแค่ที่อยู่ที่เอาไปไล่ต่อได้ */
export function dssEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // ปล่อยค่าดิบให้เห็น เพราะ URL พังมักมาจาก env ที่ติดเครื่องหมายคำพูดหรือช่องว่างมาด้วย
    return `'${url.slice(0, 120)}' (URL ไม่ถูกรูปแบบ)`;
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
  const where = `เรียก DSS ที่ ${dssEndpointLabel(url)} ไม่สำเร็จ`;
  const code = fetchCauseCode(error);

  if (code) {
    const hint = CAUSE_HINTS[code];
    return hint ? `${where} (${code}: ${hint})` : `${where} (${code})`;
  }

  const message = fetchCauseMessage(error);
  return message ? `${where}: ${message}` : `${where} (ต่อเครือข่ายไม่ได้)`;
}
