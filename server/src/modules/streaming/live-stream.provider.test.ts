import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveStreamProvider } from './live-stream.provider';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function provider() {
  vi.stubEnv('DSS_DRIVER', 'dss');
  vi.stubEnv('DSS_BASE_URL', 'https://dss.test');
  vi.stubEnv('DSS_API_KEY', 'test-api-key-long-enough-for-signing');
  vi.stubEnv('STREAM_ALLOWED_HOSTS', 'media.test');
  return new LiveStreamProvider();
}
describe('LiveStreamProvider', () => {
  it('requests the vendor channel with a fresh DSS JWT and validates the returned media host', async () => {
    const p = provider();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1000, data: { video_url: 'https://media.test/live/index.m3u8' } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await p.requestLive('vendor-42', 1)).toEqual({ vendorUrl: 'https://media.test/live/index.m3u8', vendorSessionId: 'vendor-42$1$0$0' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://dss.test/api/v1/stream');
    expect(init.headers.Authorization).toMatch(/^Bearer ey/);
    expect(JSON.parse(init.body)).toEqual({ User: 'true', deviceCode: 'vendor-42', channelId: 'vendor-42$1$0$0' });
  });
  it('refuses unlisted hosts, credentials and non-http media URLs', () => {
    const p = provider();
    for (const url of ['https://other.test/a', 'https://user:pass@media.test/a', 'file:///a', 'https://media.test.evil/a']) expect(() => p.assertAllowed(url)).toThrow();
    expect(() => p.assertAllowed('https://media.test/a')).not.toThrow();
  });
  it('checks each redirect before issuing the next media request', async () => {
    const p = provider();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/secret' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(p.fetchMedia('https://media.test/a')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it('reads binary media without forwarding DSS credentials', async () => {
    const p = provider();
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 1, 255]), { headers: { 'Content-Type': 'video/mp2t' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await p.fetchMedia('https://media.test/a.ts');
    expect(result.body).toEqual(Buffer.from([0, 1, 255]));
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
});
