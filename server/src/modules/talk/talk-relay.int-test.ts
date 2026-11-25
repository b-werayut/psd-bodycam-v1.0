import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { eventually } from '../../test/int-helpers';
import { bootTalkKit, type TalkKit } from '../../test/talk-kit';
import { TALK_PROVIDER, TalkProviderError, type TalkProvider } from './provider/talk-provider.interface';
import { TALK_END_REASON, TALK_MESSAGE, TALK_STATUS } from './talk-constants';
import { TALK_RELAY_OPTIONS, type TalkRelayOptions } from './talk-relay';

/** 8000 Hz x 40 ms x 2 byte: the frame the mock driver speaks (same as the DSS middleware). */
const FRAME_BYTES = 640;
const READY = JSON.stringify({ type: 'ready' });
const PREFIX = 't_talkws_';

let kit: TalkKit;
let port: number;
let provider: TalkProvider;
let relayOptions: TalkRelayOptions;
let originalRevalidateMs: number;
const sockets: WebSocket[] = [];
const sql = () => kit.ctx.sql;

type Probe = {
  ws: WebSocket;
  texts: string[];
  frames: Buffer[];
  closed: Promise<{ code: number; reason: string }>;
};

beforeAll(async () => {
  kit = await bootTalkKit(PREFIX);
  const server = kit.ctx.app.getHttpServer() as Server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
  provider = kit.ctx.app.get<TalkProvider>(TALK_PROVIDER);
  relayOptions = kit.ctx.app.get<TalkRelayOptions>(TALK_RELAY_OPTIONS);
  originalRevalidateMs = relayOptions.revalidateMs;
  relayOptions.revalidateMs = 200; // tests do not wait for the real 15 s round
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await kit.cleanup();
});

afterAll(async () => {
  if (relayOptions) relayOptions.revalidateMs = originalRevalidateMs;
  await kit?.close();
});

type Started = { id: string; wsUrl: string; liveToken: string };

