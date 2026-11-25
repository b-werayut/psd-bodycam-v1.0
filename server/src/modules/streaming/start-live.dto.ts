import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class StartLiveDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  deviceCode!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1)
  channel?: number;
}
