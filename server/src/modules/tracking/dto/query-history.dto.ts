import { IsString, MaxLength } from 'class-validator';

/** Parsed and range-checked by parseHistoryRange (400 INVALID_RANGE), not by the validation pipe. */
export class QueryHistoryDto {
  @IsString()
  @MaxLength(40)
  from!: string;

  @IsString()
  @MaxLength(40)
  to!: string;
}
