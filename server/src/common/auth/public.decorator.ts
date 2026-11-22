import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** No login needed. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
