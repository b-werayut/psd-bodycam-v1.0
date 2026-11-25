import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { SetUserAccessDto } from './dto/set-user-access.dto';
import { SyncEntraUsersDto } from './dto/sync-entra-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EntraUserSyncService } from './entra-user-sync.service';
import { UsersService } from './users.service';

/** ผู้ใช้ระบบ — ADMIN manages every account except SUPER_ADMIN ones, which it cannot even see (DL51, DL55). */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly entraSync: EntraUserSyncService,
  ) {}

  @Get()
  @RequirePermission('users:read')
  list(@CurrentUser() actor: AuthUser, @Query() query: QueryUsersDto) {
    return this.users.list(actor, query);
  }

  /** ผู้ใช้จาก Entra: compare the directory with Users, write nothing. Declared before ':id'. */
  @Get('entra-directory')
  @RequirePermission('users:manage')
  @Audit('LIST_ENTRA_USERS', 'Users')
  entraDirectory(@CurrentUser() actor: AuthUser) {
    return this.entraSync.sync(actor, { dryRun: true });
  }

  /** Link oids / fill empty fields from Entra (dryRun defaults to true). Never creates accounts. */
  @Post('sync-entra')
  @HttpCode(200)
  @RequirePermission('users:manage')
  @Audit('SYNC_ENTRA_USERS', 'Users')
  syncEntra(@CurrentUser() actor: AuthUser, @Body() dto: SyncEntraUsersDto) {
    return this.entraSync.sync(actor, dto);
  }

  @Get(':id')
  @RequirePermission('users:read')
  findOne(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.users.findOne(actor, id);
  }

  @Post()
  @RequirePermission('users:manage')
  @Audit('CREATE_USER', 'Users')
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermission('users:manage')
  @Audit('UPDATE_USER', 'Users')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Patch(':id/access')
  @RequirePermission('users:manage')
  @Audit('SET_USER_ACCESS', 'Users')
  setAccess(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: SetUserAccessDto) {
    return this.users.setAccess(actor, id, dto.enabled);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users:manage')
  @Audit('DELETE_USER', 'Users')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint): Promise<void> {
    await this.users.remove(actor, id);
  }
}
