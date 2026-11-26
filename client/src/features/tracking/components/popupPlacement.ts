type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Positions a standalone Leaflet popup with zero CSS margin. */
export function popupPlacement(anchor: Point, card: Size, viewport: Size) {
  const margin = 12;
  const naturalLeft = anchor.x - Math.round(card.width / 2);
  const left = Math.max(margin, Math.min(naturalLeft, viewport.width - card.width - margin));
  const offsetX = left - naturalLeft;
  if (anchor.y - 60 - card.height >= margin) {
    return { offsetX, offsetY: -60, side: 'above' as const };
  }
  if (anchor.y + 12 + card.height <= viewport.height - margin) {
    return { offsetX, offsetY: card.height + 12, side: 'below' as const };
  }
  const top = Math.max(margin, Math.min(anchor.y - 60 - card.height, viewport.height - card.height - margin));
  return { offsetX, offsetY: top + card.height - anchor.y, side: 'overlap' as const };
}
