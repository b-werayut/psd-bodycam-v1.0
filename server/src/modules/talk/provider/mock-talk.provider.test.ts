import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockTalkProvider } from './mock-talk.provider';
import { TalkProviderError } from './talk-provider.interface';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe('MockTalkProvider', () => {
  it('start คืน talkId สุ่ม 32 hex + รูปแบบเสียงเดียวกับ FastAPI (8 kHz · frame 40 ms)', async () => {
    const provider = new MockTalkProvider();

    const a = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });
    const b = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });

    expect(a).toMatchObject({ uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40 });
    expect(a.talkId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.talkId).not.toBe(b.talkId);
  });

  it('openAudio สะท้อน frame ขาขึ้นกลับเป็นขาลงหลัง 300 ms (ทีม client ใช้ทดสอบโดยไม่มี DSS)', async () => {
    const provider = new MockTalkProvider();
    const { talkId } = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });
    const channel = await provider.openAudio(talkId);
    const received: Buffer[] = [];
    channel.onMessage((frame) => received.push(frame));

    const frame = Buffer.alloc(640, 3);
    channel.send(frame);
    await wait(150);
    expect(received).toHaveLength(0);
    await wait(300);
    expect(received).toHaveLength(1);
    expect(received[0].equals(frame)).toBe(true);

    channel.close(1000, 'hangup');
  });

  it('stop ปิด channel ที่ต่ออยู่ด้วย 4004 stopped เหมือน FastAPI และเรียกซ้ำได้', async () => {
    const provider = new MockTalkProvider();
    const { talkId } = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });
    const channel = await provider.openAudio(talkId);
    const closed: Array<[number, string]> = [];
    channel.onClose((code, reason) => closed.push([code, reason]));

    await provider.stop(talkId);
    await nextTurn();
    await provider.stop(talkId);

    expect(closed).toEqual([[4004, 'stopped']]);
  });

  it('ต่อ WS ได้ครั้งเดียวต่อสาย และสายที่ไม่รู้จักต่อไม่ได้', async () => {
    const provider = new MockTalkProvider();
    const { talkId } = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });
    const channel = await provider.openAudio(talkId);

    await expect(provider.openAudio(talkId)).rejects.toBeInstanceOf(TalkProviderError);
    await expect(provider.openAudio('0'.repeat(32))).rejects.toBeInstanceOf(TalkProviderError);

    channel.close(1000, 'hangup');
  });

  it('ครบ maxSeconds แล้วปิดเองด้วย 4001 max-duration', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const provider = new MockTalkProvider();
    const { talkId } = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 60 });
    const channel = await provider.openAudio(talkId);
    const closed: Array<[number, string]> = [];
    channel.onClose((code, reason) => closed.push([code, reason]));

    vi.advanceTimersByTime(59_999);
    await nextTurn();
    expect(closed).toEqual([]);

    vi.advanceTimersByTime(1);
    await nextTurn();
    expect(closed).toEqual([[4001, 'max-duration']]);
  });

  it('ปิดแล้ว frame ที่รอสะท้อนอยู่ไม่ถูกส่งต่อ', async () => {
    const provider = new MockTalkProvider();
    const { talkId } = await provider.start({ vendorDeviceId: 'VENDOR-1', maxSeconds: 600 });
    const channel = await provider.openAudio(talkId);
    const received: Buffer[] = [];
    channel.onMessage((frame) => received.push(frame));

    channel.send(Buffer.alloc(640, 1));
    channel.close(1000, 'hangup');
    await wait(400);

    expect(received).toHaveLength(0);
  });
});
