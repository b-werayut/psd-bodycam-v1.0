import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExportFailure } from './evidence-export-failure';

import { LiveStreamProvider } from '../streaming/live-stream.provider';

import {
  collectSegments,
  ffmpegRemuxArgs,
  PLAYBACK_TAIL_PAD_SECONDS,
  playbackRequestEnd,
  remuxToMp4,
  segmentsCovering,
  type CollectedMedia,
  type MediaDeps,
} from './evidence-media';

type Script = Record<string, string | string[]>;

/** fetch ปลอม — playlist ที่ระบุเป็น array = คำตอบแต่ละรอบที่โหลดซ้ำ (รอบสุดท้ายตอบซ้ำไปเรื่อย ๆ) */
function fakeDeps(script: Script) {
  let clock = 0;
  const calls: string[] = [];
  const rounds = new Map<string, number>();
  const deps: MediaDeps = {
    fetchText(url) {
      calls.push(url);
      const entry = script[url];
      if (entry === undefined) return Promise.reject(new Error(`404 ${url}`));
      const list = Array.isArray(entry) ? entry : [entry];
      const round = rounds.get(url) ?? 0;
      rounds.set(url, round + 1);
      return Promise.resolve({
        body: list[Math.min(round, list.length - 1)],
        contentType: 'application/vnd.apple.mpegurl',
      });
    },
    fetchBytes: () => Promise.resolve(Buffer.alloc(0)),
    sleep(ms) {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    assertAllowed: (url) => new LiveStreamProvider().assertAllowed(url),
  };
  return { deps, calls };
}

const signal = new AbortController().signal;
const URL0 = 'http://dss.local/proxy/1000057/stream.m3u8';

beforeEach(() => {
  process.env.STREAM_ALLOWED_HOSTS = 'dss.local';
});

afterEach(() => {
  delete process.env.STREAM_ALLOWED_HOSTS;
});

describe('collectSegments', () => {
  it('playlist ครบ (ENDLIST) = ใช้ทันที ไม่โหลดซ้ำ · ไม่มี EXT-X-MAP = MPEG-TS', async () => {
    const { deps, calls } = fakeDeps({
      [URL0]: '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST',
    });

    const media = await collectSegments(URL0, 8, deps, signal);

    expect(media.segments).toHaveLength(2);
    expect(media.inputFormat).toBe('mpegts');
    expect(calls).toEqual([URL0]);
  });

  it('master playlist -> ตาม variant คุณภาพสูงสุด', async () => {
    const { deps, calls } = fakeDeps({
      [URL0]:
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh.m3u8',
      'http://dss.local/proxy/1000057/high.m3u8': '#EXTINF:2,\nh.ts\n#EXT-X-ENDLIST',
    });

    const media = await collectSegments(URL0, 2, deps, signal);

    expect(calls[1]).toBe('http://dss.local/proxy/1000057/high.m3u8');
    expect(media.segments[0].url).toBe('http://dss.local/proxy/1000057/h.ts');
  });

  it('ไม่มี ENDLIST = โหลดซ้ำจนครบช่วงที่ขอ (รวม segment ใหม่โดยไม่ซ้ำ)', async () => {
    const { deps, calls } = fakeDeps({
      [URL0]: [
        '#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4,\n0.ts',
        '#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4,\n0.ts\n#EXTINF:4,\n1.ts',
        '#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4,\n1.ts\n#EXTINF:4,\n2.ts',
      ],
    });

    const media = await collectSegments(URL0, 14, deps, signal);

    expect(media.segments.map((s) => s.sequence)).toEqual([0, 1, 2]);
    expect(calls).toHaveLength(3);
  });

  it('ไม่มี ENDLIST และไม่มี segment ใหม่นาน 60 วินาที = หยุดด้วยเท่าที่ได้ (ไม่วนไม่รู้จบ)', async () => {
    const { deps } = fakeDeps({ [URL0]: '#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n0.ts' });

    const media = await collectSegments(URL0, 600, deps, signal);

    expect(media.segments).toHaveLength(1);
  });

  it('**ทุก URL ผ่าน allowed host** — variant ที่ชี้ host อื่นถูกปฏิเสธ (กัน SSRF)', async () => {
    process.env.STREAM_ALLOWED_HOSTS = 'dss.local';
    const { deps } = fakeDeps({
      [URL0]: '#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://169.254.169.254/latest/meta-data.m3u8',
    });

    await expect(collectSegments(URL0, 2, deps, signal)).rejects.toThrow(/host is not allowed/);
  });

  it('playlist เข้ารหัส = ล้มพร้อมเหตุผล', async () => {
    const { deps } = fakeDeps({
      [URL0]: '#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST',
    });

    await expect(collectSegments(URL0, 2, deps, signal)).rejects.toThrow(/เข้ารหัส/);
  });

  it('ไม่ใช่ playlist / ว่างเปล่า = ล้มพร้อมเหตุผล', async () => {
    const notPlaylist = fakeDeps({});
    notPlaylist.deps.fetchText = () => Promise.resolve({ body: '<html>', contentType: 'text/html' });
    await expect(collectSegments(URL0, 2, notPlaylist.deps, signal)).rejects.toThrow(/ไม่ได้ส่ง playlist/);

    const empty = fakeDeps({ [URL0]: '#EXTM3U\n#EXT-X-ENDLIST' });
    await expect(collectSegments(URL0, 2, empty.deps, signal)).rejects.toThrow(/playlist ว่าง/);
  });

  it('มี EXT-X-MAP = fMP4 อ่านด้วย demuxer mov', async () => {
    const { deps } = fakeDeps({
      [URL0]: '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\na.m4s\n#EXT-X-ENDLIST',
    });

    const media = await collectSegments(URL0, 2, deps, signal);

    expect(media.inputFormat).toBe('mov');
    expect(media.mapUrl).toBe('http://dss.local/proxy/1000057/init.mp4');
  });
});

describe('ไม่แตะ segment สุดท้ายของ playback session', () => {
  const at = (iso: string) => new Date(`2026-10-21T${iso}+07:00`);
  const seg = (sequence: number, durationSeconds = 4) => ({
    url: `http://dss.local/proxy/1000027/s_${sequence}.ts`,
    durationSeconds,
    sequence,
  });

  it('ขอ DSS เกินท้ายช่วง PLAYBACK_TAIL_PAD_SECONDS (ยาวกว่า segment หนึ่งตัวของ DSS = 4 วินาที)', () => {
    expect(PLAYBACK_TAIL_PAD_SECONDS).toBeGreaterThan(4);
    expect(playbackRequestEnd(at('12:50:30'), at('15:00:00'))).toEqual(at('12:50:40'));
  });

  it('ไม่เลยเวลาปัจจุบัน — แต่ก็ไม่ถอยกลับก่อนท้ายช่วงที่ขอ', () => {
    expect(playbackRequestEnd(at('12:50:30'), at('12:50:34'))).toEqual(at('12:50:34'));
    expect(playbackRequestEnd(at('12:50:30'), at('12:50:00'))).toEqual(at('12:50:30'));
  });

  it('เลือก segment แค่ที่ครอบช่วงที่ขอ — ท่อนที่ DSS ส่งเกินมาไม่ดึง', () => {
    // 87 วินาที ขอเกินไป 10 = 97 วินาที → 24 ตัวเต็ม + ท่อนสั้น 1 วินาทีท้าย session
    const padded = [...Array.from({ length: 24 }, (_, i) => seg(i)), seg(24, 1)];

    const needed = segmentsCovering(padded, 87);

    expect(needed).toHaveLength(22);
    expect(needed.at(-1)?.sequence).toBe(21);
  });

  it('ได้ไม่ถึงช่วงที่ขอ = คืนทั้งหมด (MediaSeconds บอกตามจริงว่าขาด)', () => {
    expect(segmentsCovering([seg(0), seg(1)], 87)).toHaveLength(2);
    expect(segmentsCovering([seg(0), seg(1)], 8)).toHaveLength(2);
  });

  it('collectSegments คืนเฉพาะ segment ที่ครอบช่วงที่ขอ', async () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      ...Array.from({ length: 24 }, (_, i) => `#EXTINF:4,\ns_${i}.ts`),
      '#EXTINF:1,\ns_24.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const { deps } = fakeDeps({ [URL0]: body });

    const media = await collectSegments(URL0, 87, deps, signal);

    expect(media.segments).toHaveLength(22);
    expect(media.segments.map((s) => s.url)).not.toContain('http://dss.local/proxy/1000057/s_24.ts');
  });
});

