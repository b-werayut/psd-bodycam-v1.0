import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveStreamProvider } from './live-stream.provider';
import { StreamingController } from './streaming.controller';
import { StreamingService } from './streaming.service';

@Module({ imports: [AuthModule], controllers: [StreamingController], providers: [StreamingService, LiveStreamProvider] })
export class StreamingModule {}
