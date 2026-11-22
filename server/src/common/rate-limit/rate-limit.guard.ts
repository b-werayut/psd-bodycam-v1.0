import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app-exception';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';
import { rateLimitKey, rateLimitSpec, type RateLimitName } from './rate-limit-specs';
import { RateLimiterService } from './rate-limiter.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const spec = rateLimitSpec(name, process.env);
    const key = rateLimitKey(name, req.ip);
    const hit = await this.limiter.hit(key, spec.limit, spec.windowSeconds);
    if (hit.allowed) return true;

    this.logger.warn(`เกินโควตา ${name} จาก ${key} (${hit.count}/${spec.limit})`);
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(hit.retryAfterSeconds));
    throw new AppException(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง', {
      retryAfterSeconds: hit.retryAfterSeconds,
    });
  }
}
