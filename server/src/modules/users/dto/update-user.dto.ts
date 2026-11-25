import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** '' ⇒ null (clear the field); undefined stays undefined (leave it). */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateUserDto {
  @Transform(trimmed)
  @ValidateIf((o: UpdateUserDto) => o.username !== undefined)
  @IsString()
  @Length(3, 50)
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a–z, 0–9 และ . _ @ -' })
  username?: string;

  @Transform(trimmed)
  @ValidateIf((o: UpdateUserDto) => o.firstName !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firstName?: string;

  @Transform(trimmed)
  @ValidateIf((o: UpdateUserDto) => o.lastName !== undefined)
  @IsString()
  @MaxLength(200)
  lastName?: string;

  /** null clears the email */
  @Transform(emptyToNull)
  @ValidateIf((o: UpdateUserDto) => o.email !== null && o.email !== undefined)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @Transform(emptyToNull)
  @ValidateIf((o: UpdateUserDto) => o.phone !== null && o.phone !== undefined)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  roleCode?: string;

  /** A new password also ends every session of the user. */
  @IsOptional()
  @IsString()
  @Length(10, 200, { message: 'รหัสผ่านต้องยาว 10–200 ตัวอักษร' })
  password?: string;

  /** null unlinks the Entra account */
  @Transform(emptyToNull)
  @ValidateIf((o: UpdateUserDto) => o.azureObjectId !== null && o.azureObjectId !== undefined)
  @IsString()
  @MaxLength(64)
  azureObjectId?: string | null;
}
