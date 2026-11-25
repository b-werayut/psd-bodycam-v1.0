import { Body, Controller, HttpCode, Logger, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { getCorrelationId } from '../../../common/context/request-context';
import { AppException } from '../../../common/errors/app-exception';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { BookingInboundAuthGuard } from './booking-inbound.guard';
import { BookingInboxService } from './booking-inbox.service';
import { InboundCallLogInterceptor } from './inbound-call-log.interceptor';
import { safeErrorSummary } from './inbound-call-log.service';
import { validateInboundBody } from './inbound-body';

@Controller('integration/booking')
export class BookingInboundController {
  private readonly logger = new Logger(BookingInboundController.name);

  constructor(private readonly inbox: BookingInboxService) {}

  // The body is taken as `unknown` (no DTO class) so the global ValidationPipe leaves it untouched.
  @Post('jobs')
  @Public()
  @RateLimit('booking-inbound')
  @UseGuards(BookingInboundAuthGuard)
  @UseInterceptors(InboundCallLogInterceptor)
  @HttpCode(202)
  async receive(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const checked = validateInboundBody(body);
    if (!checked.ok) {
      throw new AppException(400, 'VALIDATION_FAILED', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', checked.details);
    }

    let result;
    try {
      result = await this.inbox.receive(checked.value, body);
    } catch (err) {
      this.logger.error(`รับใบงานไม่สำเร็จ: ${safeErrorSummary(err)}`);
      throw new AppException(503, 'SERVICE_UNAVAILABLE', 'ระบบยังรับข้อมูลไม่ได้ในขณะนี้ กรุณาส่งใหม่ภายหลัง');
    }

    if (result.status === 'duplicate') res.status(200);
    return { status: result.status, externalJobId: result.externalJobId, correlationId: getCorrelationId() ?? null };
  }
}
