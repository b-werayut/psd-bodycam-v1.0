import { IsBoolean, IsOptional } from 'class-validator';

export class SyncEntraUsersDto {
  /** default true: report only, write nothing */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** also match local rows without email / oid by the part of the UPN before @ */
  @IsOptional()
  @IsBoolean()
  matchByUsername?: boolean;
}
