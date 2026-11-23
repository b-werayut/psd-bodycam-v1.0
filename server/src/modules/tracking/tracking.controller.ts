import { Controller, Get, Param, Query } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { QueryHistoryDto } from './dto/query-history.dto';
import { parseHistoryRange } from './history-range';
import { TrackingReadService } from './tracking-read.service';

/** แผนที่ติดตาม / ประวัติเส้นทาง */
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingReadService) {}

  @Get('positions')
  @RequirePermission('tracking:view')
  positions() {
    return this.tracking.positions();
  }

  /** A bodycam route is a person's whereabouts for the day: its own permission, and every view is audited. */
  @Get('devices/:id/history')
  @RequirePermission('tracking:history')
  @Audit('VIEW_GPS_HISTORY', 'Devices')
  history(@Param('id', ParseBigIntPipe) id: bigint, @Query() query: QueryHistoryDto) {
    const { from, to } = parseHistoryRange(query.from, query.to);
    return this.tracking.deviceHistory(id, from, to);
  }
}
