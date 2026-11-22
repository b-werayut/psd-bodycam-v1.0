import { Module } from '@nestjs/common';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsAdminService } from './settings-admin.service';

@Module({
  controllers: [SettingsAdminController],
  providers: [SettingsAdminService],
})
export class SettingsAdminModule {}
