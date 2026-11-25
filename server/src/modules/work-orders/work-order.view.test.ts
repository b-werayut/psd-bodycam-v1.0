import { describe, expect, it } from 'vitest';
import { workWindowOf } from './work-order.view';

const at = (iso: string) => new Date(iso);

describe('workWindowOf', () => {
  it('workWindow: no check-in ⇒ null; open ⇒ to null; closed ⇒ checkOutAt; cancelled ⇒ closedAt', () => {
    expect(workWindowOf(null, null, null)).toBeNull();
    expect(workWindowOf(null, at('2026-11-03T05:00:00Z'), at('2026-11-03T06:00:00Z'))).toBeNull();
    expect(workWindowOf(at('2026-11-03T01:00:00Z'), null, null)).toEqual({ from: '2026-11-03T01:00:00.000Z', to: null });
    expect(workWindowOf(at('2026-11-03T01:00:00Z'), at('2026-11-03T05:00:00Z'), at('2026-11-03T05:00:01Z'))).toEqual({
      from: '2026-11-03T01:00:00.000Z',
      to: '2026-11-03T05:00:00.000Z',
    });
    expect(workWindowOf(at('2026-11-03T01:00:00Z'), null, at('2026-11-03T07:00:00Z'))).toEqual({
      from: '2026-11-03T01:00:00.000Z',
      to: '2026-11-03T07:00:00.000Z',
    });
  });
});
