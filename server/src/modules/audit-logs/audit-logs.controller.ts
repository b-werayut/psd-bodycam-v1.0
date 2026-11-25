import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** ประวัติการใช้งาน — audit:view is reserved for SUPER_ADMIN (Q19, DL51). */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  @RequirePermission('audit:view')
  list(@Query() query: QueryAuditLogsDto) {
    return this.service.list(query);
  }

  @Get('actions')
  @RequirePermission('audit:view')
  actions() {
    return this.service.actions();
  }
}
