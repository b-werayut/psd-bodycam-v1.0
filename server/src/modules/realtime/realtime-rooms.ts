// Socket.IO rooms (CLAUDE.md: org, user:{id}, tracking, alerts, team:{id} — no dept:*).
// P0 org + user:{id}; P1 tracking (tracking:view) and alerts (alerts:view); P5 team:{id} (TEAM_LEADER).

export const ORG_ROOM = 'org';

/** `gps:batch` goes here. */
export const TRACKING_ROOM = 'tracking';

/** `alert:new` for web users with alerts:view (P2 alerts; P1 alert 13 goes to ADMINs' user rooms). */
export const ALERTS_ROOM = 'alerts';

export function userRoom(userId: bigint | string): string {
  return `user:${userId}`;
}

/**
 * Rooms a socket joins at connect. `roleCode` / `permissions` come from the DB at handshake (not the
 * token), so a role change applies from the next connect. ADMIN bypasses permission checks (DL55).
 */
export function roomsForClient(identity: { sub: string; roleCode: string; permissions: readonly string[] }): string[] {
  const rooms = [ORG_ROOM, userRoom(identity.sub)];
  const admin = identity.roleCode === 'ADMIN';
  if (admin || identity.permissions.includes('tracking:view')) rooms.push(TRACKING_ROOM);
  if (admin || identity.permissions.includes('alerts:view')) rooms.push(ALERTS_ROOM);
  return rooms;
}
