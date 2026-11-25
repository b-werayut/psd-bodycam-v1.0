import { vi } from 'vitest';
import { hashPassword } from '../common/auth/password';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from './int-helpers';
import { LiveStreamProvider } from '../modules/streaming/live-stream.provider';

/** Shared setup for the talk integration tests (not a test file itself). */
export const TALK_TEST_PASSWORD = 'Test@12345';

export type TalkKit = {
  ctx: HttpContext;
  auth: Record<'owner' | 'other' | 'viewer' | 'leader', string>;
  ids: Record<'owner' | 'other' | 'viewer' | 'leader', bigint>;
  makeDevice(): Promise<{ id: bigint; code: string }>;
  openLive(auth: string, deviceCode: string): Promise<string>;
  startTalk(auth: string, streamSessionToken: string): ReturnType<ReturnType<HttpContext['http']['post']>['send']>;
  stopTalk(auth: string, id: string): ReturnType<ReturnType<HttpContext['http']['post']>['send']>;
  /** Fresh login: a new JWT reflects the role's current grants. */
  relogin(name: 'owner' | 'other' | 'viewer' | 'leader'): Promise<string>;
  grantTalk(roleCode: string): Promise<void>;
  revokeTalk(roleCode: string): Promise<void>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
};

export async function bootTalkKit(prefix: string): Promise<TalkKit> {
  vi.stubEnv('STREAM_ALLOWED_HOSTS', 'media.test');
  const ctx = await bootHttpContext();
  const { sql, http } = ctx;
  await createTestUsers(
    sql,
    [
      { username: `${prefix}owner`, role: 'OPERATOR' },
      { username: `${prefix}other`, role: 'OPERATOR' },
      { username: `${prefix}viewer`, role: 'VIEWER' },
      { username: `${prefix}leader`, role: 'TEAM_LEADER' },
    ],
    await hashPassword(TALK_TEST_PASSWORD),
  );
  const auth = {
    owner: await bearerFor(http, `${prefix}owner`, TALK_TEST_PASSWORD),
    other: await bearerFor(http, `${prefix}other`, TALK_TEST_PASSWORD),
    viewer: await bearerFor(http, `${prefix}viewer`, TALK_TEST_PASSWORD),
    leader: await bearerFor(http, `${prefix}leader`, TALK_TEST_PASSWORD),
  };
  const idOf = async (name: string) =>
    (await sql`select "Id" from "Users" where "Username" = ${`${prefix}${name}`}`)[0].Id as bigint;
  const ids = {
    owner: await idOf('owner'),
    other: await idOf('other'),
    viewer: await idOf('viewer'),
    leader: await idOf('leader'),
  };

  const created: bigint[] = [];
  let seq = 0;

  const kit: TalkKit = {
    ctx,
    auth,
    ids,
    async makeDevice() {
      seq += 1;
      const code = `T-TALK-${prefix.length}${Date.now() % 100000}-${seq}`;
      const [row] = await sql`
        insert into "Devices" ("DeviceCode","VendorDeviceId","Name","Kind")
        values (${code}, ${`VENDOR-${code}`}, ${code}, 1) returning "Id"`;
      created.push(row.Id as bigint);
      return { id: row.Id as bigint, code };
    },
    async openLive(bearer, deviceCode) {
      vi.spyOn(ctx.app.get(LiveStreamProvider), 'requestLive').mockResolvedValue({
        vendorUrl: 'https://media.test/live/index.m3u8',
        vendorSessionId: `vendor-${deviceCode}$1$0$0`,
      });
      const res = await http.post('/api/streams/live').set('Authorization', bearer).send({ deviceCode });
      if (res.status !== 200) throw new Error(`open live failed ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.sessionToken as string;
    },
    startTalk: (bearer, streamSessionToken) =>
      http.post('/api/talk/sessions').set('Authorization', bearer).send({ streamSessionToken }),
    stopTalk: (bearer, id) => http.post(`/api/talk/sessions/${id}/stop`).set('Authorization', bearer).send({}),
    relogin: (name) => bearerFor(http, `${prefix}${name}`, TALK_TEST_PASSWORD),
    async grantTalk(roleCode) {
      await sql`
        insert into "RolePermissions" ("RoleId","PermissionId")
        select r."Id", p."Id" from "Roles" r, "Permissions" p
        where r."Code" = ${roleCode} and p."Code" = 'streaming:talk'
        on conflict do nothing`;
    },
    async revokeTalk(roleCode) {
      await sql`
        delete from "RolePermissions"
        where "RoleId" = (select "Id" from "Roles" where "Code" = ${roleCode})
          and "PermissionId" = (select "Id" from "Permissions" where "Code" = 'streaming:talk')`;
    },
    async cleanup() {
      for (const id of created.splice(0)) {
        await sql`delete from "TalkSessions" where "DeviceId" = ${id}`;
        await sql`delete from "StreamingSessions" where "DeviceId" = ${id}`;
        await sql`delete from "Devices" where "Id" = ${id}`;
      }
      await kit.grantTalk('OPERATOR');
    },
    async close() {
      await kit.cleanup();
      await sql`delete from "AuditLogs" where "ResourceType" = 'TalkSessions'`;
      await dropTestUsers(sql, [`${prefix}%`]);
      await ctx.close();
      vi.unstubAllEnvs();
    },
  };
  return kit;
}
