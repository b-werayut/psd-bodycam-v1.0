import { describe, expect, it } from 'vitest';

import { popupPlacement } from './popupPlacement';

describe('popup placement without moving the map', () => {
  it.each([
    { x: 710, y: 100 },
    { x: 15, y: 500 },
    { x: 360, y: 350 },
  ])('keeps the complete card inside the viewport for the pin at $x,$y', (anchor) => {
    const card = { width: 257, height: 267 };
    const viewport = { width: 728, height: 664 };
    const placement = popupPlacement(anchor, card, viewport);
    const left = anchor.x - Math.round(card.width / 2) + placement.offsetX;
    const top = anchor.y + placement.offsetY - card.height;
    expect(left).toBeGreaterThanOrEqual(12);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(left + card.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(top + card.height).toBeLessThanOrEqual(viewport.height - 12);
  });

  it('keeps the card readable in a short viewport where it cannot fit above or below the pin', () => {
    const placement = popupPlacement({ x: 195, y: 190 }, { width: 257, height: 267 }, { width: 390, height: 400 });
    expect(placement.side).toBe('overlap');
    expect(190 + placement.offsetY - 267).toBeGreaterThanOrEqual(12);
    expect(190 + placement.offsetY).toBeLessThanOrEqual(388);
  });
});
