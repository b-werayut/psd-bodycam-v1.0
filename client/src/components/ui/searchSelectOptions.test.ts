import { describe, expect, it } from 'vitest';

import { anchorFor, filterSearchOptions, nextEnabledIndex } from './searchSelectOptions';

const OPTIONS = [
  { value: 'BC-001', label: 'กล้องติดตัว 1 (BC-001)' },
  { value: 'BC-002', label: 'กล้องติดตัว 2 (BC-002) — ปิดการดูภาพไว้', disabled: true },
  { value: 'DC-010', label: 'กล้องติดรถ 10 (DC-010)' },
];

describe('filterSearchOptions', () => {
  it('คำค้นว่างคืนทุกตัวเลือกตามลำดับเดิม', () => {
    expect(filterSearchOptions(OPTIONS, '   ')).toEqual(OPTIONS);
  });

  it('ค้นด้วยรหัสที่อยู่กลางป้ายก็เจอ', () => {
    expect(filterSearchOptions(OPTIONS, 'dc-0').map((o) => o.value)).toEqual(['DC-010']);
  });

  it('ค้นด้วยชื่อไทยและไม่สนตัวพิมพ์เล็กใหญ่', () => {
    expect(filterSearchOptions(OPTIONS, 'ติดรถ').map((o) => o.value)).toEqual(['DC-010']);
    expect(filterSearchOptions(OPTIONS, 'bc-002').map((o) => o.value)).toEqual(['BC-002']);
  });

  it('ไม่เจอคืนอาร์เรย์ว่าง ไม่ใช่ทุกตัว', () => {
    expect(filterSearchOptions(OPTIONS, 'ไม่มีจริง')).toEqual([]);
  });
});

describe('nextEnabledIndex', () => {
  it('ข้ามตัวเลือกที่กดไม่ได้', () => {
    expect(nextEnabledIndex(OPTIONS, 0, 1)).toBe(2);
    expect(nextEnabledIndex(OPTIONS, 2, -1)).toBe(0);
  });

  it('เริ่มจากยังไม่เลือกอะไรได้ตัวแรกที่กดได้', () => {
    expect(nextEnabledIndex(OPTIONS, -1, 1)).toBe(0);
  });

  it('วนกลับต้น/ท้ายรายการ', () => {
    expect(nextEnabledIndex(OPTIONS, 2, 1)).toBe(0);
    expect(nextEnabledIndex(OPTIONS, 0, -1)).toBe(2);
  });

  it('คืน -1 เมื่อไม่มีตัวไหนเลือกได้', () => {
    const allDisabled = OPTIONS.map((option) => ({ ...option, disabled: true }));
    expect(nextEnabledIndex(allDisabled, -1, 1)).toBe(-1);
    expect(nextEnabledIndex([], -1, 1)).toBe(-1);
  });
});

describe('anchorFor', () => {
  const rect = (top: number, height = 42, left = 24, width = 320) =>
    ({ top, bottom: top + height, left, width }) as DOMRect;

  it('พื้นที่ด้านล่างพอ = กางลง ยึดขอบล่างของช่อง', () => {
    const anchor = anchorFor(rect(100), 800);

    expect(anchor.placement).toBe('down');
    expect(anchor.top).toBe(142);
    expect(anchor.left).toBe(24);
    expect(anchor.width).toBe(320);
    expect(anchor.maxHeight).toBe(256);
  });

  it('ด้านล่างไม่พอและด้านบนกว้างกว่า = พลิกขึ้น ยึดขอบบนของช่อง', () => {
    const anchor = anchorFor(rect(700), 800);

    expect(anchor.placement).toBe('up');
    expect(anchor.top).toBe(700);
    expect(anchor.maxHeight).toBeGreaterThan(256 - 1);
  });

  it('จอเตี้ยจนทั้งสองด้านไม่พอ = ยังคืนความสูงใช้งานได้ขั้นต่ำ', () => {
    const anchor = anchorFor(rect(60, 42), 140);

    expect(anchor.maxHeight).toBe(128);
  });

  it('ด้านบนแคบกว่าด้านล่าง = คงกางลง', () => {
    const anchor = anchorFor(rect(20, 42), 200);

    expect(anchor.placement).toBe('down');
  });
});
