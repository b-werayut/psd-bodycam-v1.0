import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultMediaDeps } from './evidence-media';

beforeEach(() => {
  vi.stubEnv('STREAM_ALLOWED_HOSTS', 'camera.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function slowMediaResponse(delayMs: number) {
  vi.useFakeTimers();
  // Node's native timeout clock isn't replaced by Vitest's fake timers.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const signal = init.signal!;
    return new Response(new ReadableStream({
      start(stream) {
        const abort = () => stream.error(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        setTimeout(() => {
          signal.removeEventListener('abort', abort);
          if (!signal.aborted) {
            stream.enqueue(new TextEncoder().encode('complete segment'));
            stream.close();
          }
        }, delayMs);
      },
    }), { headers: { 'content-type': 'video/mp2t' } });
  });
}

describe('evidence media HTTP timeout', () => {
  it('allows a segment to finish within the DSS gateway 60-second read window', async () => {
    slowMediaResponse(45_000);
    const result = defaultMediaDeps.fetchBytes('https://camera.test/last.ts', new AbortController().signal);
    const assertion = expect(result).resolves.toEqual(Buffer.from('complete segment'));

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(45_000)]);
  });

  it('still stops a stalled segment instead of waiting indefinitely', async () => {
    slowMediaResponse(120_000);
    const result = defaultMediaDeps.fetchBytes('https://camera.test/last.ts', new AbortController().signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(90_000)]);
  });

  it('cancels immediately when the export is cancelled', async () => {
    slowMediaResponse(45_000);
    const controller = new AbortController();
    const result = defaultMediaDeps.fetchBytes('https://camera.test/last.ts', controller.signal);
    const assertion = expect(result).rejects.toThrow('export cancelled');
    await vi.advanceTimersByTimeAsync(1000);

    controller.abort(new Error('export cancelled'));

    await assertion;
  });
});

describe('evidence media redirects', () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it('a redirect to a host that is not allowed fails and that host is never fetched', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      defaultMediaDeps.fetchBytes('https://camera.test/last.ts', new AbortController().signal),
    ).rejects.toThrow(/host is not allowed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('a same-host redirect still works', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect('/moved/list.m3u8'))
      .mockResolvedValueOnce(new Response('#EXTM3U', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await defaultMediaDeps.fetchText('https://camera.test/list.m3u8', new AbortController().signal);

    expect(result.body).toBe('#EXTM3U');
    expect(fetchMock.mock.calls[1][0]).toBe('https://camera.test/moved/list.m3u8');
  });

  it('too many redirects fails', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(redirect('/again')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      defaultMediaDeps.fetchBytes('https://camera.test/a.ts', new AbortController().signal),
    ).rejects.toThrow(/ส่งต่อ/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
