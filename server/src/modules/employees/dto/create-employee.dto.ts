import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateEmployeeDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  employeeCode!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Users.Id of the login account of this employee */
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\d{1,19}$/)
  userId?: string;

  /** [Assumption] the employee id in Booking (matches a job's leaderRef) */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bookingEmployeeRef?: string;
}
