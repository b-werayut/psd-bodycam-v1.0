// Socket.IO rooms (CLAUDE.md: org, user:{id}, tracking, alerts, team:{id} — no dept:*).
// P0 has org + user:{id}; P1 adds tracking (tracking:view), P2 alerts (alerts:view), P5 team:{id}.

export const ORG_ROOM = 'org';

export function userRoom(userId: bigint | string): string {
  return `user:${userId}`;
}

/** Rooms a socket joins at connect, from its verified access token. */
export function roomsForClient(identity: { sub: string }): string[] {
  return [ORG_ROOM, userRoom(identity.sub)];
}
