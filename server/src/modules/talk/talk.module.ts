import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TalkProviderModule } from './provider/talk-provider.module';
import { TALK_REVALIDATE_MS } from './talk-constants';
import { TALK_RELAY_OPTIONS, TalkRelay, type TalkRelayOptions } from './talk-relay';
import { TalkController } from './talk.controller';
import { TalkService } from './talk.service';

@Module({
  imports: [AuthModule, TalkProviderModule],
  controllers: [TalkController],
  providers: [
    TalkService,
    TalkRelay,
    // A plain object so tests can lower revalidateMs through app.get(TALK_RELAY_OPTIONS).
    { provide: TALK_RELAY_OPTIONS, useValue: { revalidateMs: TALK_REVALIDATE_MS } satisfies TalkRelayOptions },
  ],
  exports: [TalkService],
})
export class TalkModule {}
