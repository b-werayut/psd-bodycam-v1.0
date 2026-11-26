import { describe, expect, it } from 'vitest';

import {
  coveredSeconds,
  mergeSegments,
  parsePlaylist,
  pickVariant,
  playlistSettled,
  type HlsMediaPlaylist,
} from './hls-playlist';

const BASE = 'http://dss.local/body-camera/proxy/1000057/stream.m3u8?refresh=1';

const media = (body: string) => parsePlaylist(body, BASE) as HlsMediaPlaylist;

describe('parsePlaylist — media playlist', () => {
  it('อ่าน segment + ความยาว + resolve URI สัมพัทธ์จาก URL ของ playlist', () => {
    const playlist = media(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:10',
        '#EXTINF:4.000,',
        'seg-10.ts',
        '#EXTINF:3.5,',
        '/abs/seg-11.ts?token=x',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    );

    expect(playlist.kind).toBe('media');
    expect(playlist.segments).toEqual([
      {
        url: 'http://dss.local/body-camera/proxy/1000057/seg-10.ts',
        durationSeconds: 4,
        sequence: 10,
      },
      { url: 'http://dss.local/abs/seg-11.ts?token=x', durationSeconds: 3.5, sequence: 11 },
    ]);
    expect(playlist.targetDurationSeconds).toBe(4);
    expect(playlist.endList).toBe(true);
    expect(playlist.mapUrl).toBeNull();
    expect(playlist.unsupported).toBeNull();
  });

  it('รองรับ CRLF และ segment ที่เป็น URL เต็ม', () => {
    const playlist = media('#EXTM3U\r\n#EXTINF:2,\r\nhttp://other.local/a.ts\r\n');

    expect(playlist.segments[0].url).toBe('http://other.local/a.ts');
    expect(playlist.endList).toBe(false);
  });

  it('EXT-X-MAP = fMP4 ต้องส่ง init segment ก่อน', () => {
    const playlist = media('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg.m4s\n');

    expect(playlist.mapUrl).toBe('http://dss.local/body-camera/proxy/1000057/init.mp4');
    expect(playlist.unsupported).toBeNull();
  });

  it('**เข้ารหัส (AES-128) = แปลงไม่ได้ พร้อมเหตุผล** — METHOD=NONE ผ่าน', () => {
    const encrypted = media('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\na.ts');
    // the vendor's METHOD value stays out of the user text and goes to the English detail
    expect(encrypted.unsupported).toBe('playlist ถูกเข้ารหัส — ยังไม่รองรับการแปลง');
    expect(encrypted.unsupportedDetail).toContain('METHOD=AES-128');
    expect(media('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:2,\na.ts').unsupported).toBeNull();
  });

  it('byte-range / init หลายชุด = แปลงไม่ได้', () => {
    expect(media('#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:100@0\na.ts').unsupported).toMatch(
      /byte-range/,
    );
    expect(
      media('#EXT-X-MAP:URI="a.mp4"\n#EXTINF:2,\nx.m4s\n#EXT-X-MAP:URI="b.mp4"\n#EXTINF:2,\ny.m4s')
        .unsupported,
    ).toMatch(/EXT-X-MAP/);
  });

  it('ไม่มี MEDIA-SEQUENCE = เริ่มที่ 0', () => {
    expect(media('#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts').segments.map((s) => s.sequence)).toEqual([
      0, 1,
    ]);
  });
});

describe('parsePlaylist — master playlist', () => {
  it('อ่าน variant + bandwidth', () => {
    const playlist = parsePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
        'low/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.64001f,mp4a.40.2"',
        'high/index.m3u8',
      ].join('\n'),
      BASE,
    );

    expect(playlist).toEqual({
      kind: 'master',
      variants: [
        { url: 'http://dss.local/body-camera/proxy/1000057/low/index.m3u8', bandwidth: 800000 },
        { url: 'http://dss.local/body-camera/proxy/1000057/high/index.m3u8', bandwidth: 2500000 },
      ],
    });
  });

  it('pickVariant เอาคุณภาพสูงสุด (ภาพหลักฐาน) · ไม่มี bandwidth นับเป็น 0', () => {
    expect(
      pickVariant([
        { url: 'a', bandwidth: null },
        { url: 'b', bandwidth: 2_000_000 },
        { url: 'c', bandwidth: 1_000_000 },
      ])?.url,
    ).toBe('b');
    expect(pickVariant([{ url: 'a', bandwidth: null }])?.url).toBe('a');
    expect(pickVariant([])).toBeNull();
  });
});

describe('mergeSegments / coveredSeconds', () => {
  const seg = (sequence: number, durationSeconds = 2) => ({
    url: `s${sequence}.ts`,
    durationSeconds,
    sequence,
  });

  it('รอบโหลดซ้ำเพิ่มเฉพาะ segment ที่ใหม่กว่าตัวล่าสุด (sliding window ไม่ทำให้ซ้ำ)', () => {
    const merged = mergeSegments([seg(1), seg(2), seg(3)], [seg(2), seg(3), seg(4), seg(5)]);

    expect(merged.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(coveredSeconds(merged)).toBe(10);
  });

  it('รายการแรก (ยังว่าง) รับทั้งหมด', () => {
    expect(mergeSegments([], [seg(0), seg(1)])).toHaveLength(2);
  });
});

describe('playlistSettled', () => {
  const base = {
    endList: false,
    coveredSeconds: 0,
    requestedSeconds: 600,
    targetDurationSeconds: 4,
    idleMs: 0,
    idleLimitMs: 60_000,
  };

  it('มี ENDLIST = ครบแล้ว', () => {
    expect(playlistSettled({ ...base, endList: true })).toBe(true);
  });

  it('ครบช่วงที่ขอ (เผื่อหนึ่ง segment) = พอ', () => {
    expect(playlistSettled({ ...base, coveredSeconds: 596 })).toBe(true);
    expect(playlistSettled({ ...base, coveredSeconds: 590 })).toBe(false);
  });

  it('ไม่มี segment ใหม่นานเกิน idle = หยุด (ได้เท่าไรเอาเท่านั้น ไม่รอไม่รู้จบ)', () => {
    expect(playlistSettled({ ...base, coveredSeconds: 300, idleMs: 60_000 })).toBe(true);
    expect(playlistSettled({ ...base, coveredSeconds: 300, idleMs: 59_999 })).toBe(false);
  });
});
