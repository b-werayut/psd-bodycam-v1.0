import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app-exception';
import { getContext } from '../context/request-context';
import { verifyAccessToken } from './access-token';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';

/** First global guard: every non-@Public route needs a valid Bearer access token. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppException(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    }
    const payload = await verifyAccessToken(header.slice(7).trim());
    if (!payload) {
      throw new AppException(401, 'UNAUTHORIZED', 'การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
    }

    const user: AuthUser = {
      id: BigInt(payload.sub),
      username: payload.username,
      roleId: BigInt(payload.roleId),
      roleCode: payload.roleCode,
      permissions: payload.permissions,
    };
    req.user = user;
    const store = getContext();
    if (store) {
      store.userId = user.id;
      store.user = user;
    }
    return true;
  }
}
