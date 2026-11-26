import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyDssBearer } from '../../../test/dss-token';
import WebSocket, { WebSocketServer } from 'ws';

import { TALK_MESSAGE } from '../talk-constants';
import { readDssConfig } from '../../../common/dss/dss-config';
import { DssTalkProvider } from './dss-talk.provider';
import { MockTalkProvider } from './mock-talk.provider';
import { TALK_PROVIDER, TalkProviderError } from './talk-provider.interface';
import { TalkProviderModule } from './talk-provider.module';
import { NestFactory } from '@nestjs/core';

type Recorded = { url: string; headers: IncomingMessage['headers']; body: string };

const TALK_ID = '0123456789abcdef0123456789abcdef';

let server: Server;
let baseUrl: string;
const wss = new WebSocketServer({ noServer: true });
const KEY = 'test-dss-api-key-0123456789abcdef';
const calls: { start: Recorded[]; stop: Recorded[] } = { start: [], stop: [] };
const upgrades: { url: string; authorization: string | undefined }[] = [];
let rejectUpgrade = false;
let onAudio: (socket: WebSocket) => void = () => undefined;
let startHandler: (res: ServerResponse) => void;
let stopHandler: (res: ServerResponse) => void;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

const json = (res: ServerResponse, payload: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const okStart = () => ({
  code: 1000,
  desc: 'Success',
  data: { talkId: TALK_ID, uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40 },
});

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const record: Recorded = { url: req.url ?? '', headers: req.headers, body: await readBody(req) };
    if (record.url === '/api/v1/talk/start') {
      calls.start.push(record);
      startHandler(res);
      return;
    }
    if (record.url === '/api/v1/talk/stop') {
      calls.stop.push(record);
      stopHandler(res);
      return;
    }
    json(res, { detail: 'not found' }, 404);
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    upgrades.push({ url: req.url ?? '', authorization: req.headers.authorization });
    if (rejectUpgrade) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onAudio(ws));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const client of wss.clients) client.terminate();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.DSS_DRIVER = 'dss';
  process.env.DSS_BASE_URL = baseUrl;
  process.env.DSS_API_KEY = KEY;
  delete process.env.DSS_TIMEOUT_MS;
  rejectUpgrade = false;
  onAudio = () => undefined;
  startHandler = (res) => json(res, okStart());
  stopHandler = (res) => json(res, { code: 1000, desc: 'Success', data: null });
});

afterEach(() => {
  calls.start.length = 0;
  calls.stop.length = 0;
  upgrades.length = 0;
});

const makeProvider = () => new DssTalkProvider(readDssConfig(process.env));

const startError = () =>
  makeProvider()
    .start({ vendorDeviceId: '1000040', maxSeconds: 600 })
    .then(() => {
      throw new Error('คาดว่าจะล้มแต่สำเร็จ');
    })
    .catch((error: unknown) => error as TalkProviderError);

