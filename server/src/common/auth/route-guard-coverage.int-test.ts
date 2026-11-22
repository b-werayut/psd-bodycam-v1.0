import { NestFactory, DiscoveryService, MetadataScanner, Reflector, DiscoveryModule } from '@nestjs/core';
import { Module, RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AUDIT_KEY } from '../audit/audit.decorator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { IS_PUBLIC_KEY } from './public.decorator';
import { LOGIN_ONLY_KEY } from './login-only.decorator';
import { PERMISSIONS_KEY } from './require-permission.decorator';

@Module({ imports: [AppModule, DiscoveryModule] })
class CoverageModule {}

describe('route guard coverage', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(CoverageModule, { logger: false });
  });
  afterAll(async () => {
    await app.close();
  });

  it('every handler of AppModule has exactly one of @Public / @LoginOnly / @RequirePermission', () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);
    const problems: string[] = [];
    let handlers = 0;

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance);
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        // Route handlers only (private helpers such as AuthController.issue are not endpoints).
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        handlers++;
        const marks = [
          reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, wrapper.metatype]) ? '@Public' : null,
          reflector.getAllAndOverride(LOGIN_ONLY_KEY, [handler, wrapper.metatype]) ? '@LoginOnly' : null,
          (reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [handler, wrapper.metatype]) ?? []).length
            ? '@RequirePermission'
            : null,
        ].filter(Boolean);
        if (marks.length !== 1) {
          problems.push(`${wrapper.name}.${name}: ${marks.length ? marks.join(' + ') : 'ไม่มี decorator สิทธิ์'}`);
        }
        // Writes leave an audit row. @Public auth endpoints (login/refresh/logout) audit inside AuthService.
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        if (method !== RequestMethod.GET && marks[0] !== '@Public' && !Reflect.getMetadata(AUDIT_KEY, handler)) {
          problems.push(`${wrapper.name}.${name}: เขียนข้อมูลแต่ไม่มี @Audit`);
        }
      }
    }

    expect(handlers).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
