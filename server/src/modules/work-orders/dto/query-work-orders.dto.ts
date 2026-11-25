import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../common/http/page-query.dto';

export class QueryWorkOrdersDto extends PageQueryDto {
  /** WorkOrders.Status 6 Planned · 1 Open · 2 Closed · 3 Cancelled (omitted = every status) */
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 6])
  status?: 1 | 2 | 3 | 6;
}
