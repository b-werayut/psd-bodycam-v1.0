import { afterEach, describe, expect, it } from 'vitest';

import {
  branchGeometry,
  FOLDED_GROUPS_STORAGE_KEY,
  readFoldedGroups,
  toggleFolded,
  TREE_PAD,
  writeFoldedGroups,
} from './branchedNavRules';

describe('branchGeometry', () => {
  it('ความสูง = ระยะบนล่าง + จำนวนแถว × ความสูงแถว และมีกิ่ง/เส้นเน้นครบทุกแถว', () => {
    const geometry = branchGeometry(3, 40);

    expect(geometry.height).toBe(TREE_PAD * 2 + 3 * 40);
    expect(geometry.branches).toHaveLength(3);
    expect(geometry.reaches).toHaveLength(3);
    expect(geometry.lengths).toHaveLength(3);
  });

  it('เส้นเน้นของแถวล่างยาวกว่าแถวบน (ลากจากบนสุดลงมา)', () => {
    const { lengths } = branchGeometry(4, 40);

    for (let k = 1; k < lengths.length; k += 1) {
      expect(lengths[k]).toBeGreaterThan(lengths[k - 1]);
    }
    expect(lengths[1] - lengths[0]).toBeCloseTo(40);
  });

  it('ลำต้นจบที่จุดเริ่มโค้งของกิ่งสุดท้าย · กลุ่มว่างไม่มีเส้น', () => {
    expect(branchGeometry(2, 40).trunk).toBe('M 14 0 V 56');
    expect(branchGeometry(0, 40).trunk).toBe('');
  });
});

describe('สถานะพับกลุ่ม', () => {
  afterEach(() => window.localStorage.clear());

  it('ยังไม่เคยพับ = เปิดทุกกลุ่ม', () => {
    expect(readFoldedGroups().size).toBe(0);
  });

  it('จำกลุ่มที่พับไว้ และทิ้งค่าที่ไม่รู้จัก/ค่าเสีย', () => {
    writeFoldedGroups(new Set(['assets']));
    expect([...readFoldedGroups()]).toEqual(['assets']);

    window.localStorage.setItem(FOLDED_GROUPS_STORAGE_KEY, '["system","hacked",3]');
    expect([...readFoldedGroups()]).toEqual(['system']);

    window.localStorage.setItem(FOLDED_GROUPS_STORAGE_KEY, '{not json');
    expect(readFoldedGroups().size).toBe(0);
  });

  it('toggleFolded สลับโดยไม่แก้ set เดิม', () => {
    const empty = new Set<'system'>();
    const folded = toggleFolded(empty, 'system');

    expect(empty.size).toBe(0);
    expect(folded.has('system')).toBe(true);
    expect(toggleFolded(folded, 'system').has('system')).toBe(false);
  });
});
