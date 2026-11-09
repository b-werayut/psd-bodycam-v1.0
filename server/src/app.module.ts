import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { AppLoggerModule } from './common/logging/logger.module';

@Module({
  imports: [AppLoggerModule],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
