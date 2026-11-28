import { Type } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { PageQueryDto } from '../../../common/http/page-query.dto';

export class QueryWorkOrdersDto extends PageQueryDto {
  /** Only work orders whose Booking camera references resolve to this camera. */
  @IsOptional()
  @Matches(/^[1-9]\d{0,17}$/)
  deviceId?: string;

  /** WorkOrders.Status 6 Planned · 1 Open · 2 Closed · 3 Cancelled (omitted = every status) */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 6])
  status?: 1 | 2 | 3 | 6;
}
