import { decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

/**
 * ตรวจ header `Authorization` ที่ DssAuth ส่งไป FastAPI ตามกติกาเดียวกับฝั่ง FastAPI (`app/core/api_token.py`):
 * `Bearer <JWT>` · alg HS256 เท่านั้น · sign ด้วย `key` · aud = psd-bwc-dss-services · ยังไม่หมดอายุ — คืน payload
 *
 * เขียนแยกจาก dss-auth.ts (ค่าคงที่ซ้ำโดยตั้งใจ) — test ที่ตรวจด้วยโค้ดตัวเองจะผ่านเสมอแม้โค้ดผิด
 */
export async function verifyDssBearer(header: string | undefined, key: string): Promise<JWTPayload> {
  const [scheme, token, extra] = (header ?? '').split(' ');
  if (scheme !== 'Bearer' || !token || extra !== undefined) {
    throw new Error(`ไม่ใช่ "Bearer <token>": ${String(header)}`);
  }
  const protectedHeader = decodeProtectedHeader(token);
  if (protectedHeader.alg !== 'HS256' || protectedHeader.typ !== 'JWT') {
    throw new Error(`header ของ JWT ผิด: ${JSON.stringify(protectedHeader)}`);
  }
  const { payload } = await jwtVerify(token, new TextEncoder().encode(key), {
    algorithms: ['HS256'],
    audience: 'psd-bwc-dss-services',
    requiredClaims: ['iat', 'exp'],
  });
  return payload;
}
