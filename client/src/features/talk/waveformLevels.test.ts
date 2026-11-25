import { describe, expect, it } from 'vitest';

import {
  barScale,
  pushHistory,
  stepEnvelope,
  WAVE_FLOOR,
  WAVE_HISTORY_MAX,
  waveLevel,
} from './waveformLevels';

describe('waveLevel', () => {
  it('เงียบ / ค่าเสีย → 0', () => {
    expect(waveLevel(0)).toBe(0);
    expect(waveLevel(-0.2)).toBe(0);
    expect(waveLevel(Number.NaN)).toBe(0);
  });

  it('เสียงพูดเบา ๆ (peak 0.09) ยังเห็นแท่งขยับชัด — ไม่ใช้ peak ตรง ๆ', () => {
    expect(waveLevel(0.09)).toBeGreaterThan(0.3);
  });

  it('ไม่เกิน 1', () => {
    expect(waveLevel(1)).toBe(1);
    expect(waveLevel(0.9)).toBe(1);
  });
});

describe('stepEnvelope', () => {
  it('ขึ้นเร็วกว่าลง (attack < release)', () => {
    const rise = stepEnvelope(0, 1, 16);
    const fall = 1 - stepEnvelope(1, 0, 16);
    expect(rise).toBeGreaterThan(fall);
  });

  it('dt ยาวผิดปกติ (แท็บถูกพัก) ถูกจำกัดไว้ ไม่กระโดดถึงเป้าทันที', () => {
    expect(stepEnvelope(0, 1, 5_000)).toBeLessThan(1);
  });

  it('dt ติดลบ → ค่าเดิม', () => {
    expect(stepEnvelope(0.4, 1, -10)).toBe(0.4);
  });
});

describe('barScale', () => {
  it('เงียบ = พื้นขั้นต่ำ ไม่ใช่ 0 (แท่งหายไปดูเหมือนสายหลุด)', () => {
    expect(barScale(0)).toBe(WAVE_FLOOR);
  });

  it('ดังสุด = 1 และตัดค่าที่เกินช่วง', () => {
    expect(barScale(1)).toBe(1);
    expect(barScale(3)).toBe(1);
    expect(barScale(-1)).toBe(WAVE_FLOOR);
  });
});

describe('pushHistory', () => {
  it('ต่อท้ายโดยไม่แก้ array เดิม', () => {
    const first = pushHistory([], 0.5);
    const second = pushHistory(first, 0.7);
    expect(first).toEqual([0.5]);
    expect(second).toEqual([0.5, 0.7]);
  });

  it('ยาวไม่เกิน WAVE_HISTORY_MAX — ตัวเก่าสุดหลุดออก', () => {
    let history: number[] = [];
    for (let i = 0; i < WAVE_HISTORY_MAX + 5; i += 1) history = pushHistory(history, i);
    expect(history).toHaveLength(WAVE_HISTORY_MAX);
    expect(history[0]).toBe(5);
    expect(history[history.length - 1]).toBe(WAVE_HISTORY_MAX + 4);
  });
});
