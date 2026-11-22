import { Module } from '@nestjs/common';
import { AuditWriterService } from '../../common/audit/audit-writer.service';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AUTH_SETTINGS, type AuthSettings } from './auth-settings';
import { AZURE_AD_CONFIG, assertSomeLoginMethod, readAzureAdConfig, type AzureAdConfig } from './azure/azure-ad.config';
import { EntraTokenVerifier } from './azure/entra-token.verifier';
import { AuthController } from './auth.controller';
import { AUTH_AUDIT, AuthService, type AuthAudit } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    PermissionCheckService,
    {
      // Half-set or malformed AZURE_AD_* (or no way to sign in at all) stops the boot on purpose.
      provide: AZURE_AD_CONFIG,
      useFactory: (): AzureAdConfig => {
        const config = readAzureAdConfig(process.env);
        assertSomeLoginMethod(config, process.env);
        return config;
      },
    },
    {
      provide: EntraTokenVerifier,
      inject: [AZURE_AD_CONFIG],
      useFactory: (config: AzureAdConfig) => new EntraTokenVerifier(config),
    },
    {
      // Lockout policy is editable by ADMIN on ตั้งค่าระบบ (Settings auth.*).
      provide: AUTH_SETTINGS,
      inject: [SettingsService],
      useFactory: (settings: SettingsService): AuthSettings => ({
        getLockoutPolicy: async () => ({
          maxFailed: await settings.getInt('auth.max-failed-logins'),
          lockMinutes: await settings.getInt('auth.lockout-minutes'),
        }),
      }),
    },
    {
      provide: AUTH_AUDIT,
      inject: [AuditWriterService],
      useFactory:
        (writer: AuditWriterService): AuthAudit =>
        (event) =>
          writer.write({
            action: event.action,
            result: event.result,
            resourceType: 'Users',
            resourceId: event.userId,
            userId: event.userId,
            actorUsername: event.username,
            actorRole: event.role ?? null,
            changes: event.changes ?? null,
          }),
    },
  ],
  exports: [TokensService, PermissionCheckService],
})
export class AuthModule {}
