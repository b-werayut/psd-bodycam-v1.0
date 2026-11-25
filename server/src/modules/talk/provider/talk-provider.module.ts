import { Logger, Module } from '@nestjs/common';
import { readDssConfig } from '../../../common/dss/dss-config';
import { DssTalkProvider } from './dss-talk.provider';
import { MockTalkProvider } from './mock-talk.provider';
import { TALK_PROVIDER, type TalkProvider } from './talk-provider.interface';

@Module({
  providers: [
    {
      provide: TALK_PROVIDER,
      // read at module init (not import time) so env set before boot is honoured
      useFactory: (): TalkProvider => {
        const config = readDssConfig(process.env);
        Logger.log(`talk provider = ${config.driver}`, 'TalkProviderModule');
        return config.driver === 'dss' ? new DssTalkProvider(config) : new MockTalkProvider();
      },
    },
  ],
  exports: [TALK_PROVIDER],
})
export class TalkProviderModule {}
