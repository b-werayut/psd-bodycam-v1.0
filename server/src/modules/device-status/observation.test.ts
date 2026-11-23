import { describe, expect, it } from 'vitest';
import { decideObservation, displayStateOf, PLATFORM_STATE, STATE_SOURCE } from './observation';

describe('decideObservation', () => {
  it('first observation is a change from null', () => {
    expect(decideObservation({ platformState: null }, 1)).toEqual({ changed: true, from: null, to: 1 });
  });

  it('same state is not a change', () => {
    expect(decideObservation({ platformState: 1 }, 1)).toEqual({ changed: false, from: 1, to: 1 });
    expect(decideObservation({ platformState: 2 }, 2)).toEqual({ changed: false, from: 2, to: 2 });
  });

  it('online ⇄ offline is a change', () => {
    expect(decideObservation({ platformState: 1 }, 2)).toEqual({ changed: true, from: 1, to: 2 });
    expect(decideObservation({ platformState: 2 }, 1)).toEqual({ changed: true, from: 2, to: 1 });
  });

  it('enum values (Part 4): states 1 Online · 2 Offline, sources 2 DssLocation · 5 Manual', () => {
    expect(PLATFORM_STATE).toEqual({ ONLINE: 1, OFFLINE: 2 });
    expect(STATE_SOURCE).toEqual({ DSS_LOCATION: 2, MANUAL: 5 });
  });
});

describe('displayStateOf', () => {
  const now = new Date('2026-11-23T03:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it('never observed ⇒ unknown', () => {
    expect(displayStateOf({ platformState: null, lastObservedAt: null }, now, 120)).toBe('unknown');
    expect(displayStateOf({ platformState: 1, lastObservedAt: null }, now, 120)).toBe('unknown');
  });

  it('observed within status.unknown-after-seconds ⇒ the stored state', () => {
    expect(displayStateOf({ platformState: 1, lastObservedAt: ago(10) }, now, 120)).toBe('online');
    expect(displayStateOf({ platformState: 2, lastObservedAt: ago(120) }, now, 120)).toBe('offline');
  });

  it('older than status.unknown-after-seconds ⇒ unknown (computed, never stored)', () => {
    expect(displayStateOf({ platformState: 1, lastObservedAt: ago(121) }, now, 120)).toBe('unknown');
    expect(displayStateOf({ platformState: 2, lastObservedAt: ago(3600) }, now, 120)).toBe('unknown');
  });
});
