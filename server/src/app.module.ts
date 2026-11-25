import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { LockModule } from './common/lock/lock.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { QueueModule } from './common/queue/queue.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { DssModule } from './common/dss/dss.module';
import { RedisModule } from './common/redis/redis.module';
import { SettingsModule } from './common/settings/settings.module';
import { DbModule } from './db/db.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { BookingIntegrationModule } from './modules/booking-integration/booking-integration.module';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SettingsAdminModule } from './modules/settings/settings-admin.module';
import { UsersModule } from './modules/users/users.module';
import { StreamingModule } from './modules/streaming/streaming.module';

@Module({
  imports: [
    AppLoggerModule,
    DbModule,
    RedisModule,
    LockModule,
    QueueModule,
    RateLimitModule,
    SettingsModule,
    AuditModule,
    RealtimeModule,
    DssModule,
    AlertsModule,
    DevicesModule,
    TrackingModule,
    AuthModule,
    SettingsAdminModule,
    AuditLogsModule,
    UsersModule,
    StreamingModule,
    BookingIntegrationModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Order matters: who you are → how often → what you may do.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    PermissionsGuard,
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
