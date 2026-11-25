import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('users:read')
  list(@CurrentUser() actor: AuthUser) {
    return this.roles.list(actor);
  }

  @Get(':id/permissions')
  @RequirePermission('users:read')
  permissions(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.roles.permissions(actor, id);
  }

  /** roles:manage is reserved for SUPER_ADMIN (DL51). Takes effect at each user's next token refresh (≤ 15 min). */
  @Put(':id/permissions')
  @RequirePermission('roles:manage')
  @Audit('SET_ROLE_PERMISSIONS', 'Roles')
  setPermissions(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: SetRolePermissionsDto) {
    return this.roles.setPermissions(id, dto.permissions);
  }
}
