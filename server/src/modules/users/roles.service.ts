import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  PERMISSION_CODES,
  RESERVED_ADMIN_PERMISSIONS,
  isPermissionCode,
  type PermissionCode,
} from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Permissions, RolePermissions, Roles } from '../../db/schema';
import { assertGrantablePermissions, canSeeUser } from './admin-protection';

const notFound = () => new AppException(404, 'NOT_FOUND', 'ไม่พบบทบาท');

@Injectable()
export class RolesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Roles for pickers and the permission matrix. The ADMIN role is hidden from non-ADMIN callers. */
  async list(actor: AuthUser) {
    const rows = await this.db
      .select({ Id: Roles.Id, Code: Roles.Code, Name: Roles.Name, IsSystem: Roles.IsSystem })
      .from(Roles)
      .orderBy(asc(Roles.Id));
    const data = rows
      .filter((r) => canSeeUser(actor.roleCode, r.Code))
      .map((r) => ({ id: r.Id.toString(), code: r.Code, name: r.Name, isSystem: r.IsSystem }));
    return { data, total: data.length, reservedPermissions: [...RESERVED_ADMIN_PERMISSIONS] };
  }

  async permissions(actor: AuthUser, roleId: bigint): Promise<{ data: PermissionCode[]; total: number }> {
    const role = await this.role(roleId);
    if (!canSeeUser(actor.roleCode, role.Code)) throw notFound();
    const data = await this.grants(roleId);
    return { data, total: data.length };
  }

  /** Replaces the role's grants. ADMIN's own row set is fixed (it bypasses checks anyway). */
  async setPermissions(roleId: bigint, requested: string[]): Promise<{ data: PermissionCode[]; total: number }> {
    const role = await this.role(roleId);
    if (role.Code === 'ADMIN') {
      throw new AppException(400, 'ROLE_IMMUTABLE', 'สิทธิ์ของบทบาทผู้ดูแลระบบแก้ไขไม่ได้');
    }
    const unknown = requested.filter((c) => !isPermissionCode(c));
    if (unknown.length) {
      throw new AppException(400, 'UNKNOWN_PERMISSION', 'มีสิทธิ์ที่ไม่รู้จัก', { permissions: unknown });
    }
    const codes = PERMISSION_CODES.filter((c) => requested.includes(c));
    assertGrantablePermissions(role.Code, codes);

    await this.db.transaction(async (tx) => {
      await tx.delete(RolePermissions).where(eq(RolePermissions.RoleId, roleId));
      if (!codes.length) return;
      const permissionRows = await tx
        .select({ Id: Permissions.Id })
        .from(Permissions)
        .where(inArray(Permissions.Code, codes));
      await tx.insert(RolePermissions).values(permissionRows.map((p) => ({ RoleId: roleId, PermissionId: p.Id })));
    });
    const data = await this.grants(roleId);
    return { data, total: data.length };
  }

  private async role(roleId: bigint) {
    const [role] = await this.db.select({ Code: Roles.Code }).from(Roles).where(eq(Roles.Id, roleId)).limit(1);
    if (!role) throw notFound();
    return role;
  }

  private async grants(roleId: bigint): Promise<PermissionCode[]> {
    const rows = await this.db
      .select({ code: Permissions.Code })
      .from(RolePermissions)
      .innerJoin(Permissions, eq(Permissions.Id, RolePermissions.PermissionId))
      .where(eq(RolePermissions.RoleId, roleId));
    const granted = new Set(rows.map((r) => r.code));
    return PERMISSION_CODES.filter((c) => granted.has(c));
  }
}
