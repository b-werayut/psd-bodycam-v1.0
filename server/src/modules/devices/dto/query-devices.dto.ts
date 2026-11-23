import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../common/http/page-query.dto';

export class QueryDevicesDto extends PageQueryDto {
  /** Devices.Status 1 Active · 2 Inactive · 3 Maintenance · 4 Retired */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  status?: 1 | 2 | 3 | 4;

  /** Devices.Kind 1 Primary · 2 Spare */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  kind?: 1 | 2;

  /** computed screen status (DSS / cache / DeviceState) */
  @IsOptional()
  @IsIn(['online', 'offline', 'unknown'])
  online?: 'online' | 'offline' | 'unknown';
}