describe('DssTalkProvider.start', () => {
  it('POST /api/v1/talk/start {deviceCode, maxSeconds} ด้วย bearer ที่ verifyDssBearer ยอมรับ แล้วคืนรูปแบบเสียง', async () => {
    const result = await makeProvider().start({ vendorDeviceId: '1000040', maxSeconds: 600 });

    expect(result).toEqual({ talkId: TALK_ID, uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40 });
    expect(JSON.parse(calls.start[0].body)).toEqual({ deviceCode: '1000040', maxSeconds: 600 });
    await verifyDssBearer(calls.start[0].headers.authorization, KEY);
    expect(calls.start[0].headers['content-type']).toContain('charset=UTF-8');
  });

  it.each<[number, string, string]>([
    [1001, 'Offline', 'อุปกรณ์ไม่พร้อมรับเสียง'],
    [1002, 'RTSP handshake failed', 'เชื่อมต่อช่องเสียงของกล้องไม่สำเร็จ'],
    [1003, 'AMR', 'กล้องรุ่นนี้ใช้รูปแบบเสียงที่ระบบยังไม่รองรับ'],
    [1004, 'device busy', 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่'],
    [5000, 'boom', 'ระบบเสียงขัดข้อง กรุณาลองใหม่'],
  ])('FastAPI code %i -> ข้อความตามตาราง error ของ spec', async (code, desc, message) => {
    startHandler = (res) => json(res, { code, desc, data: null });

    const error = await startError();

    expect(error).toBeInstanceOf(TalkProviderError);
    expect(error.userMessage).toBe(message);
    expect(error.vendorCode).toBe(code);
    expect(error.message).toContain(`code=${code}`);
    expect(error.message).toContain(desc);
    expect(error.userMessage).not.toContain(desc);
  });

  it('desc ยาวเกิน 200 ตัวอักษร -> detail ตัดเหลือ 200 · userMessage ไม่มี desc', async () => {
    startHandler = (res) => json(res, { code: 1001, desc: 'x'.repeat(300), data: null });

    const error = await startError();

    expect(error.userMessage).toBe(TALK_MESSAGE.DEVICE_NOT_READY);
    expect(error.message).toContain(`: ${'x'.repeat(200)})`);
    expect(error.message).not.toContain('x'.repeat(201));
  });

  it('FastAPI ล่ม (HTTP 500 ไม่ใช่ JSON) -> "ระบบเสียงขัดข้อง" + รายละเอียดใน message', async () => {
    startHandler = (res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    };

    const error = await startError();

    expect(error.userMessage).toBe(TALK_MESSAGE.SYSTEM_ERROR);
    expect(error.message).toContain('500');
  });

  it('FastAPI ตอบ {code, desc} พร้อม HTTP 4xx -> เชื่อ code ก่อน HTTP status', async () => {
    startHandler = (res) => json(res, { code: 4000, desc: 'maxSeconds out of range', data: null }, 422);

    const error = await startError();

    expect(error.userMessage).toBe(TALK_MESSAGE.SYSTEM_ERROR);
    expect(error.vendorCode).toBe(4000);
    expect(error.message).toContain('maxSeconds out of range');
  });

  it('code 1000 แต่ data ไม่ครบ -> ล้มเหลว (กันคำนวณขนาด frame จาก undefined)', async () => {
    startHandler = (res) =>
      json(res, { code: 1000, desc: 'Success', data: { talkId: TALK_ID, uplinkSampleRate: 8000 } });

    const error = await startError();

    expect(error.userMessage).toBe(TALK_MESSAGE.SYSTEM_ERROR);
    expect(error.message).toMatch(/start response data is incomplete/);
  });

  it('start รอได้ 30 วินาที (DSS ตอบ DESCRIBE ช้า ~10 วินาที) แต่ stop ใช้ DSS_TIMEOUT_MS', async () => {
    process.env.DSS_TIMEOUT_MS = '1000';
    startHandler = (res) => {
      setTimeout(() => json(res, okStart()), 1300);
    };
    stopHandler = (res) => {
      setTimeout(() => json(res, { code: 1000 }), 1300);
    };
    const provider = makeProvider();

    await expect(provider.start({ vendorDeviceId: '1000040', maxSeconds: 600 })).resolves.toMatchObject({
      talkId: TALK_ID,
    });
    await expect(provider.stop(TALK_ID)).rejects.toThrow(/did not respond within 1000 ms/);
  });

  it('ไม่ได้ตั้ง DSS_BASE_URL -> readDssConfig บอกชื่อ env ที่ขาด', () => {
    delete process.env.DSS_BASE_URL;

    expect(() => makeProvider()).toThrow(/DSS_BASE_URL/);
  });
});

describe('DssTalkProvider.stop', () => {
  it('POST /api/v1/talk/stop {talkId} · code ที่ไม่ใช่ 1000 = ล้มเหลว', async () => {
    const provider = makeProvider();

    await provider.stop(TALK_ID);
    expect(JSON.parse(calls.stop[0].body)).toEqual({ talkId: TALK_ID });

    stopHandler = (res) => json(res, { code: 5000, desc: 'boom' });
    await expect(provider.stop(TALK_ID)).rejects.toThrow(/code=5000/);
  });
});

describe('DssTalkProvider.openAudio', () => {
  it('ต่อ WS ที่ /api/v1/talk/{talkId}/audio (http -> ws) พร้อม Authorization แล้วส่งเสียงได้สองทาง', async () => {
    const serverSide = new Promise<WebSocket>((resolve) => {
      onAudio = resolve;
    });

    const channel = await makeProvider().openAudio(TALK_ID);
    const remote = await serverSide;

    expect(upgrades[0].url).toBe(`/api/v1/talk/${TALK_ID}/audio`);
    await verifyDssBearer(upgrades[0].authorization, KEY);

    const uplink = new Promise<Buffer>((resolve) => remote.once('message', (data) => resolve(data as Buffer)));
    channel.send(Buffer.alloc(640, 7));
    expect((await uplink).equals(Buffer.alloc(640, 7))).toBe(true);

    const downlink = new Promise<Buffer>((resolve) => channel.onMessage(resolve));
    remote.send(Buffer.alloc(640, 9), { binary: true });
    expect((await downlink).equals(Buffer.alloc(640, 9))).toBe(true);

    const closed = new Promise<[number, string]>((resolve) =>
      channel.onClose((code, reason) => resolve([code, reason])),
    );
    remote.close(4003, 'vendor-ended');
    expect(await closed).toEqual([4003, 'vendor-ended']);
  });

  it('FastAPI ปฏิเสธ upgrade -> TalkProviderError ("ระบบเสียงขัดข้อง")', async () => {
    rejectUpgrade = true;

    const error = await makeProvider().openAudio(TALK_ID).then(
      () => {
        throw new Error('openAudio ต้อง reject เมื่อ FastAPI ปฏิเสธ upgrade');
      },
      (e: unknown) => e as TalkProviderError,
    );

    expect(error).toBeInstanceOf(TalkProviderError);
    expect(error.userMessage).toBe(TALK_MESSAGE.SYSTEM_ERROR);
  });
});

describe('TalkProviderModule', () => {
  const resolve = async () => {
    const ctx = await NestFactory.createApplicationContext(TalkProviderModule, { logger: false });
    try {
      return ctx.get(TALK_PROVIDER);
    } finally {
      await ctx.close();
    }
  };

  it('picks MockTalkProvider when DSS_DRIVER=mock', async () => {
    process.env.DSS_DRIVER = 'mock';
    expect(await resolve()).toBeInstanceOf(MockTalkProvider);
  });

  it('picks DssTalkProvider when DSS_DRIVER=dss', async () => {
    expect(await resolve()).toBeInstanceOf(DssTalkProvider);
  });
});
