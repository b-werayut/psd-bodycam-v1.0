import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  MOCK_TALK_ECHO_DELAY_MS,
  TALK_CLOSE_CODE,
  TALK_MESSAGE,
  closeReasonFor,
} from '../talk-constants';
import {
  TalkProviderError,
  type TalkAudioChannel,
  type TalkProvider,
  type TalkStartInput,
  type TalkStartResult,
} from './talk-provider.interface';

/** channel ในหน่วยความจำ — ส่ง frame ขาขึ้นกลับเป็นขาลงหลัง 300 ms · ปิดเองเมื่อครบ maxSeconds (4001) เหมือน FastAPI */
export class MockTalkAudioChannel implements TalkAudioChannel {
  private readonly messageListeners: Array<(frame: Buffer) => void> = [];
  private readonly closeListeners: Array<(code: number, reason: string) => void> = [];
  private readonly echoes = new Set<NodeJS.Timeout>();
  private readonly maxTimer: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly echoDelayMs: number,
    maxDurationMs: number,
    private readonly onFinished: () => void,
  ) {
    this.maxTimer = setTimeout(
      () => this.close(TALK_CLOSE_CODE.MAX_DURATION, closeReasonFor(TALK_CLOSE_CODE.MAX_DURATION)),
      maxDurationMs,
    );
    this.maxTimer.unref();
  }

  send(frame: Buffer): void {
    if (this.closed) return;
    const copy = Buffer.from(frame);
    const timer = setTimeout(() => {
      this.echoes.delete(timer);
      if (this.closed) return;
      for (const listener of this.messageListeners) listener(copy);
    }, this.echoDelayMs);
    this.echoes.add(timer);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.maxTimer);
    for (const timer of this.echoes) clearTimeout(timer);
    this.echoes.clear();
    this.onFinished();
    // แจ้ง onClose แบบ async เหมือน WebSocket จริง (event close มาทีหลังคำสั่ง close เสมอ)
    setImmediate(() => {
      for (const listener of this.closeListeners) listener(code, reason);
    });
  }

  onMessage(listener: (frame: Buffer) => void): void {
    this.messageListeners.push(listener);
  }

  onClose(listener: (code: number, reason: string) => void): void {
    this.closeListeners.push(listener);
  }
}

type MockTalk = { maxSeconds: number; channel: MockTalkAudioChannel | null };

/** ใช้เมื่อ DSS_DRIVER=mock (echo สำหรับเทสอัตโนมัติเท่านั้น) — ไม่ยิงออกเน็ต */
export class MockTalkProvider implements TalkProvider {
  private readonly logger = new Logger(MockTalkProvider.name);
  private readonly talks = new Map<string, MockTalk>();

  start(input: TalkStartInput): Promise<TalkStartResult> {
    const talkId = randomBytes(16).toString('hex');
    this.talks.set(talkId, { maxSeconds: input.maxSeconds, channel: null });
    this.logger.debug(`mock talk: ${input.vendorDeviceId} -> ${talkId.slice(0, 8)}`);
    // รูปแบบเดียวกับที่ FastAPI ตอบจริงหลัง spike: 8 kHz · frame 40 ms (ขาขึ้น 640 byte)
    return Promise.resolve({ talkId, uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40 });
  }

  stop(talkId: string): Promise<void> {
    const talk = this.talks.get(talkId);
    this.talks.delete(talkId);
    // FastAPI ปิด WS ของสายที่ถูกสั่ง stop ด้วย 4004 — mock ทำเหมือนกัน
    talk?.channel?.close(TALK_CLOSE_CODE.STOPPED, closeReasonFor(TALK_CLOSE_CODE.STOPPED));
    return Promise.resolve();
  }

  openAudio(talkId: string): Promise<TalkAudioChannel> {
    const talk = this.talks.get(talkId);
    if (!talk) {
      return Promise.reject(
        new TalkProviderError(TALK_MESSAGE.SYSTEM_ERROR, null, `mock: call ${talkId.slice(0, 8)} not found`),
      );
    }
    if (talk.channel) {
      return Promise.reject(
        new TalkProviderError(
          TALK_MESSAGE.SYSTEM_ERROR,
          null,
          `mock: call ${talkId} already has a WS attached (one per call)`,
        ),
      );
    }
    const channel = new MockTalkAudioChannel(MOCK_TALK_ECHO_DELAY_MS, talk.maxSeconds * 1000, () => {
      this.talks.delete(talkId);
    });
    talk.channel = channel;
    return Promise.resolve(channel);
  }
}
