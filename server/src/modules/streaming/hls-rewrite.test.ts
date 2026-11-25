import { describe, expect, it } from 'vitest';

import { looksLikePlaylist, rewritePlaylist } from './hls-rewrite';

const BASE = 'https://vendor.example.com/live/cam1/index.m3u8';
const proxy = (url: string) => `/api/streams/tok/segment?s=${encodeURIComponent(url)}`;
const rewrite = (body: string) => rewritePlaylist(body, { baseUrl: BASE, toProxyUrl: proxy });

describe('rewritePlaylist — URI ที่เป็นบรรทัด', () => {
  it('segment แบบสัมพัทธ์ถูก resolve กับ base แล้วชี้มาที่ proxy', () => {
    const out = rewrite('#EXTM3U\n#EXTINF:4,\nseg1.ts\n');

    expect(out).toContain(proxy('https://vendor.example.com/live/cam1/seg1.ts'));
    expect(out).not.toContain('vendor.example.com/live/cam1/seg1.ts\n');
  });

  it('segment แบบ absolute ของ vendor ก็ถูกแทนที่ (ห้ามหลุดออกไปที่ browser)', () => {
    const out = rewrite('#EXTM3U\n#EXTINF:4,\nhttps://cdn.vendor.example.com/a/seg9.ts\n');

    expect(out).toContain(proxy('https://cdn.vendor.example.com/a/seg9.ts'));
    expect(out).not.toMatch(/^https:\/\/cdn\.vendor/m);
  });

  it('พาธขึ้นต้นด้วย / resolve จาก origin ของ base', () => {
    const out = rewrite('#EXTM3U\n/abs/seg.ts\n');

    expect(out).toContain(proxy('https://vendor.example.com/abs/seg.ts'));
  });

  it('master playlist: variant .m3u8 ก็ต้องวิ่งผ่าน proxy ต่อ', () => {
    const out = rewrite('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n');

    expect(out).toContain(proxy('https://vendor.example.com/live/cam1/low/index.m3u8'));
  });

  it('คงบรรทัดว่างและแท็กที่ไม่มี URI ไว้เหมือนเดิม', () => {
    const body = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n\n#EXTINF:4,\nseg.ts\n';
    const out = rewrite(body);

    expect(out).toContain('#EXT-X-VERSION:3');
    expect(out).toContain('#EXT-X-TARGETDURATION:4');
    expect(out.split('\n').filter((l) => l === '').length).toBeGreaterThan(0);
  });
});

describe('rewritePlaylist — attribute URI="..."', () => {
  it('#EXT-X-KEY (คีย์ถอดรหัส) ต้องถูกแทนที่ ไม่งั้นสตรีมที่เข้ารหัสเล่นไม่ได้', () => {
    const out = rewrite(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0\n#EXTINF:4,\nseg.ts\n',
    );

    expect(out).toContain(`URI="${proxy('https://vendor.example.com/live/cam1/key.bin')}"`);
    expect(out).toContain('METHOD=AES-128');
    expect(out).toContain('IV=0x0');
  });

  it('#EXT-X-MAP (init segment) ถูกแทนที่', () => {
    const out = rewrite('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n');

    expect(out).toContain(`URI="${proxy('https://vendor.example.com/live/cam1/init.mp4')}"`);
  });

  it('#EXT-X-MEDIA (เสียงแยก) ถูกแทนที่', () => {
    const out = rewrite('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/en.m3u8",NAME="en"\n');

    expect(out).toContain(`URI="${proxy('https://vendor.example.com/live/cam1/audio/en.m3u8')}"`);
    expect(out).toContain('NAME="en"');
  });

  it('URI ว่างไม่ทำให้พัง', () => {
    expect(() => rewrite('#EXTM3U\n#EXT-X-KEY:METHOD=NONE,URI=""\n')).not.toThrow();
  });

  it('ไม่มี URL ของ vendor หลงเหลือใน playlist ที่เขียนใหม่', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://vendor.example.com/k/1"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4,',
      'seg1.ts',
      '#EXTINF:4,',
      'https://cdn.vendor.example.com/seg2.ts',
    ].join('\n');

    const out = rewritePlaylist(body, { baseUrl: BASE, toProxyUrl: () => '/api/streams/tok/segment?s=SEALED' });

    expect(out).not.toContain('vendor.example.com');
  });
});

describe('looksLikePlaylist', () => {
  it('ดูจาก content-type ก่อน', () => {
    expect(looksLikePlaylist('application/vnd.apple.mpegurl', 'อะไรก็ได้')).toBe(true);
    expect(looksLikePlaylist('audio/mpegurl', '')).toBe(true);
  });

  it('vendor ที่ตั้ง content-type ผิด -> ดูจากบรรทัดแรกแทน', () => {
    expect(looksLikePlaylist('text/plain', '#EXTM3U\n#EXTINF:4,\nseg.ts')).toBe(true);
    expect(looksLikePlaylist(null, '  #EXTM3U\n')).toBe(true);
  });

  it('เนื้อหาที่ไม่ใช่ playlist (เช่นหน้า error ของ vendor) = false', () => {
    expect(looksLikePlaylist('text/html', '<html>error</html>')).toBe(false);
    expect(looksLikePlaylist(null, '')).toBe(false);
  });
});
