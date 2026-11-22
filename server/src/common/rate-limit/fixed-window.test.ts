import { beforeEach, describe, expect, it } from 'vitest';

import { hitFixedWindow, type WindowState } from './fixed-window';

const WINDOW_MS = 60_000;
let state: WindowState;
let now: number;

beforeEach(() => {
  state = new Map();
  now = 1_000_000;
});

const hit = (key: string, limit: number) => hitFixedWindow(state, key, limit, WINDOW_MS, now);

describe('hitFixedWindow', () => {
  it('ยิงไม่เกินโควตา -> ผ่านทุกครั้ง และนับสะสมถูก', () => {
    for (let i = 1; i <= 3; i++) {
      const result = hit('ip-1', 3);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }
  });

  it('**เกินโควตา -> บล็อก และบอกเวลาที่ต้องรอ**', () => {
    for (let i = 0; i < 3; i++) hit('ip-1', 3);

    const blocked = hit('ip-1', 3);

    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('คนละ key นับแยกกัน (IP หนึ่งยิงเกินต้องไม่กระทบ IP อื่น)', () => {
    for (let i = 0; i < 5; i++) hit('ip-1', 3);

    expect(hit('ip-2', 3)).toMatchObject({ allowed: true, count: 1 });
  });

  it('ข้ามหน้าต่างเวลาแล้วเริ่มนับใหม่', () => {
    for (let i = 0; i < 4; i++) hit('ip-1', 3);
    expect(hit('ip-1', 3).allowed).toBe(false);

    now += WINDOW_MS + 1;

    expect(hit('ip-1', 3)).toMatchObject({ allowed: true, count: 1 });
  });

  it('เวลาที่ต้องรอลดลงตามเวลาที่ผ่านไปในหน้าต่างเดิม', () => {
    hit('ip-1', 1);
    now += 30_000;

    expect(hit('ip-1', 1)).toMatchObject({ allowed: false, retryAfterSeconds: 30 });
  });

  it('**ไม่คืน retryAfterSeconds = 0** (client จะยิงซ้ำทันที)', () => {
    hit('ip-1', 1);
    now += WINDOW_MS - 100;

    expect(hit('ip-1', 1).retryAfterSeconds).toBe(1);
  });

  it('เก็บกวาด key ที่หมดอายุเมื่อ map โตเกินเพดาน', () => {
    for (let i = 0; i < 1200; i++) hitFixedWindow(state, `old-${i}`, 5, WINDOW_MS, now);
    expect(state.size).toBe(1200);

    now += WINDOW_MS + 1;
    hitFixedWindow(state, 'fresh', 5, WINDOW_MS, now);

    expect(state.size).toBe(1);
  });
});