describe('ข้อความเมื่อดึงจากแพลตฟอร์มกล้องไม่สำเร็จ', () => {
  const timedOut = () =>
    new DOMException('The operation was aborted due to timeout', 'TimeoutError');

  it('playlist ไม่ตอบทันเวลา = บอกว่าค้างที่ playlist และรอนานเท่าไร ไม่ใช่ TimeoutError อังกฤษดิบ', async () => {
    const { deps } = fakeDeps({});
    deps.fetchText = () => Promise.reject(timedOut());

    await expect(collectSegments(URL0, 2, deps, signal)).rejects.toThrow(
      /^ดึง playlist ไม่สำเร็จ: แพลตฟอร์มกล้องไม่ตอบภายใน \d+ วินาที$/,
    );
  });

  it('งานถูกยกเลิก / เกินเวลาทั้งงาน = ส่งเหตุของงานต่อตามเดิม ไม่ห่อเป็นเรื่อง playlist', async () => {
    const controller = new AbortController();
    const reason = new Error('แปลงไฟล์นานเกิน 180 นาที — ยกเลิก');
    controller.abort(reason);
    const { deps } = fakeDeps({});
    deps.fetchText = () => Promise.reject(reason);

    await expect(collectSegments(URL0, 2, deps, controller.signal)).rejects.toBe(reason);
  });

  it('segment ไม่ตอบทันเวลาครบ 3 ครั้ง = บอกเลข segment จากทั้งหมด', async () => {
    const { deps } = fakeDeps({});
    let attempts = 0;
    deps.fetchBytes = () => {
      attempts += 1;
      return Promise.reject(timedOut());
    };
    const media: CollectedMedia = {
      segments: [
        { url: 'http://dss.local/proxy/1000057/a.ts', durationSeconds: 4, sequence: 0 },
        { url: 'http://dss.local/proxy/1000057/b.ts', durationSeconds: 4, sequence: 1 },
      ],
      mapUrl: null,
      inputFormat: 'mpegts',
    };

    // ffmpeg แทนด้วย node — segment แรกล้มก่อนเขียนอะไรลง stdin จึงไม่ขึ้นกับว่า process ลูกทำอะไร
    await expect(
      remuxToMp4({
        media,
        outFile: join(tmpdir(), 'evidence-media-test.mp4'),
        ffmpegPath: process.execPath,
        deps,
        signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(
      /^ดึง segment 1\/2 ไม่สำเร็จ \(ลองครบ 3 ครั้ง\): แพลตฟอร์มกล้องไม่ตอบภายใน \d+ วินาที$/,
    );
    expect(attempts).toBe(3);
  });
});

describe('ffmpegRemuxArgs', () => {
  it('**ffmpeg อ่านได้แค่ stdin** (protocol_whitelist = pipe) — ไม่ต่อเน็ต ไม่อ่านไฟล์ในเครื่อง', () => {
    const args = ffmpegRemuxArgs('mpegts', '/tmp/out.mp4');

    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('pipe');
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0');
    expect(args[args.indexOf('-f') + 1]).toBe('mpegts');
  });

  it('ภาพ copy (ไม่ re-encode) · เสียงเป็น AAC · faststart · ไม่มีเสียงก็ไม่ล้ม', () => {
    const args = ffmpegRemuxArgs('mov', '/tmp/out.mp4').join(' ');

    expect(args).toContain('-c:v copy');
    expect(args).toContain('-c:a aac');
    expect(args).toContain('-movflags +faststart');
    expect(args).toContain('-map 0:a:0?');
    expect(args.endsWith('-y /tmp/out.mp4')).toBe(true);
  });
});

describe('user text vs log detail (ExportFailure)', () => {
  const media: CollectedMedia = {
    segments: [{ url: 'http://dss.local/proxy/1000057/a.ts', durationSeconds: 4, sequence: 0 }],
    mapUrl: null,
    inputFormat: 'mpegts',
  };
  const deps = (): MediaDeps => ({ ...fakeDeps({}).deps, fetchBytes: () => Promise.resolve(Buffer.from('x')) });

  it('ffmpeg exits non-zero: the message is short Thai, stderr and exit code are only in detail', async () => {
    // node stands in for ffmpeg: it rejects the ffmpeg flags with an English message on stderr
    const error = await remuxToMp4({
      media,
      outFile: join(tmpdir(), 'evidence-media-test-out.mp4'),
      ffmpegPath: process.execPath,
      deps: deps(),
      signal,
      onProgress: () => undefined,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExportFailure);
    const failure = error as ExportFailure;
    expect(failure.message).toBe('แปลงไฟล์ไม่สำเร็จ');
    expect(failure.detail).toMatch(/ffmpeg exit \d+/);
  });

  it('ffmpeg missing: the message names no path or setting, detail does', async () => {
    const missing = join(tmpdir(), 'no-such-ffmpeg-binary');
    const error = (await remuxToMp4({
      media,
      outFile: join(tmpdir(), 'evidence-media-test-out.mp4'),
      ffmpegPath: missing,
      deps: deps(),
      signal,
      onProgress: () => undefined,
    }).catch((e: unknown) => e)) as ExportFailure;

    expect(error).toBeInstanceOf(ExportFailure);
    expect(error.message).not.toContain(missing);
    expect(error.message).not.toContain('FFMPEG_PATH');
    expect(error.detail).toContain(missing);
  });

  it('a non-timeout vendor error: the raw text stays in detail', async () => {
    const { deps: d } = fakeDeps({});
    d.fetchText = () => Promise.reject(new Error('ECONNRESET http://dss.local/x?token=secret'));

    const error = (await collectSegments(URL0, 2, d, signal).catch((e: unknown) => e)) as ExportFailure;

    expect(error.message).not.toContain('ECONNRESET');
    expect(error.message).not.toContain('secret');
    expect(error.detail).toContain('ECONNRESET');
  });
});
