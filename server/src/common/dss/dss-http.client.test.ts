import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { verifyDssBearer } from '../../test/dss-token';
import {
  DssHttpClient,
  parseDssDeviceList,
  parseDssLocation,
  parseDssOnline,
  parseDssReading,
  parseDssStatus,
  parseDssUpdateTime,
} from './dss-http.client';

// Response shapes copied from the real psd-bwc-dss-services (reference tests).
const REAL_OK = {
  code: 1000,
  desc: 'Success',
  data: {
    deviceCategory: '1',
    deviceCode: '1000067',
    deviceName: 'Bodycam',
    deviceType: '5',
    gpsX: 100.521467,
    gpsY: 13.718384,
    orgCode: null,
    orgName: 'Test Location',
    status: '1',
    updateTime: 1773248077,
  },
};
const REAL_NO_FIX = { code: 5000, desc: '', data: null };

describe('parseDssLocation / parseDssOnline', () => {
  it('gpsX = longitude, gpsY = latitude; updateTime is unix seconds', () => {
    const location = parseDssLocation(REAL_OK);
    expect(location).toEqual({
      lat: 13.718384,
      lng: 100.521467,
      recordedAt: new Date(1773248077_000),
      speedKph: null,
    });
  });

  it('code 5000 + data null = offline, no location, not an error', () => {
    expect(parseDssReading(REAL_NO_FIX, '1000067')).toEqual({
      vendorDeviceId: '1000067',
      online: false,
      location: null,
    });
  });

  it('code 1000 reads data.status ("1" online, "0" offline, missing = unknown)', () => {
    expect(parseDssOnline(REAL_OK)).toBe(true);
    expect(parseDssOnline({ ...REAL_OK, data: { ...REAL_OK.data, status: '0' } })).toBe(false);
    expect(parseDssOnline({ ...REAL_OK, data: { ...REAL_OK.data, status: null } })).toBeNull();
  });

  it('any other code is unknown (null) — never guessed as offline', () => {
    for (const code of [4000, 1001, 5001, undefined]) expect(parseDssOnline({ code, data: null })).toBeNull();
    expect(parseDssReading({ code: 4000, desc: 'x', data: REAL_OK.data }, '1').location).toBeNull();
  });

  it('(0,0), out-of-range and non-numeric coordinates give no location (status still read)', () => {
    const zero = { ...REAL_OK, data: { ...REAL_OK.data, gpsX: 0, gpsY: 0 } };
    expect(parseDssReading(zero, '1000067')).toMatchObject({ online: true, location: null });
    for (const bad of [
      { gpsY: 91, gpsX: 100 },
      { gpsY: 13, gpsX: 181 },
      { gpsY: 'abc', gpsX: 100 },
      { gpsY: null, gpsX: 100 },
    ]) {
      expect(parseDssLocation({ ...REAL_OK, data: { ...REAL_OK.data, ...bad } })).toBeNull();
    }
  });

  it('string coordinates still work; a missing updateTime leaves recordedAt null', () => {
    const payload = { ...REAL_OK, data: { ...REAL_OK.data, gpsX: '100.5', gpsY: '13.7', updateTime: null } };
    expect(parseDssLocation(payload)).toMatchObject({ lat: 13.7, lng: 100.5, recordedAt: null });
  });

  it('a malformed body is unknown with no location', () => {
    for (const body of [null, 'oops', [], { code: 1000 }, { code: 1000, data: 'x' }]) {
      expect(parseDssReading(body as never, '1')).toEqual({ vendorDeviceId: '1', online: null, location: null });
    }
  });
});

describe('parseDssUpdateTime / parseDssStatus', () => {
  it('seconds, milliseconds, and garbage', () => {
    expect(parseDssUpdateTime(1773248077)?.getTime()).toBe(1773248077_000);
    expect(parseDssUpdateTime(1773248077_000)?.getTime()).toBe(1773248077_000);
    for (const bad of [0, -5, 'x', null, undefined, '']) expect(parseDssUpdateTime(bad as never)).toBeNull();
  });

  it('status "1" / 1 / "0" / missing', () => {
    expect(parseDssStatus('1')).toBe(true);
    expect(parseDssStatus(1)).toBe(true);
    expect(parseDssStatus('0')).toBe(false);
    expect(parseDssStatus(null)).toBeNull();
    expect(parseDssStatus('')).toBeNull();
  });
});

