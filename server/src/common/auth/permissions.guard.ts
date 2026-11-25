import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditWriterService } from '../audit/audit-writer.service';
import { AppException } from '../errors/app-exception';
import type { AuthUser } from './auth-user';
import { LOGIN_ONLY_KEY } from './login-only.decorator';
import type { PermissionCode } from './permission-catalog';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PERMISSIONS_KEY } from './require-permission.decorator';

/**
 * Last global guard. Secure by default: a handler without @Public / @LoginOnly / @RequirePermission
 * is refused. SUPER_ADMIN bypasses permission checks (still audited by the interceptor).
 * Every refusal leaves an ACCESS_DENIED row (Result 2).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly audit?: AuditWriterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new AppException(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');

    if (this.reflector.getAllAndOverride<boolean>(LOGIN_ONLY_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(PERMISSIONS_KEY, targets);
    if (!required?.length) return this.deny(user, req, 'no-permission-decorator');
    if (user.roleCode === 'SUPER_ADMIN') return true;

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) return this.deny(user, req, missing);
    return true;
  }

  private async deny(user: AuthUser, req: Request, missing: PermissionCode[] | string): Promise<never> {
    await this.audit?.insert({
      action: 'ACCESS_DENIED',
      result: 2,
      userId: user.id,
      actorUsername: user.username,
      actorRole: user.roleCode,
      changes: { deniedPermissions: missing },
      httpMethod: req.method,
      requestPath: req.originalUrl ?? req.url,
    });
    throw new AppException(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  }
}
