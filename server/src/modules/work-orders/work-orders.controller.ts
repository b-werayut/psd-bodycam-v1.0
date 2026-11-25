import { Controller, Get, Param, Query } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { QueryWorkOrdersDto } from './dto/query-work-orders.dto';
import { WorkOrdersService } from './work-orders.service';

/** ใบงาน — read-only; work orders come only from Booking (DL33). */
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  @RequirePermission('work-orders:read')
  list(@Query() query: QueryWorkOrdersDto) {
    return this.workOrders.list(query);
  }

  @Get(':id')
  @RequirePermission('work-orders:read')
  @Audit('VIEW_WORK_ORDER', 'WorkOrders')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const fullBooking = user.roleCode === 'SUPER_ADMIN' || user.permissions.includes('booking:read');
    return this.workOrders.detail(id, fullBooking);
  }

  @Get(':id/events')
  @RequirePermission('work-orders:read')
  events(@Param('id') id: string) {
    return this.workOrders.events(id);
  }
}
