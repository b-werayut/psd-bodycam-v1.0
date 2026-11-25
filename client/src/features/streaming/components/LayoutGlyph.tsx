import { gridShapeFor } from '../liveWall';

/** ไอคอนรูปตารางของปุ่มแบ่งจอ — วาดจากรูปทรงจริง (gridShapeFor) จึงตรงกับตารางที่จะได้เสมอ */
export function LayoutGlyph({ count }: { count: number }) {
  const { columns, rows } = gridShapeFor(count);
  return (
    <span
      aria-hidden="true"
      className="grid size-4 gap-px"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: columns * rows }, (_, cell) => (
        <span key={cell} className="rounded-[1px] bg-current" />
      ))}
    </span>
  );
}
