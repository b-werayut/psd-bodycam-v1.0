import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntraUserSyncService } from './entra-user-sync.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SESSION_REVOCATION_NOTIFIER, type SessionRevocationNotifier } from './session-revocation.notifier';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController],
  providers: [
    UsersService,
    RolesService,
    EntraUserSyncService,
    {
      // Open sockets of the user get `session:revoked` and are disconnected (RealtimeModule is global).
      provide: SESSION_REVOCATION_NOTIFIER,
      inject: [RealtimeGateway],
      useFactory: (gateway: RealtimeGateway): SessionRevocationNotifier => ({
        notify: (userId, payload) => gateway.revokeUserSessions(userId, payload),
      }),
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
