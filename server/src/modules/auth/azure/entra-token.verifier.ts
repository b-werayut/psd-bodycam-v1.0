import { Logger } from '@nestjs/common';
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { AppException } from '../../../common/errors/app-exception';
import type { AzureAdConfig } from './azure-ad.config';
import { AzureClaimsError, extractAzureIdentity, type AzureIdentity } from './azure-claims';

const invalid = (message: string) => new AppException(401, 'SSO_TOKEN_INVALID', message);

/** jose error code, else the error name — for logs. */
export function errorCode(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code) return code;
  return cause instanceof Error && cause.name ? cause.name : 'UNKNOWN';
}

/** kid / alg / iss / aud / tid of a token for troubleshooting logs — never personal claims. */
export function describeToken(idToken: string): string {
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(idToken) as Record<string, unknown>;
    payload = decodeJwt(idToken) as Record<string, unknown>;
  } catch {
    const parts = idToken.split('.').length;
    return `อ่านเนื้อ token ไม่ออก (ไม่ใช่ JWT — มี ${parts} ส่วน ยาว ${idToken.length} ตัวอักษร)`;
  }
  const one = (value: unknown): string => {
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value)) return value.join(',') || '-';
    return '-';
  };
  return [
    `kid=${one(header.kid)}`,
    `alg=${one(header.alg)}`,
    `iss=${one(payload.iss)}`,
    `aud=${one(payload.aud)}`,
    `tid=${one(payload.tid)}`,
  ].join(' ');
}

/**
 * Verifies the Microsoft id_token the SPA got from MSAL: RS256 signature against the tenant JWKS,
 * issuer, audience = our SSO client id, ±60 s clock skew, then the claims (oid, tid, email, domain).
 */
export class EntraTokenVerifier {
  private readonly logger = new Logger(EntraTokenVerifier.name);
  private remote?: JWTVerifyGetKey;

  constructor(
    private readonly config: AzureAdConfig,
    private readonly jwks?: JWTVerifyGetKey,
  ) {}

  async verify(idToken: string): Promise<AzureIdentity> {
    if (!this.config.enabled) {
      throw new AppException(403, 'SSO_DISABLED', 'ระบบยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยบัญชีองค์กร');
    }

    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(idToken, this.keys(), {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
      });
      payload = result.payload as Record<string, unknown>;
    } catch (cause) {
      throw this.toHttpError(cause, idToken);
    }

    try {
      return extractAzureIdentity(payload, {
        tenantId: this.config.tenantId,
        allowedEmailDomains: this.config.allowedEmailDomains,
      });
    } catch (cause) {
      if (cause instanceof AzureClaimsError) throw invalid(cause.message);
      throw cause;
    }
  }

  /** Injected keys (tests) or the tenant's remote JWKS, created on first use from the current jwksUri. */
  private keys(): JWTVerifyGetKey {
    if (this.jwks) return this.jwks;
    this.remote ??= createRemoteJWKSet(new URL(this.config.jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    return this.remote;
  }

  private toHttpError(cause: unknown, idToken: string): AppException {
    if (cause instanceof joseErrors.JWTExpired) {
      return invalid('การยืนยันตัวตนกับ Microsoft หมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่');
    }
    if (cause instanceof joseErrors.JWTClaimValidationFailed) {
      this.logger.warn(`id_token claim ไม่ผ่าน: ${cause.claim} — ${cause.message}`);
      return invalid('token จาก Microsoft ไม่ตรงกับที่ระบบตั้งค่าไว้ (ตรวจ Application (client) ID / Directory (tenant) ID)');
    }
    if (
      cause instanceof joseErrors.JWSSignatureVerificationFailed ||
      cause instanceof joseErrors.JWKSNoMatchingKey ||
      cause instanceof joseErrors.JWSInvalid ||
      cause instanceof joseErrors.JWTInvalid
    ) {
      this.logger.warn(
        `ตรวจลายเซ็น id_token ไม่ผ่าน [${errorCode(cause)}] — ${describeToken(idToken)} · ` +
          `ระบบตรวจกับ clientId=${this.config.clientId} issuer=${this.config.issuer}`,
      );
      return invalid('ตรวจสอบ token จาก Microsoft ไม่ผ่าน');
    }
    this.logger.error(`ตรวจ id_token ไม่สำเร็จ (ติดต่อ ${this.config.jwksUri} ไม่ได้?): ${String(cause)}`);
    return invalid('ตรวจสอบบัญชีกับ Microsoft ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
}
