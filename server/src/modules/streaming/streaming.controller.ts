import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { StartLiveDto } from './start-live.dto';
import { StreamingService } from './streaming.service';

@Controller('streams')
export class StreamingController {
  constructor(private readonly streams: StreamingService) {}

  @Post('live')
  @HttpCode(200)
  @RequirePermission('streaming:view-live', 'streaming:live-wall')
  @Audit('START_LIVE_STREAM', 'StreamingSessions')
  start(@CurrentUser() user: AuthUser, @Body() input: StartLiveDto) { return this.streams.startLive(user, input.deviceCode, input.channel); }

  @Get('sessions')
  @RequirePermission('streaming:view-live', 'streaming:live-wall')
  sessions(@CurrentUser() user: AuthUser) { return this.streams.mySessions(user); }

  @Post(':token/stop')
  @HttpCode(200)
  @RequirePermission('streaming:view-live', 'streaming:live-wall')
  @Audit('STOP_LIVE_STREAM', 'StreamingSessions')
  stop(@CurrentUser() user: AuthUser, @Param('token') token: string) { return this.streams.stop(user, token); }

  // Media elements cannot attach bearer headers. The opaque session ticket is itself the credential;
  // the service also checks its owner's current account, permission, device policy and idle deadline.
  @Get([':token/playlist.m3u8', ':token/segment'])
  @Public()
  async media(@Param('token') token: string, @Query('s') sealed: string, @Headers('range') range: string | undefined, @Res() response: Response) {
    const media = await this.streams.media(token, sealed, range);
    response.status(media.status).set({ 'Content-Type': media.contentType, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (media.contentRange) response.set('Content-Range', media.contentRange);
    response.send(media.body);
  }
}
