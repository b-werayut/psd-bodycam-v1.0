import { IsString, MaxLength } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @MaxLength(1000)
  value!: string;
}
