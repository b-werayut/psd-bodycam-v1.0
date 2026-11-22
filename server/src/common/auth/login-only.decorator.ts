import { SetMetadata } from '@nestjs/common';

export const LOGIN_ONLY_KEY = 'loginOnly';

/** Any logged-in user, no permission needed (e.g. /auth/me). */
export const LoginOnly = () => SetMetadata(LOGIN_ONLY_KEY, true);
