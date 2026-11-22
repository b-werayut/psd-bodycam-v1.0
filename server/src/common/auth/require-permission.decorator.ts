import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from './permission-catalog';

export const PERMISSIONS_KEY = 'permissions';

/** The caller needs every listed permission (ADMIN bypasses). */
export const RequirePermission = (...codes: PermissionCode[]) => SetMetadata(PERMISSIONS_KEY, codes);
