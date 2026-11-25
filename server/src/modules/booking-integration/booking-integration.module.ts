import { Module } from '@nestjs/common';
import { BOOKING_INBOUND_CONFIG } from './booking-integration.constants';
import { readBookingInboundConfig } from './inbound/booking-inbound.config';
import { BookingInboundAuthGuard } from './inbound/booking-inbound.guard';
import { BookingInboundController } from './inbound/booking-inbound.controller';
import { BookingInboxService } from './inbound/booking-inbox.service';
import { InboundCallLogInterceptor } from './inbound/inbound-call-log.interceptor';
import { InboundCallLogService } from './inbound/inbound-call-log.service';

@Module({
  controllers: [BookingInboundController],
  providers: [
    { provide: BOOKING_INBOUND_CONFIG, useFactory: () => readBookingInboundConfig(process.env) },
    BookingInboxService,
    InboundCallLogService,
    InboundCallLogInterceptor,
    BookingInboundAuthGuard,
  ],
})
export class BookingIntegrationModule {}
