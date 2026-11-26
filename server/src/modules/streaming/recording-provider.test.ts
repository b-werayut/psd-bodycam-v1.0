import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDssBearer } from '../../test/dss-token';
import { LiveStreamProvider } from './live-stream.provider';
import { RecordingProvider, parseRecordings } from './recording-provider';

type Recorded = { url: string; headers: IncomingMessage['headers']; body: string };

const KEY = 'test-dss-api-key-0123456789abcdef';
const calls: Recorded[] = [];
let server: Server;
let baseUrl: string;
let handler: (url: string, res: ServerResponse) => void;

const json = (res: ServerResponse, payload: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push({ url: req.url ?? '', headers: req.headers, body });
      handler(req.url ?? '', res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.DSS_DRIVER = 'dss';
  process.env.DSS_BASE_URL = baseUrl;
  process.env.DSS_API_KEY = KEY;
  delete process.env.DSS_TIMEOUT_MS;
  delete process.env.STREAM_ALLOWED_HOSTS;
  delete process.env.STREAM_API_URL;
  handler = (_url, res) => json(res, { code: 1000, data: { records: [] } });
});

afterEach(() => {
  calls.length = 0;
});

const make = () => new RecordingProvider(new LiveStreamProvider());
const sec = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));
const record = (start: string, end: string) => ({
  channelId: 'V1$1$0$0',
  recordSource: '1',
  recordType: '1',
  startTime: sec(start),
  endTime: sec(end),
  recordName: 'x',
  fileLength: '123',
  startDateTime: '2026-11-26 15:53:58',
  duration_seconds: 99,
});

describe('parseRecordings', () => {
  it('accepts records / list / array, string or number seconds, drops invalid rows, sorts', () => {
    const rows = [
      { startTime: '1764160000', endTime: '1764160100' },
      { startTime: 1764150000, endTime: 1764150500 },
      { startTime: 'abc', endTime: '1' },
      { endTime: '1764160100' },
      { startTime: '1764170000', endTime: '1764169000' },
    ];
    for (const payload of [{ data: { records: rows } }, { data: { list: rows } }, { data: rows }]) {
      const out = parseRecordings(payload);
      expect(out.map((f) => f.startAt.getTime() / 1000)).toEqual([1764150000, 1764160000]);
      expect(out[0].durationSeconds).toBe(500);
      expect(out[0].endAt).toBeInstanceOf(Date);
    }
    expect(parseRecordings(null)).toEqual([]);
    expect(parseRecordings({ data: null })).toEqual([]);
  });
});

describe('RecordingProvider.search (dss)', () => {
  const from = new Date('2026-11-26T01:00:00Z');
  const to = new Date('2026-11-26T05:00:00Z');

  it('posts channelId + daysBack with a valid bearer, parses the real shape and filters to the window', async () => {
    handler = (_url, res) =>
      json(res, {
        code: 1000,
        data: {
          total_records: 4,
          records: [
            record('2026-11-26T00:00:00Z', '2026-11-26T00:59:59Z'),
            record('2026-11-26T00:30:00Z', '2026-11-26T01:30:00Z'),
            record('2026-11-26T04:30:00Z', '2026-11-26T05:30:00Z'),
            record('2026-11-26T05:00:00Z', '2026-11-26T06:00:00Z'),
          ],
        },
      });
    const files = await make().search('V1', from, to);

    expect(calls[0].url).toBe('/api/v1/recording/search');
    const body = JSON.parse(calls[0].body);
    expect(body.channelId).toBe('V1$1$0$0');
    expect(body.daysBack).toBeGreaterThanOrEqual(1);
    await verifyDssBearer(calls[0].headers.authorization, KEY);
    expect(files.map((f) => f.startAt.toISOString())).toEqual(['2026-11-26T00:30:00.000Z', '2026-11-26T04:30:00.000Z']);
  });

  it('daysBack comes from dssDaysBackFor(from)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-26T09:37:00Z'));
      const old = new Date(Date.now() - 3 * 86_400_000);
      await make().search('V1', old, new Date(old.getTime() + 3_600_000));
      expect(JSON.parse(calls[0].body).daysBack).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('code 1002 means no recordings, without a second try', async () => {
    handler = (_url, res) => json(res, { code: 1002, desc: 'none', data: null });
    expect(await make().search('V1', from, to)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('a failed search is tried once more and the second answer is used', async () => {
    let n = 0;
    handler = (_url, res) =>
      (n++ === 0
        ? json(res, { code: 5000, desc: 'warming up', data: null })
        : json(res, { code: 1000, data: { records: [record('2026-11-26T02:00:00Z', '2026-11-26T03:00:00Z')] } }));
    const files = await make().search('V1', from, to);
    expect(calls).toHaveLength(2);
    expect(files.map((f) => f.startAt.toISOString())).toEqual(['2026-11-26T02:00:00.000Z']);
  });

  it('gives up after the second failure', async () => {
    handler = (_url, res) => json(res, { detail: 'down' }, 503);
    const error = await make().search('V1', from, to).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/HTTP 503/);
    expect(calls).toHaveLength(2);
  });

  it('other codes and HTTP errors throw an English error without the body', async () => {
    handler = (_url, res) => json(res, { code: 5000, desc: 'SECRET-DETAIL', data: null });
    const first = await make().search('V1', from, to).catch((e: Error) => e);
    expect((first as Error).message).toMatch(/code=5000/);
    expect((first as Error).message).not.toContain('SECRET-DETAIL');
    handler = (_url, res) => json(res, { detail: 'SECRET-DETAIL' }, 500);
    const error = await make().search('V1', from, to).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/HTTP 500/);
    expect((error as Error).message).not.toContain('SECRET-DETAIL');
  });
});

