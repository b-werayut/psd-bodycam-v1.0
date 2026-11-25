import { describe, expect, it } from 'vitest';
import { ALERTS_ROOM, ORG_ROOM, roomsForClient, TRACKING_ROOM, userRoom } from './realtime-rooms';

describe('realtime rooms', () => {
  it('keeps TEAM_LEADER out of organization-wide rooms', () => {
    expect(roomsForClient({ sub: '7', roleCode: 'TEAM_LEADER', permissions: ['streaming:view-live'] })).toEqual(['user:7']);
  });
  it('every client joins org and its own user room', () => {
    expect(roomsForClient({ sub: '7', roleCode: 'VIEWER', permissions: [] })).toEqual(['org', 'user:7']);
  });

  it('tracking needs tracking:view, alerts needs alerts:view', () => {
    expect(
      roomsForClient({ sub: '7', roleCode: 'OPERATOR', permissions: ['tracking:view', 'alerts:view', 'devices:read'] }),
    ).toEqual(['org', 'user:7', 'tracking', 'alerts']);
    expect(roomsForClient({ sub: '7', roleCode: 'OPERATOR', permissions: ['alerts:view'] })).toEqual([
      'org',
      'user:7',
      'alerts',
    ]);
  });

  it('SUPER_ADMIN joins both whatever its permission list says', () => {
    expect(roomsForClient({ sub: '1', roleCode: 'SUPER_ADMIN', permissions: [] })).toEqual([
      'org',
      'user:1',
      'tracking',
      'alerts',
    ]);
  });

  it('room names', () => {
    expect(ORG_ROOM).toBe('org');
    expect(TRACKING_ROOM).toBe('tracking');
    expect(ALERTS_ROOM).toBe('alerts');
    expect(userRoom(42n)).toBe('user:42');
    expect(userRoom('42')).toBe('user:42');
  });
});
