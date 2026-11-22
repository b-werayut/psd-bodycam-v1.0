import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../common/http/page-query.dto';

export class QueryEmployeesDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3])
  status?: 1 | 2 | 3;
}
