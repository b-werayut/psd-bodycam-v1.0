const NAMESPACE = '/realtime';

export function realtimeTarget(apiBase: string | undefined): string {
  const base = (apiBase ?? '').trim();

  if (!base || base.startsWith('/')) return NAMESPACE;

  try {
    return new URL(base).origin + NAMESPACE;
  } catch {
    return NAMESPACE;
  }
}
