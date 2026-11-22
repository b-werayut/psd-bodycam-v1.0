import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Permissions, RolePermissions } from '../../db/schema';
import {
  PERMISSION_CODES,
  RESERVED_ADMIN_PERMISSIONS,
  isPermissionCode,
  type PermissionCode,
  type RoleCode,
} from './permission-catalog';

@Injectable()
export class PermissionCheckService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Permissions a role carries in its access token, in catalog order.
   * ADMIN ⇒ the whole catalog. Other roles ⇒ their RolePermissions rows, minus the ADMIN-reserved
   * codes, always — even if a row was inserted straight into the DB (DL51).
   */
  async roleGrants(roleId: bigint, roleCode: RoleCode): Promise<PermissionCode[]> {
    if (roleCode === 'ADMIN') return [...PERMISSION_CODES];
    const rows = await this.db
      .select({ code: Permissions.Code })
      .from(RolePermissions)
      .innerJoin(Permissions, eq(Permissions.Id, RolePermissions.PermissionId))
      .where(eq(RolePermissions.RoleId, roleId));
    const granted = new Set(rows.map((r) => r.code));
    return PERMISSION_CODES.filter(
      (code) => granted.has(code) && isPermissionCode(code) && !RESERVED_ADMIN_PERMISSIONS.includes(code),
    );
  }
}
