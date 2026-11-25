import { describe, expect, it } from 'vitest';

import { DownlinkPlayer } from './downlink';
import { encodePcm16le } from './pcm';

/** frame ขาลง 40ms ที่ 8 kHz = 320 sample = 640 byte (ขนาด frame ของกล้องจากผล spike) */
const frame40 = (value: number) => encodePcm16le(new Float32Array(320).fill(value));

function render(player: DownlinkPlayer, size = 128): Float32Array {
  const target = new Float32Array(size);
  player.render(target);
  return target;
}

const silent = (samples: Float32Array) => samples.every((value) => value === 0);

describe('DownlinkPlayer', () => {
  it('**เงียบจนสะสมครบ 80ms ของเสียงที่ได้รับ** (frame 40ms สองก้อน) แล้วจึงเล่น', () => {
    const player = new DownlinkPlayer(8000, 48000);
    player.push(frame40(0.25));
    expect(silent(render(player))).toBe(true);

    player.push(frame40(0.25));
    expect(render(player)[127]).toBeCloseTo(0.25, 3);
    expect(Array.from(render(player)).every((value) => Math.abs(value - 0.25) < 1e-3)).toBe(true);
  });

  it('ดึงทีละ quantum ได้ค่าต่อเนื่องเท่ากับการแปลง rate ทั้งสายรวดเดียว', () => {
    const player = new DownlinkPlayer(8000, 48000);
    const ramp = Float32Array.from({ length: 960 }, (_, i) => (i * 10) / 32767);
    player.push(encodePcm16le(ramp.subarray(0, 320)));
    player.push(encodePcm16le(ramp.subarray(320, 640)));
    player.push(encodePcm16le(ramp.subarray(640, 960)));

    const output: number[] = [];
    for (let i = 0; i < 6; i += 1) output.push(...render(player));

    expect(output).toHaveLength(768);
    output.forEach((value, k) => expect(value).toBeCloseTo((10 * (k / 6)) / 32767, 5));
  });

  it('**ข้อมูลขาด -> เงียบ แล้วรอสะสมครบ 80ms ใหม่** ไม่เล่นเศษทีละนิด', () => {
    const player = new DownlinkPlayer(8000, 48000);
    player.push(frame40(0.25));
    player.push(frame40(0.25));
    // 80ms ขาเข้า = 3840 sample ที่ 48k = 30 quantum — ดึงเกินไป 10 quantum ให้ขาดแน่นอน
    for (let i = 0; i < 40; i += 1) render(player);
    expect(silent(render(player))).toBe(true);

    player.push(frame40(0.5));
    expect(silent(render(player))).toBe(true);

    player.push(frame40(0.5));
    render(player);
    expect(Array.from(render(player)).every((value) => Math.abs(value - 0.5) < 1e-3)).toBe(true);
  });

  it('เติม target ให้เต็มพอดีทุกขนาด', () => {
    const player = new DownlinkPlayer(8000, 44100);
    for (let i = 0; i < 3; i += 1) player.push(frame40(0.1));

    for (const size of [128, 100, 1, 256]) {
      const target = render(player, size);
      expect(target).toHaveLength(size);
      expect(target[size - 1]).toBeCloseTo(0.1, 3);
    }
  });
});
