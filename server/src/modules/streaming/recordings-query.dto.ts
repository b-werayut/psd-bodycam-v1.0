import { IsISO8601, IsNumberString, MaxLength } from 'class-validator';

export class RecordingsQueryDto {
  @IsNumberString({ no_symbols: true })
  @MaxLength(18)
  deviceId!: string;

  @IsISO8601({ strict: true })
  from!: string;

  @IsISO8601({ strict: true })
  to!: string;
}
