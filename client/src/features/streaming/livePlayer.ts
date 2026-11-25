export type PlaybackMode = 'native' | 'hlsjs' | 'none';
export type LiveTarget = { deviceCode: string; deviceName: string | null; onlineStatus?: number | null };

export function playbackMode(input: { canPlayNativeHls: boolean; hlsJsSupported: boolean }): PlaybackMode {
  return input.hlsJsSupported ? 'hlsjs' : input.canPlayNativeHls ? 'native' : 'none';
}

export function hasMediaSource(scope: { MediaSource?: unknown; ManagedMediaSource?: unknown; WebKitMediaSource?: unknown }): boolean {
  return Boolean(scope.ManagedMediaSource || scope.MediaSource || scope.WebKitMediaSource);
}

export function playbackErrorText(message: string, detail: string | null | undefined): string {
  return detail?.trim() ? `${message} (${detail.trim()})` : message;
}

export function canPlayNativeHls(video: Pick<HTMLVideoElement, 'canPlayType'>): boolean {
  return Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'));
}
