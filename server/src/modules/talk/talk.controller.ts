import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { LoginOnly } from '../../common/auth/login-only.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { StartTalkDto } from './dto/start-talk.dto';
import { TalkService } from './talk.service';

@Controller('talk')
export class TalkController {
  constructor(private readonly talk: TalkService) {}

  @Post('sessions')
  @HttpCode(200)
  @RequirePermission('streaming:talk')
  @Audit('START_TALK', 'TalkSessions')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartTalkDto) {
    return this.talk.start(user, dto.streamSessionToken);
  }

  /** LoginOnly โดยเจตนา — ผู้ใช้ต้องวางสายได้เสมอแม้สิทธิ์ถูกถอดไปแล้ว (ตรวจแค่เจ้าของสาย) */
  @Post('sessions/:id/stop')
  @HttpCode(200)
  @LoginOnly()
  @Audit('STOP_TALK', 'TalkSessions')
  stop(@CurrentUser() user: AuthUser, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.talk.stop(user, id);
  }
}
