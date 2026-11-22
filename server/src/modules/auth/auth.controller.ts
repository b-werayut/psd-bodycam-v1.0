import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { LoginOnly } from '../../common/auth/login-only.decorator';
import { Public } from '../../common/auth/public.decorator';
import { AppException } from '../../common/errors/app-exception';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthService, type SignedIn } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { isPasswordLoginEnabled } from './password-login.policy';
import { REFRESH_COOKIE, readRefreshCookie, refreshCookieOptions } from './refresh-cookie';
import { AZURE_AD_CONFIG, publicAzureAdConfig, type AzureAdConfig } from './azure/azure-ad.config';
import { AzureLoginDto } from './dto/azure-login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AZURE_AD_CONFIG) private readonly azure: AzureAdConfig,
  ) {}

  @Public()
  @Get('config')
  config() {
    return {
      sso: publicAzureAdConfig(this.azure),
      passwordLogin: { enabled: isPasswordLoginEnabled(process.env) },
    };
  }

  @Public()
  @RateLimit('auth-login')
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    if (!isPasswordLoginEnabled(process.env)) {
      throw new AppException(403, 'PASSWORD_LOGIN_DISABLED', 'ระบบเปิดให้เข้าสู่ระบบด้วยบัญชีองค์กร (Microsoft) เท่านั้น');
    }
    return this.issue(res, await this.auth.login(dto.username, dto.password));
  }

  /** Microsoft Entra SSO: the SPA sends the id_token from MSAL, gets our tokens like a password login. */
  @Public()
  @RateLimit('auth-sso')
  @Post('azure')
  @HttpCode(200)
  async loginWithAzure(@Body() dto: AzureLoginDto, @Res({ passthrough: true }) res: Response) {
    return this.issue(res, await this.auth.loginWithAzure(dto.idToken));
  }

  @Public()
  @RateLimit('auth-refresh')
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = readRefreshCookie(req.headers.cookie);
    if (!raw) throw new AppException(401, 'REFRESH_INVALID', 'ไม่พบ session กรุณาเข้าสู่ระบบ');
    return this.issue(res, await this.auth.refresh(raw));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req.headers.cookie));
    const { path, sameSite, secure, httpOnly } = refreshCookieOptions(process.env);
    res.clearCookie(REFRESH_COOKIE, { path, sameSite, secure, httpOnly });
  }

  @LoginOnly()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @LoginOnly()
  @Post('change-password')
  @Audit('CHANGE_PASSWORD', 'Users')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword, readRefreshCookie(req.headers.cookie));
  }

  private issue(res: Response, signedIn: SignedIn) {
    res.cookie(REFRESH_COOKIE, signedIn.refreshToken, refreshCookieOptions(process.env));
    return { accessToken: signedIn.accessToken, user: signedIn.user };
  }
}
