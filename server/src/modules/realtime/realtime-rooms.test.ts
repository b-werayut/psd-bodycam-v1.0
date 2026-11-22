import { describe, expect, it } from 'vitest';
import { ORG_ROOM, roomsForClient, userRoom } from './realtime-rooms';

describe('realtime rooms (P0)', () => {
  it('every client joins org and its own user room', () => {
    expect(roomsForClient({ sub: '7' })).toEqual(['org', 'user:7']);
  });

  it('room names', () => {
    expect(ORG_ROOM).toBe('org');
    expect(userRoom(42n)).toBe('user:42');
    expect(userRoom('42')).toBe('user:42');
  });
});
