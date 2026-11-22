import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @Transform(trimmed)
  @IsString()
  @Length(3, 50)
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a–z, 0–9 และ . _ @ -' })
  username!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  roleCode!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  /** Omit for an SSO-only account. */
  @IsOptional()
  @IsString()
  @Length(10, 200, { message: 'รหัสผ่านต้องยาว 10–200 ตัวอักษร' })
  password?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  azureObjectId?: string;
}
