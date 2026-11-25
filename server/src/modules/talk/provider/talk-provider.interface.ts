export const TALK_PROVIDER = Symbol('TALK_PROVIDER');

export interface TalkAudioChannel {
  send(frame: Buffer): void;
  close(code: number, reason: string): void;
  onMessage(listener: (frame: Buffer) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
}

export interface TalkProvider {
  start(input: { vendorDeviceId: string; maxSeconds: number }): Promise<{
    talkId: string;
    uplinkSampleRate: number;
    downlinkSampleRate: number;
    frameMs: number;
  }>;
  stop(talkId: string): Promise<void>; // เรียกซ้ำได้
  openAudio(talkId: string): Promise<TalkAudioChannel>;
}

export type TalkStartInput = Parameters<TalkProvider['start']>[0];
export type TalkStartResult = Awaited<ReturnType<TalkProvider['start']>>;

/**
 * ความล้มเหลวที่ provider แปลเป็นข้อความผู้ใช้แล้ว (ตาราง "Error handling" ใน spec)
 * `message` = รายละเอียดเทคนิคสำหรับ log และ TalkSessions.ErrorMessage · `userMessage` = ข้อความที่ตอบ browser
 * · `vendorCode` = code ของ FastAPI (1004 = อุปกรณ์มีสายค้าง → 409)
 */
export class TalkProviderError extends Error {
  constructor(
    readonly userMessage: string,
    readonly vendorCode: number | null = null,
    detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = 'TalkProviderError';
  }
}
