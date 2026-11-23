import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { DevicesService } from './devices.service';
import { QueryDevicesDto } from './dto/query-devices.dto';

/** กล้อง — read-only list (no device CRUD / sync screen, DL53). */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('devices:read')
  list(@Query() query: QueryDevicesDto) {
    return this.devices.list(query);
  }
}