describe('RecordingProvider.search (mock)', () => {
  it('returns two deterministic Bangkok files for the day of from, filtered to the window', async () => {
    process.env.DSS_DRIVER = 'mock';
    const all = await make().search('V1', new Date('2026-11-25T17:00:00Z'), new Date('2026-11-26T17:00:00Z'));
    expect(all.map((f) => [f.startAt.toISOString(), f.endAt.toISOString()])).toEqual([
      ['2026-11-26T01:00:00.000Z', '2026-11-26T03:00:00.000Z'],
      ['2026-11-26T06:00:00.000Z', '2026-11-26T06:45:00.000Z'],
    ]);
    expect(all[0].durationSeconds).toBe(7200);
    const part = await make().search('V1', new Date('2026-11-26T04:00:00Z'), new Date('2026-11-26T17:00:00Z'));
    expect(part).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe('RecordingProvider.requestPlayback', () => {
  const startAt = new Date('2026-11-26T01:00:00Z');
  const endAt = new Date('2026-11-26T02:00:00Z');

  it('posts unix-second strings and returns the url', async () => {
    handler = (_url, res) => json(res, { code: 1000, data: { video_url: `${baseUrl}/proxy/a.m3u8` } });
    const result = await make().requestPlayback('V1', startAt, endAt);

    expect(calls[0].url).toBe('/api/v1/playback');
    expect(JSON.parse(calls[0].body)).toMatchObject({
      deviceCode: 'V1',
      channelId: 'V1$1$0$0',
      startTime: sec('2026-11-26T01:00:00Z'),
      endTime: sec('2026-11-26T02:00:00Z'),
    });
    await verifyDssBearer(calls[0].headers.authorization, KEY);
    expect(result).toEqual({ vendorUrl: `${baseUrl}/proxy/a.m3u8`, vendorSessionId: expect.any(String) });
  });

  it('1002 gives no-recordings', async () => {
    handler = (_url, res) => json(res, { code: 1002, data: null });
    expect(await make().requestPlayback('V1', startAt, endAt)).toBe('no-recordings');
  });

  it('other failures throw, and a disallowed host throws', async () => {
    handler = (_url, res) => json(res, { code: 1001, desc: 'SECRET', data: null });
    await expect(make().requestPlayback('V1', startAt, endAt)).rejects.toThrow(/code=1001/);
    handler = (_url, res) => json(res, { code: 1000, data: { video_url: 'http://evil.example/x.m3u8' } });
    await expect(make().requestPlayback('V1', startAt, endAt)).rejects.toThrow(/not allowed/);
  });

  it('requires the dss driver', async () => {
    process.env.DSS_DRIVER = 'mock';
    await expect(make().requestPlayback('V1', startAt, endAt)).rejects.toThrow(/DSS_DRIVER=dss/);
  });
});
