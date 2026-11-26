import { describe, expect, it } from 'vitest';
import { openDownloadTicket, sealDownloadTicket } from './download-ticket';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-26T10:00:00Z');

describe('download ticket', () => {
  it('round trips', () => {
    const t = sealDownloadTicket({ exportId: 42n, userId: 7n }, KEY, NOW);
    expect(openDownloadTicket(t, KEY, new Date(NOW.getTime() + 30_000))).toEqual({ exportId: 42n, userId: 7n });
  });
  it('is reusable inside 60 s and dead after', () => {
    const t = sealDownloadTicket({ exportId: 42n, userId: 7n }, KEY, NOW);
    expect(openDownloadTicket(t, KEY, new Date(NOW.getTime() + 60_000))).not.toBeNull();
    expect(openDownloadTicket(t, KEY, new Date(NOW.getTime() + 61_000))).toBeNull();
  });
  it('rejects tampered, wrong key and garbage', () => {
    const t = sealDownloadTicket({ exportId: 42n, userId: 7n }, KEY, NOW);
    const bad = t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA');
    expect(openDownloadTicket(bad, KEY, NOW)).toBeNull();
    expect(openDownloadTicket(t, Buffer.alloc(32, 8), NOW)).toBeNull();
    expect(openDownloadTicket('xyz', KEY, NOW)).toBeNull();
  });
});
