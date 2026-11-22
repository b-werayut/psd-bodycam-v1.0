import { IsBoolean } from 'class-validator';

export class SetUserAccessDto {
  @IsBoolean()
  enabled!: boolean;
}
