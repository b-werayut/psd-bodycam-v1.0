import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/http/page-query.dto';

export class QueryUsersDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  roleCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  status?: 1 | 2;
}