async function openCallFor(who: 'owner' | 'other' = 'owner'): Promise<Started> {
  const device = await kit.makeDevice();
  const liveToken = await kit.openLive(kit.auth[who], device.code);
  const res = await kit.startTalk(kit.auth[who], liveToken);
  if (res.status !== 200) throw new Error(`start talk failed ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.talkSessionId as string, wsUrl: res.body.wsUrl as string, liveToken };
}

function openWs(path: string): Probe {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  sockets.push(ws);
  const texts: string[] = [];
  const frames: Buffer[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) frames.push(Buffer.from(data as Buffer));
    else texts.push(data.toString());
  });
  ws.on('error', () => undefined);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  return { ws, texts, frames, closed };
}

async function waitReady(probe: Probe): Promise<void> {
  await eventually(async () => (probe.texts.includes(READY) ? true : null), 3_000);
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`not done within ${ms} ms`)), ms)),
  ]);
}

const talkRow = async (id: string) => (await sql()`select * from "TalkSessions" where "Id" = ${BigInt(id)}`)[0];

const endedRow = (id: string) =>
  eventually(async () => {
    const row = await talkRow(id);
    return row.Status === TALK_STATUS.ENDED ? row : null;
  });

const stopAudit = (id: string) =>
  eventually(async () => {
    const [row] = await sql()`
      select "Changes" from "AuditLogs"
      where "Action" = 'STOP_TALK' and "ResourceId" = ${BigInt(id)}
      order by "Id" desc limit 1`;
    return row;
  });

describe('WS /api/talk/ws', () => {
  it('valid ticket: gets {"type":"ready"}, uplink audio echoes back as downlink (mock driver)', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    const frame = Buffer.alloc(FRAME_BYTES, 0x11);
    probe.ws.send(frame);
    const echo = await eventually(async () => probe.frames[0], 3_000);

    expect(echo.equals(frame)).toBe(true);
    const row = await talkRow(talk.id);
    expect(row.Status).toBe(TALK_STATUS.ACTIVE);
    expect(row.TicketHash).toBeNull();
  });

  it('a ticket works once: a second connect gets 4401 ticket and the first call is untouched', async () => {
    const talk = await openCallFor();
    const first = openWs(talk.wsUrl);
    await waitReady(first);

    const second = openWs(talk.wsUrl);

    expect(await within(second.closed, 3_000)).toEqual({ code: 4401, reason: 'ticket' });
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('expired ticket: 4401, ticket not consumed, row left for TalkIdle', async () => {
    const talk = await openCallFor();
    await sql()`
      update "TalkSessions" set "TicketExpiresAt" = now() - interval '1 second'
      where "Id" = ${BigInt(talk.id)}`;

    const probe = openWs(talk.wsUrl);

    expect(await within(probe.closed, 3_000)).toEqual({ code: 4401, reason: 'ticket' });
    expect(probe.texts).toEqual([]);
    const row = await talkRow(talk.id);
    expect(row.TicketHash).not.toBeNull();
    expect(row.Status).toBe(TALK_STATUS.ACTIVE);
  });

  it('missing, malformed and unknown tickets: upgrade accepted then closed 4401', async () => {
    for (const path of ['/api/talk/ws', '/api/talk/ws?ticket=abc', `/api/talk/ws?ticket=${'A'.repeat(43)}`]) {
      const probe = openWs(path);
      expect(await within(probe.closed, 3_000), path).toEqual({ code: 4401, reason: 'ticket' });
    }
  });

  it('wrong-size uplink frame: closed 1008 frame, DISCONNECTED, audit STOP_TALK closedBy system', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    probe.ws.send(Buffer.alloc(100));

    expect(await within(probe.closed, 3_000)).toEqual({ code: 1008, reason: 'frame' });
    expect((await endedRow(talk.id)).EndReason).toBe(TALK_END_REASON.DISCONNECTED);
    const log = await stopAudit(talk.id);
    expect(log.Changes).toMatchObject({
      endReason: TALK_END_REASON.DISCONNECTED,
      closeCode: 1008,
      closedBy: 'system',
    });
  });

  it('streaming:talk revoked mid-call: cut with 4006 policy within a revalidate round', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    await kit.revokeTalk('OPERATOR');

    expect(await within(probe.closed, 3_000)).toEqual({ code: 4006, reason: 'policy' });
    expect((await talkRow(talk.id)).EndReason).toBe(TALK_END_REASON.POLICY_DISABLED);
  });

  it('live session stopped: WS closed by the next revalidate with 4006 and row ENDED/POLICY_DISABLED', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    await sql()`update "StreamingSessions" set "Status" = 3 where "SessionToken" = ${talk.liveToken}`;

    expect(await within(probe.closed, 3_000)).toEqual({ code: 4006, reason: 'policy' });
    const row = await endedRow(talk.id);
    expect(row.EndReason).toBe(TALK_END_REASON.POLICY_DISABLED);
  });

  it('browser hangs up (close 1000): USER_STOPPED + audit STOP_TALK closedBy browser', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    probe.ws.close(1000, 'hangup');
    await within(probe.closed, 3_000);

    const row = await endedRow(talk.id);
    expect(row.EndReason).toBe(TALK_END_REASON.USER_STOPPED);
    expect(row.DurationSeconds).toBeGreaterThanOrEqual(0);
    const log = await stopAudit(talk.id);
    expect(log.Changes).toMatchObject({ closeCode: 1000, closedBy: 'browser' });
  });

  it('browser socket terminated mid-call: row ENDED/DISCONNECTED, provider.stop called, new start on the same device works', async () => {
    const stopSpy = vi.spyOn(provider, 'stop');
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const started = await kit.startTalk(kit.auth.owner, liveToken);
    expect(started.status).toBe(200);
    const id = started.body.talkSessionId as string;
    const probe = openWs(started.body.wsUrl as string);
    await waitReady(probe);

    probe.ws.terminate();

    await eventually(async () => ((await talkRow(id)).Status === TALK_STATUS.ENDED ? true : null));
    expect((await talkRow(id)).EndReason).toBe(TALK_END_REASON.DISCONNECTED);
    await eventually(async () => (stopSpy.mock.calls.length > 0 ? true : null));
    expect((await kit.startTalk(kit.auth.owner, liveToken)).status).toBe(200);
  });

  it('REST stop during the call: WS closed 4004 stopped and EndReason stays USER_STOPPED', async () => {
    const talk = await openCallFor();
    const probe = openWs(talk.wsUrl);
    await waitReady(probe);

    const res = await kit.stopTalk(kit.auth.owner, talk.id);

    expect(res.status).toBe(200);
    expect(await within(probe.closed, 3_000)).toEqual({ code: 4004, reason: 'stopped' });
    expect((await talkRow(talk.id)).EndReason).toBe(TALK_END_REASON.USER_STOPPED);
  });

  it('upstream audio channel fails to open: closed 4005 vendor-error + VENDOR_ERROR (no ready)', async () => {
    vi.spyOn(provider, 'openAudio').mockRejectedValueOnce(
      new TalkProviderError(TALK_MESSAGE.SYSTEM_ERROR, null, 'test: middleware refused the WS'),
    );
    const talk = await openCallFor();

    const probe = openWs(talk.wsUrl);

    expect(await within(probe.closed, 3_000)).toEqual({ code: 4005, reason: 'vendor-error' });
    expect(probe.texts).toEqual([]);
    expect((await endedRow(talk.id)).EndReason).toBe(TALK_END_REASON.VENDOR_ERROR);
  });

  it('/socket.io upgrades still reach Socket.IO (relay ignores other paths)', async () => {
    const client = ioClient(`http://127.0.0.1:${port}/realtime`, {
      auth: { token: kit.auth.viewer.replace(/^Bearer /, '') },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    try {
      await within(
        new Promise<void>((resolve, reject) => {
          client.once('connect', () => resolve());
          client.once('connect_error', reject);
        }),
        3_000,
      );
      expect(client.connected).toBe(true);
    } finally {
      client.disconnect();
    }
  });
});
