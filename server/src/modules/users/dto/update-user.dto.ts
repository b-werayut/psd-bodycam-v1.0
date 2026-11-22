import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** '' ⇒ null (clear the field); undefined stays undefined (leave it). */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateUserDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName?: string;

  /** null clears the email */
  @Transform(emptyToNull)
  @ValidateIf((o: UpdateUserDto) => o.email !== null && o.email !== undefined)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

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
