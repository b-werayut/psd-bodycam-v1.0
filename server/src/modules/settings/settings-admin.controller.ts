import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsAdminService } from './settings-admin.service';

/** ตั้งค่าระบบ — settings:manage is reserved for ADMIN (DL51). */
@Controller('settings')
export class SettingsAdminController {
  constructor(private readonly service: SettingsAdminService) {}

  @Get()
  @RequirePermission('settings:manage')
  findAll() {
    return this.service.findAll();
  }

  @Patch(':key')
  @RequirePermission('settings:manage')
  @Audit('UPDATE_SETTING', 'Settings')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.service.update(key, dto.value);
  }
}
