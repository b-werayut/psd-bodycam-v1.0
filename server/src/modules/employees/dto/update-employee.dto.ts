import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** '' ⇒ null (clear); undefined ⇒ leave unchanged */
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const present = (key: keyof UpdateEmployeeDto) => (o: UpdateEmployeeDto) => o[key] !== null && o[key] !== undefined;

export class UpdateEmployeeDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  employeeCode?: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @Transform(emptyToNull)
  @ValidateIf(present('phone'))
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(present('userId'))
  @Matches(/^\d{1,19}$/)
  userId?: string | null;

  @Transform(emptyToNull)
  @ValidateIf(present('bookingEmployeeRef'))
  @IsString()
  @MaxLength(64)
  bookingEmployeeRef?: string | null;

  /** 1 ทำงาน · 2 พักงาน · 3 ลาออก */
  @IsOptional()
  @IsIn([1, 2, 3])
  status?: 1 | 2 | 3;
}
