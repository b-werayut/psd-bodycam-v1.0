import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventually } from '../../test/int-helpers';
import { TALK_MESSAGE } from './talk-constants';
import { bootTalkKit, type TalkKit } from '../../test/talk-kit';

const PREFIX = 't_talkperm_';
let kit: TalkKit;
const sql = () => kit.ctx.sql;

beforeAll(async () => {
  kit = await bootTalkKit(PREFIX);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await kit.cleanup();
});
afterAll(async () => {
  await kit?.close();
});

const grants = async (role: string): Promise<number> =>
  (
    await sql()`
      select count(*)::int as n from "RolePermissions" rp
      join "Roles" r on r."Id" = rp."RoleId" join "Permissions" p on p."Id" = rp."PermissionId"
      where r."Code" = ${role} and p."Code" = 'streaming:talk'`
  )[0].n as number;

describe('streaming:talk grants (reference data)', () => {
  it('ADMIN and OPERATOR hold it, VIEWER and TEAM_LEADER do not', async () => {
    expect(await grants('ADMIN')).toBe(1);
    expect(await grants('OPERATOR')).toBe(1);
    expect(await grants('VIEWER')).toBe(0);
    expect(await grants('TEAM_LEADER')).toBe(0);
  });
});

describe('POST /api/talk/sessions permission', () => {
  const token = 'x'.repeat(43);

  it('no token -> 401', async () => {
    expect((await kit.ctx.http.post('/api/talk/sessions').send({ streamSessionToken: token })).status).toBe(401);
  });

  it('VIEWER -> 403 FORBIDDEN at the guard, audited as ACCESS_DENIED naming streaming:talk', async () => {
    const res = await kit.startTalk(kit.auth.viewer, token);
    expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
    const log = await eventually(async () => {
      const [row] = await sql()`
        select "Result","Changes" from "AuditLogs"
        where "Action" = 'ACCESS_DENIED' and "ActorUsername" = ${`${PREFIX}viewer`}
          and "RequestPath" = '/api/talk/sessions' order by "Id" desc limit 1`;
      return row;
    });
    expect(log.Result).toBe(2);
    expect(JSON.stringify(log.Changes)).toContain('streaming:talk');
  });

  it('TEAM_LEADER -> 403', async () => {
    expect((await kit.startTalk(kit.auth.leader, token)).status).toBe(403);
  });

  it('even with talk granted to the TEAM_LEADER role (fresh JWT), the service refuses -> 403 FORBIDDEN', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    await kit.grantTalk('TEAM_LEADER');
    try {
      const leader = await kit.relogin('leader'); // new JWT carries streaming:talk, so the guard passes
      const res = await kit.startTalk(leader, liveToken);
      expect([res.status, res.body.code, res.body.message]).toEqual([403, 'FORBIDDEN', TALK_MESSAGE.DENIED]);
    } finally {
      await kit.revokeTalk('TEAM_LEADER');
    }
  });

  it('POST /:id/stop needs login but no permission: VIEWER gets 404, not 403', async () => {
    expect((await kit.ctx.http.post('/api/talk/sessions/1/stop')).status).toBe(401);
    const res = await kit.stopTalk(kit.auth.viewer, '999999999');
    expect([res.status, res.body.code]).toEqual([404, 'TALK_NOT_FOUND']);
  });
});
