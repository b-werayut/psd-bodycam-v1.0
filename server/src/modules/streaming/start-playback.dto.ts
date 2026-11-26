import { IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class StartPlaybackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  deviceCode!: string;

  @IsISO8601({ strict: true })
  startAt!: string;

  @IsISO8601({ strict: true })
  endAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1)
  channel?: number;
}