describe('parseDssDeviceList', () => {
  const row = {
    deviceCode: '1000067',
    deviceName: ' BWC-01 ',
    deviceType: '5',
    deviceTypeName: 'MPT',
    deviceModel: 'DH-MPT230',
    serialNo: 'SN1',
    status: 1,
  };

  it('reads the paged shape { totalCount, pageData }', () => {
    expect(parseDssDeviceList({ code: 1000, data: { totalCount: '1', pageData: [row] } })).toEqual({
      devices: [
        {
          vendorDeviceId: '1000067',
          deviceName: 'BWC-01',
          vendorType: 'MPT',
          model: 'DH-MPT230',
          serialNo: 'SN1',
          online: true,
        },
      ],
      complete: true,
    });
  });

  it('reads a plain array (no totalCount ⇒ complete)', () => {
    const parsed = parseDssDeviceList({ code: 1000, data: [{ ...row, status: '0' }] });
    expect(parsed.complete).toBe(true);
    expect(parsed.devices[0].online).toBe(false);
  });

  it('totalCount above the rows sent ⇒ incomplete (a later page exists)', () => {
    expect(parseDssDeviceList({ code: 1000, data: { totalCount: 250, pageData: [row] } }).complete).toBe(false);
  });

  it('drops rows without deviceCode; numeric deviceType alone gives no vendorType', () => {
    const parsed = parseDssDeviceList({
      code: 1000,
      data: [{ deviceName: 'x' }, { deviceCode: ' 77 ', deviceType: '5' }],
    });
    expect(parsed.devices).toEqual([
      { vendorDeviceId: '77', deviceName: null, vendorType: null, model: null, serialNo: null, online: null },
    ]);
  });
});

// ---- the HTTP client against a local server

type Recorded = { method: string; url: string; headers: IncomingMessage['headers']; body: string };
const KEY = 'test-dss-api-key-0123456789abcdef';
const calls: Recorded[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let server: Server;
let baseUrl: string;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

const json = (res: ServerResponse, payload: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
};

const client = (timeoutMs = 2000) =>
  new DssHttpClient({ driver: 'dss', baseUrl, apiKey: KEY, timeoutMs, mockDevices: 100 });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    calls.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: await readBody(req) });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  calls.length = 0;
});

describe('DssHttpClient.fetchReading', () => {
  it('POSTs {deviceCode} to /api/v1/location with a fresh Bearer JWT per request', async () => {
    handler = (_req, res) => json(res, REAL_OK);
    const c = client();
    const reading = await c.fetchReading('1000067');
    await c.fetchReading('1000100');

    expect(reading.location?.lat).toBe(13.718384);
    expect(calls.map((x) => [x.method, x.url])).toEqual([
      ['POST', '/api/v1/location'],
      ['POST', '/api/v1/location'],
    ]);
    expect(JSON.parse(calls[0].body)).toEqual({ deviceCode: '1000067' });
    for (const call of calls) await verifyDssBearer(call.headers.authorization, KEY);
  });

  it('HTTP 200 with code 5000 ⇒ offline, resolves (not a failure)', async () => {
    handler = (_req, res) => json(res, REAL_NO_FIX);
    await expect(client().fetchReading('1000067')).resolves.toEqual({
      vendorDeviceId: '1000067',
      online: false,
      location: null,
    });
  });

  it('HTTP 200 with a body that is not JSON ⇒ unknown, no location', async () => {
    handler = (_req, res) => json(res, '<html>oops');
    await expect(client().fetchReading('1')).resolves.toEqual({ vendorDeviceId: '1', online: null, location: null });
  });

  it('HTTP 500 / 401 ⇒ throws once, no retry', async () => {
    handler = (_req, res) => json(res, 'boom', 500);
    await expect(client().fetchReading('1')).rejects.toThrow(/DSS replied 500/);
    handler = (_req, res) => json(res, { detail: 'Invalid or expired token' }, 401);
    await expect(client().fetchReading('1')).rejects.toThrow(/DSS replied 401/);
    expect(calls).toHaveLength(2);
  });

  it('a hung vendor is cut by the timeout', async () => {
    handler = () => {};
    await expect(client(150).fetchReading('1')).rejects.toThrow(/did not respond within 150 ms/);
  });

  it('headers sent then the body stalls: the same timeout cuts the body read (review #2)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"code":1000,');
    };
    const started = Date.now();
    await expect(client(150).fetchReading('1')).rejects.toThrow(/did not respond within 150 ms/);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('DssHttpClient.listDevices', () => {
  it('GETs /api/v1/devices with a Bearer JWT and parses the page', async () => {
    handler = (_req, res) =>
      json(res, { code: 1000, data: { totalCount: 1, pageData: [{ deviceCode: 'A1', deviceTypeName: 'MPT' }] } });
    const inventory = await client().listDevices();
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/devices' });
    await verifyDssBearer(calls[0].headers.authorization, KEY);
    expect(inventory.devices.map((d) => d.vendorDeviceId)).toEqual(['A1']);
    expect(inventory.complete).toBe(true);
    expect(inventory.fetchedAt).toBeInstanceOf(Date);
  });

  it('a refused list (code ≠ 1000) or a non-JSON body throws — never an empty list', async () => {
    handler = (_req, res) => json(res, { code: 4000, desc: 'denied', data: null });
    await expect(client().listDevices()).rejects.toThrow(/code=4000/);
    handler = (_req, res) => json(res, 'not json');
    await expect(client().listDevices()).rejects.toThrow(/JSON/);
  });
});
