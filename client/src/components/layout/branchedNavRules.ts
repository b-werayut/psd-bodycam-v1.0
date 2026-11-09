import { NAV_GROUPS, type NavGroupId } from '@/app/nav';

/**
 * ส่วนที่ไม่ต้อง render ของเมนูหลักแบบ branched menu (อ้างอิง React Bits "Branched Menu")
 * — เรขาคณิตของเส้นกิ่ง + สถานะพับกลุ่มที่จำไว้ในเบราว์เซอร์
 */

/** ระยะบน/ล่างของต้นไม้ในแต่ละกลุ่ม (px) */
export const TREE_PAD = 6;
/** แกนลำต้นอยู่ที่ x นี้ในกล่องเส้น (px) */
export const TRUNK_X = 14;
/** แถวเมนูเริ่มที่ x นี้ — กิ่งจบก่อนถึงเล็กน้อย (px) */
export const BRANCH_INDENT = 40;
const BRANCH_GAP = 10;
const BRANCH_RADIUS = 10;

export type BranchGeometry = {
  height: number;
  /** เส้นลำต้นจากบนสุดถึงจุดเริ่มโค้งของกิ่งสุดท้าย */
  trunk: string;
  /** กิ่งเทาของแต่ละแถว */
  branches: string[];
  /** เส้นเน้นจากบนสุดลากมาถึงแต่ละแถว — วาดทับด้วย stroke-dashoffset */
  reaches: string[];
  /** ความยาวของ reach แต่ละเส้น ใช้เป็น stroke-dasharray */
  lengths: number[];
};

/** เส้นของกลุ่มที่มี `count` แถว สูงแถวละ `rowHeight` px (port จาก React Bits) */
export function branchGeometry(count: number, rowHeight: number): BranchGeometry {
  const r = Math.max(0, Math.min(BRANCH_RADIUS, rowHeight / 2 - 2));
  const endX = BRANCH_INDENT - BRANCH_GAP;
  const rowY = (k: number) => TREE_PAD + k * rowHeight + rowHeight / 2;
  const curve = (k: number) => `A ${r} ${r} 0 0 0 ${TRUNK_X + r} ${rowY(k)} H ${endX}`;
  const rows = Array.from({ length: count }, (_, k) => k);

  return {
    height: TREE_PAD * 2 + count * rowHeight,
    trunk: count > 0 ? `M ${TRUNK_X} 0 V ${rowY(count - 1) - r}` : '',
    branches: rows.map((k) => `M ${TRUNK_X} ${rowY(k) - r} ${curve(k)}`),
    reaches: rows.map((k) => `M ${TRUNK_X} 0 V ${rowY(k) - r} ${curve(k)}`),
    lengths: rows.map((k) => rowY(k) - r + (Math.PI * r) / 2 + (endX - TRUNK_X - r)),
  };
}

export const FOLDED_GROUPS_STORAGE_KEY = 'bodycam.nav.folded';

const KNOWN_GROUPS = new Set<string>(NAV_GROUPS.map((group) => group.id));

/** กลุ่มที่ผู้ใช้พับไว้ — อ่านไม่ได้/ค่าเสีย = ไม่มีกลุ่มไหนพับ (ตั้งต้นเปิดทุกกลุ่ม) */
export function readFoldedGroups(): Set<NavGroupId> {
  try {
    const raw = window.localStorage.getItem(FOLDED_GROUPS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((id): id is NavGroupId => typeof id === 'string' && KNOWN_GROUPS.has(id)),
    );
  } catch {
    return new Set();
  }
}

export function writeFoldedGroups(folded: ReadonlySet<NavGroupId>): void {
  try {
    window.localStorage.setItem(FOLDED_GROUPS_STORAGE_KEY, JSON.stringify([...folded]));
  } catch {
    // private mode / storage ถูกปิด — ไม่จำสถานะพับ แต่เมนูยังใช้ได้ปกติ
  }
}

export function toggleFolded(
  folded: ReadonlySet<NavGroupId>,
  id: NavGroupId,
): Set<NavGroupId> {
  const next = new Set(folded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
