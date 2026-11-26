import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DeviceSyncService } from './device-sync.service';

export const DEVICE_SYNC_INTERVAL_MS = 3_600_000;

/** Worker `tracking` role only: DeviceSync at start, then hourly after the previous run ends. */
@Injectable()
export class DeviceSyncJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeviceSyncJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: DeviceSyncService) {}

  onApplicationBootstrap(): void {
    void this.loop();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop(): Promise<void> {
    try {
      await this.sync.syncOnce();
    } catch (error) {
      this.logger.error(`DeviceSync failed (will retry next round): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), DEVICE_SYNC_INTERVAL_MS);
    this.timer.unref();
  }
}
