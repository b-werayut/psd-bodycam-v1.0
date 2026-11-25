import { Injectable } from '@nestjs/common';
import { dssAuthorizationHeader, dssRequest } from '../../common/dss/dss-auth';
import { readDssConfig } from '../../common/dss/dss-config';

export type MediaResponse = { body: Buffer; contentType: string; url: string; status: number; contentRange: string | null };

/** DSS owns the shared channel stream. Closing a viewer revokes our ticket, never another viewer's feed. */
@Injectable()
export class LiveStreamProvider {
  assertAllowed(raw: string): URL {
    const url = new URL(raw);
    const explicit = process.env.STREAM_ALLOWED_HOSTS?.trim();
    const hosts = explicit
      ? explicit.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
      : [process.env.STREAM_API_URL, process.env.DSS_BASE_URL].filter(Boolean).map((value) => new URL(value!).hostname.toLowerCase());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hosts.includes(url.hostname.toLowerCase())) {
      throw new Error('DSS media host is not allowed');
    }
    return url;
  }

  async requestLive(vendorDeviceId: string, channel: number): Promise<{ vendorUrl: string; vendorSessionId: string }> {
    const config = readDssConfig(process.env);
    if (config.driver !== 'dss' || !config.baseUrl || !config.apiKey) throw new Error('Live streaming requires DSS_DRIVER=dss');
    const endpoint = process.env.STREAM_API_URL?.trim() || `${config.baseUrl}/api/v1/stream`;
    const channelId = `${vendorDeviceId}$${channel}$0$0`;
    const response = await dssRequest(endpoint, {
      method: 'POST',
      headers: { Authorization: await dssAuthorizationHeader(config.apiKey), 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ User: 'true', deviceCode: vendorDeviceId, channelId }),
    }, config.timeoutMs);
    if (!response.ok) throw new Error(`DSS stream request returned HTTP ${response.status}`);
    const payload = JSON.parse(response.text) as { code?: number; data?: { video_url?: unknown } };
    if (payload.code !== 1000 || typeof payload.data?.video_url !== 'string') throw new Error('DSS did not return a live stream');
    this.assertAllowed(payload.data.video_url);
    return { vendorUrl: payload.data.video_url, vendorSessionId: channelId };
  }

  /** One deadline covers redirects and the entire body. URLs are checked before every hop. */
  async fetchMedia(raw: string, range?: string): Promise<MediaResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let url = raw;
    try {
      for (let hop = 0; hop <= 3; hop++) {
        this.assertAllowed(url);
        const response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: range ? { Range: range } : {} });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || hop === 3) throw new Error('Invalid DSS media redirect');
          url = new URL(location, url).href;
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`DSS media returned HTTP ${response.status}`); }
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const limit = /mpegurl/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(url) ? 2 * 1024 * 1024 : 32 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('DSS media is too large'); }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (reader) {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > limit) { await reader.cancel(); throw new Error('DSS media is too large'); }
            chunks.push(chunk.value);
          }
        }
        return { body: Buffer.concat(chunks), contentType, url, status: response.status, contentRange: response.headers.get('content-range') };
      }
      throw new Error('Too many DSS redirects');
    } finally { clearTimeout(timer); }
  }
}
