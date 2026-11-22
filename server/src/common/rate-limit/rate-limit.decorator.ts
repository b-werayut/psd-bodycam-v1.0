import { SetMetadata } from '@nestjs/common';
import type { RateLimitName } from './rate-limit-specs';

export const RATE_LIMIT_KEY = 'rateLimit';

export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);
