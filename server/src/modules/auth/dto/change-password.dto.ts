import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  oldPassword!: string;

  @IsString()
  @Length(10, 200, { message: 'รหัสผ่านใหม่ต้องยาว 10–200 ตัวอักษร' })
  newPassword!: string;
}
