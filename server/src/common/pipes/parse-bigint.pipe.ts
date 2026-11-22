import { Injectable, type PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app-exception';

const MAX_BIGINT = 9223372036854775807n;

/** Route ids are positive bigint; anything else ⇒ 400 (never reaches SQL). */
@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    if (typeof value === 'string' && /^\d{1,19}$/.test(value)) {
      const id = BigInt(value);
      if (id <= MAX_BIGINT) return id;
    }
    throw new AppException(400, 'VALIDATION_FAILED', 'รหัสอ้างอิงไม่ถูกต้อง');
  }
}
