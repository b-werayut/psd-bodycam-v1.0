export type RewriteOptions = {
  baseUrl: string;
  toProxyUrl: (absoluteVendorUrl: string) => string;
};

const URI_ATTR = /URI="([^"]*)"/g;

export function rewritePlaylist(body: string, options: RewriteOptions): string {
  const lines = body.split(/\r?\n/);
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      if (!URI_ATTR.test(trimmed)) return line;
      URI_ATTR.lastIndex = 0;
      return line.replace(URI_ATTR, (_match, uri: string) => {
        if (!uri) return 'URI=""';
        return `URI="${options.toProxyUrl(resolve(uri, options.baseUrl))}"`;
      });
    }

    return options.toProxyUrl(resolve(trimmed, options.baseUrl));
  });
  return out.join('\n');
}

function resolve(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

export function looksLikePlaylist(contentType: string | null, body: string): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('mpegurl')) return true;
  return body.trimStart().startsWith('#EXTM3U');
}
