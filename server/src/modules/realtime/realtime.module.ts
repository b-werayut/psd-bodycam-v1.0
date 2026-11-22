import { Global, Module } from '@nestjs/common';
import { RealtimeEmitterService } from '../../common/realtime-bus/realtime-emitter.service';
import { RealtimeGateway } from './realtime.gateway';

/** Gateway (api: Socket.IO server; worker: pushes through the Redis emitter). Emit only after commit. */
@Global()
@Module({
  providers: [RealtimeEmitterService, RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
