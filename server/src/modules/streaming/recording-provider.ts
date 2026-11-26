import { Injectable } from '@nestjs/common';
import { dssAuthorizationHeader, dssRequest } from '../../common/dss/dss-auth';
import { readDssConfig } from '../../common/dss/dss-config';
import { LiveStreamProvider } from './live-stream.provider';
import { dssDaysBackFor } from './recording-range';

export type RecordingFile = { startAt: Date; endAt: Date; durationSeconds: number };

const DSS_SUCCESS = 1000;
const DSS_NO_RECORDINGS = 1002;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const CHANNEL = 1;
const SEARCH_RETRY_DELAY_MS = 500;

function parseSeconds(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Math.round(seconds * 1000));
}

export function parseRecordings(payload: unknown): RecordingFile[] {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { list?: unknown } | null)?.list)
      ? (data as { list: unknown[] }).list
      : Array.isArray((data as { records?: unknown } | null)?.records)
        ? (data as { records: unknown[] }).records
        : [];
  const files: RecordingFile[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const startAt = parseSeconds(row.startTime);
    const endAt = parseSeconds(row.endTime);
    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) continue;
    files.push({ startAt, endAt, durationSeconds: Math.round((endAt.getTime() - startAt.getTime()) / 1000) });
  }
  return files.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

@Injectable()
export class RecordingProvider {
  constructor(private readonly live: LiveStreamProvider) {}

  async search(vendorDeviceId: string, from: Date, to: Date): Promise<RecordingFile[]> {
    const config = readDssConfig(process.env);
    const overlaps = (file: RecordingFile) => file.endAt.getTime() > from.getTime() && file.startAt.getTime() < to.getTime();
    if (config.driver !== 'dss') {
      const dayStart = Math.floor((from.getTime() + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
      const at = (hours: number, minutes = 0) => new Date(dayStart + hours * 3_600_000 + minutes * 60_000);
      const make = (startAt: Date, endAt: Date): RecordingFile => ({
        startAt,
        endAt,
        durationSeconds: (endAt.getTime() - startAt.getTime()) / 1000,
      });
      return [make(at(8), at(10)), make(at(13), at(13, 45))].filter(overlaps);
    }
    if (!config.baseUrl || !config.apiKey) throw new Error('DSS recording search requires DSS_BASE_URL and DSS_API_KEY');
    // The middleware sometimes fails the first search after a while (its DSS login warms up); try once more
    // before telling the user. "No recordings" (1002) is an answer, not a failure, so it is never retried.
    const dss = { baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: config.timeoutMs };
    try {
      return await this.searchOnce(dss, vendorDeviceId, from, to);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_RETRY_DELAY_MS));
      return this.searchOnce(dss, vendorDeviceId, from, to);
    }
  }

  private async searchOnce(
    config: { baseUrl: string; apiKey: string; timeoutMs: number },
    vendorDeviceId: string,
    from: Date,
    to: Date,
  ): Promise<RecordingFile[]> {
    const overlaps = (file: RecordingFile) => file.endAt.getTime() > from.getTime() && file.startAt.getTime() < to.getTime();
    const response = await dssRequest(`${config.baseUrl}/api/v1/recording/search`, {
      method: 'POST',
      headers: { Authorization: await dssAuthorizationHeader(config.apiKey), 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ channelId: `${vendorDeviceId}$${CHANNEL}$0$0`, daysBack: dssDaysBackFor(from) }),
    }, config.timeoutMs);
    if (!response.ok) throw new Error(`DSS recording search returned HTTP ${response.status}`);
    const payload = parseJson(response.text);
    const code = (payload as { code?: unknown } | null)?.code;
    if (code === DSS_NO_RECORDINGS) return [];
    if (code !== DSS_SUCCESS) throw new Error(`DSS recording search failed (code=${String(code)})`);
    return parseRecordings(payload).filter(overlaps);
  }

  async requestPlayback(
    vendorDeviceId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ vendorUrl: string; vendorSessionId: string } | 'no-recordings'> {
    const config = readDssConfig(process.env);
    if (config.driver !== 'dss' || !config.baseUrl || !config.apiKey) throw new Error('Playback requires DSS_DRIVER=dss');
    const channelId = `${vendorDeviceId}$${CHANNEL}$0$0`;
    const response = await dssRequest(`${config.baseUrl}/api/v1/playback`, {
      method: 'POST',
      headers: { Authorization: await dssAuthorizationHeader(config.apiKey), 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        deviceCode: vendorDeviceId,
        channelId,
        startTime: String(Math.floor(startAt.getTime() / 1000)),
        endTime: String(Math.floor(endAt.getTime() / 1000)),
      }),
    }, config.timeoutMs);
    if (!response.ok) throw new Error(`DSS playback request returned HTTP ${response.status}`);
    const payload = parseJson(response.text) as { code?: unknown; data?: { video_url?: unknown } } | null;
    if (payload?.code === DSS_NO_RECORDINGS) return 'no-recordings';
    if (payload?.code !== DSS_SUCCESS) throw new Error(`DSS playback failed (code=${String(payload?.code)})`);
    const videoUrl = payload.data?.video_url;
    if (typeof videoUrl !== 'string') throw new Error('DSS did not return a playback url');
    this.live.assertAllowed(videoUrl);
    return { vendorUrl: videoUrl, vendorSessionId: channelId };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('DSS returned an invalid JSON body');
  }
}
