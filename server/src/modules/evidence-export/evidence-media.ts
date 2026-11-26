import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';

import { looksLikePlaylist } from '../streaming/hls-rewrite';
import { ExportFailure } from './evidence-export-failure';
import { LiveStreamProvider } from '../streaming/live-stream.provider';
import {
  coveredSeconds,
  mergeSegments,
  parsePlaylist,
  pickVariant,
  playlistSettled,
  type HlsSegment,
} from './hls-playlist';

/**
 * ดึง playback ของ DSS มาเป็น MP4 — worker ดึง segment เองทีละตัวแล้ว pipe เข้า ffmpeg ทาง stdin
 * ไม่ให้ ffmpeg ต่อเน็ตเอง: ทุก URL ต้องผ่าน deps.assertAllowed (กติกาเดียวกับ proxy ภาพสดที่ตรวจทุก segment)
 * และ `-protocol_whitelist pipe` ทำให้ ffmpeg อ่านไฟล์ในเครื่องไม่ได้แม้ playlist จะชี้ file:///
 */

export type MediaDeps = {
  fetchText(url: string, signal: AbortSignal): Promise<{ body: string; contentType: string | null }>;
  fetchBytes(url: string, signal: AbortSignal): Promise<Buffer>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  /** Throws unless the URL points at the allowed DSS media host (same rule as the live proxy). */
  assertAllowed(url: string): void;
};

// DSS may spend 60 seconds reading a segment upstream. Allow the gateway to finish
// before cancelling our request; the export signal still enforces the job deadline.
const REQUEST_TIMEOUT_MS = 90_000;
const SEGMENT_ATTEMPTS = 3;
const PLAYLIST_IDLE_LIMIT_MS = 60_000;

/**
 * segment สุดท้ายของ playback session (ท่อนสั้นที่ DSS ตัดตรง endTime) บน prod ไม่เคยส่งจบ —
 * export ที่ล้มด้วย timeout ทุกแถวค้างที่ segment สุดท้ายพอดี (2026-10-28) จึงขอ DSS เกินท้ายไปอีกนิด
 * แล้วดึงแค่ segment ที่ครอบช่วงที่ผู้ใช้เลือก (segmentsCovering) — ไม่แตะ segment สุดท้ายของ session เลย
 * ต้องยาวกว่า segment หนึ่งตัวของ DSS (4 วินาที) ไม่งั้นท่อนท้ายที่ต้องใช้ยังเป็นท่อนสั้นตัวสุดท้ายอยู่
 */
export const PLAYBACK_TAIL_PAD_SECONDS = 10;

/** endTime ที่ส่งให้ DSS — ไม่เลยเวลาปัจจุบัน (ช่วงที่ยังไม่เกิดไม่มีภาพให้ขอ) */
export function playbackRequestEnd(endAt: Date, now: Date): Date {
  const padded = endAt.getTime() + PLAYBACK_TAIL_PAD_SECONDS * 1000;
  return new Date(Math.max(endAt.getTime(), Math.min(padded, now.getTime())));
}

/** segment ตั้งแต่ตัวแรกจนครอบช่วงที่ขอ — ส่วนที่ DSS ส่งเกินมาจาก PLAYBACK_TAIL_PAD_SECONDS ไม่ต้องดึง */
export function segmentsCovering(segments: HlsSegment[], requestedSeconds: number): HlsSegment[] {
  let covered = 0;
  for (let i = 0; i < segments.length; i += 1) {
    covered += segments[i].durationSeconds;
    if (covered >= requestedSeconds) return segments.slice(0, i + 1);
  }
  return segments;
}

function withTimeout(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

/**
 * เหตุที่คำขอหนึ่งล้ม เป็นข้อความที่ผู้ใช้อ่านได้ — TimeoutError ของ AbortSignal.timeout มีแค่
 * "The operation was aborted due to timeout" ซึ่งไม่บอกว่ารออะไร นานเท่าไร
 */
function vendorFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `แพลตฟอร์มกล้องไม่ตอบภายใน ${REQUEST_TIMEOUT_MS / 1000} วินาที`;
  }
  return 'แพลตฟอร์มกล้องตอบกลับไม่สำเร็จ';
}

/** English text for the log only: the underlying error of a failed vendor call. */
const rawReason = (error: unknown): string => {
  // An ExportFailure message is Thai user text: the log gets its English detail only.
  if (error instanceof ExportFailure) return error.detail ?? 'export failure without detail';
  return error instanceof Error ? error.message : String(error);
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * fetch that follows redirects itself: Node would follow them to any host. Every hop goes through the
 * allowed-host rule, like the live proxy (`LiveStreamProvider.fetchMedia`). The first URL is checked by the caller.
 */
async function fetchAllowed(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, { signal: withTimeout(signal), redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (!location || hop === MAX_REDIRECTS) throw new ExportFailure('แพลตฟอร์มกล้องส่งต่อไปยังที่อื่นไม่ถูกต้อง', 'invalid or too many redirects');
    current = new URL(location, current).href;
    defaultMediaDeps.assertAllowed(current);
  }
  throw new ExportFailure('แพลตฟอร์มกล้องส่งต่อไปยังที่อื่นไม่ถูกต้อง', 'too many redirects');
}

export const defaultMediaDeps: MediaDeps = {
  async fetchText(url, signal) {
    const res = await fetchAllowed(url, signal);
    if (!res.ok) throw new ExportFailure(`แพลตฟอร์มกล้องตอบ ${res.status}`, `HTTP ${res.status}`);
    return { body: await res.text(), contentType: res.headers.get('content-type') };
  },
  async fetchBytes(url, signal) {
    const res = await fetchAllowed(url, signal);
    if (!res.ok) throw new ExportFailure(`แพลตฟอร์มกล้องตอบ ${res.status}`, `HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason instanceof Error ? signal.reason : new ExportFailure('ยกเลิกแล้ว', 'aborted'));
        },
        { once: true },
      );
    });
  },
  now: () => Date.now(),
  assertAllowed: (url) => {
    new LiveStreamProvider().assertAllowed(url);
  },
};

export type CollectedMedia = {
  segments: HlsSegment[];
  mapUrl: string | null;
  /** demuxer ของ ffmpeg ที่ต้องใช้อ่าน stdin — `mov` = fMP4 (มี EXT-X-MAP) */
  inputFormat: 'mpegts' | 'mov';
};

async function loadPlaylist(url: string, deps: MediaDeps, signal: AbortSignal) {
  deps.assertAllowed(url);
  let fetched: Awaited<ReturnType<MediaDeps['fetchText']>>;
  try {
    fetched = await deps.fetchText(url, signal);
  } catch (error) {
    // งานถูกยกเลิก / เกินเวลาทั้งงาน = เหตุของงานเอง ส่งต่อตามเดิม
    if (signal.aborted) throw error;
    throw new ExportFailure(`ดึง playlist ไม่สำเร็จ: ${vendorFailure(error)}`, rawReason(error));
  }
  const { body, contentType } = fetched;
  if (!looksLikePlaylist(contentType, body)) {
    throw new ExportFailure('แพลตฟอร์มกล้องไม่ได้ส่ง playlist กลับมา', 'response is not an HLS playlist');
  }
  return parsePlaylist(body, url);
}

export async function collectSegments(
  vendorUrl: string,
  requestedSeconds: number,
  deps: MediaDeps,
  signal: AbortSignal,
): Promise<CollectedMedia> {
  let playlistUrl = vendorUrl;
  let playlist = await loadPlaylist(playlistUrl, deps, signal);
  if (playlist.kind === 'master') {
    const variant = pickVariant(playlist.variants);
    if (!variant) throw new ExportFailure('playlist หลักไม่มี variant ให้เลือก', 'master playlist has no variant');
    playlistUrl = variant.url;
    playlist = await loadPlaylist(playlistUrl, deps, signal);
    if (playlist.kind === 'master') throw new ExportFailure('playlist ซ้อนกันหลายชั้น — ยังไม่รองรับ', 'nested master playlists');
  }
  if (playlist.unsupported) throw new ExportFailure(playlist.unsupported, playlist.unsupportedDetail ?? 'unsupported playlist');

  let segments = playlist.segments;
  let lastGrowthAt = deps.now();
  // playback บางแบบป้อน segment ทีละน้อย (ไม่มี ENDLIST) — โหลดซ้ำจนครบช่วงหรือนิ่งเกิน 60 วินาที
  while (
    !playlistSettled({
      endList: playlist.endList,
      coveredSeconds: coveredSeconds(segments),
      requestedSeconds,
      targetDurationSeconds: playlist.targetDurationSeconds,
      idleMs: deps.now() - lastGrowthAt,
      idleLimitMs: PLAYLIST_IDLE_LIMIT_MS,
    })
  ) {
    const waitMs = Math.max(1000, ((playlist.targetDurationSeconds ?? 2) * 1000) / 2);
    await deps.sleep(waitMs, signal);
    const next = await loadPlaylist(playlistUrl, deps, signal);
    if (next.kind !== 'media') throw new ExportFailure('playlist เปลี่ยนรูปแบบระหว่างโหลดซ้ำ', 'playlist changed kind on reload');
    if (next.unsupported) throw new ExportFailure(next.unsupported, next.unsupportedDetail ?? 'unsupported playlist');
    const merged = mergeSegments(segments, next.segments);
    if (merged.length > segments.length) lastGrowthAt = deps.now();
    segments = merged;
    playlist = next;
  }

  if (segments.length === 0) throw new ExportFailure('ไม่พบภาพในช่วงเวลานี้ (playlist ว่าง)', 'playlist has no segments');
  return {
    segments: segmentsCovering(segments, requestedSeconds),
    mapUrl: playlist.mapUrl,
    inputFormat: playlist.mapUrl ? 'mov' : 'mpegts',
  };
}

/**
 * remux โดยไม่ re-encode ภาพ (เร็ว ใช้ CPU น้อย) · เสียงแปลงเป็น AAC เพราะกล้องบางรุ่นส่ง G.711 ที่ MP4 ใส่ไม่ได้
 * `0:a:0?` = ไม่มีเสียงก็ไม่ล้ม · `+faststart` = เปิดเล่นได้ทันทีโดยไม่ต้องโหลดทั้งไฟล์
 */
export function ffmpegRemuxArgs(inputFormat: CollectedMedia['inputFormat'], outFile: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-protocol_whitelist', 'pipe',
    '-fflags', '+genpts+discardcorrupt',
    '-f', inputFormat,
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-y', outFile,
  ];
}

/** `label` = segment ที่เท่าไรจากทั้งหมด — ข้อความล้มต้องบอกว่าค้างตรงไหนของช่วง ไม่งั้นไล่หาสาเหตุไม่ได้ */
async function fetchSegmentWithRetry(
  url: string,
  label: string,
  deps: MediaDeps,
  signal: AbortSignal,
): Promise<Buffer> {
  deps.assertAllowed(url);
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt += 1) {
    try {
      return await deps.fetchBytes(url, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt < SEGMENT_ATTEMPTS) await deps.sleep(attempt * 1000, signal);
    }
  }
  throw new ExportFailure(
    `ดึง ${label} ไม่สำเร็จ (ลองครบ ${SEGMENT_ATTEMPTS} ครั้ง): ${vendorFailure(lastError)}`,
    rawReason(lastError),
  );
}

/**
 * ทุก segment ต้องได้ครบ — ล้มหลังลองครบ 3 ครั้ง = ทั้งงานล้ม (ไม่ข้ามเงียบแบบ middleware ที่ทำให้ไฟล์หลักฐานขาดช่วง)
 * โหลด segment ทั้งก้อนก่อนเขียน: ถ้าลองใหม่กลางทาง ข้อมูลครึ่ง segment จะไม่หลุดเข้า ffmpeg
 */
export async function remuxToMp4(input: {
  media: CollectedMedia;
  outFile: string;
  ffmpegPath: string;
  deps: MediaDeps;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void | Promise<void>;
}): Promise<void> {
  const { media, deps, signal } = input;
  const child = spawn(input.ffmpegPath, ffmpegRemuxArgs(media.inputFormat, input.outFile), {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  const state: { stderr: string; spawnError: Error | null; exited: boolean } = {
    stderr: '',
    spawnError: null,
    exited: false,
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    state.stderr = (state.stderr + chunk).slice(-2000);
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      state.spawnError =
        error.code === 'ENOENT'
          ? new ExportFailure('ไม่พบโปรแกรมแปลงไฟล์บนเครื่องประมวลผล กรุณาแจ้งผู้ดูแลระบบ', `ffmpeg not found ('${input.ffmpegPath}'); install it or set FFMPEG_PATH`)
          : error;
      state.exited = true;
      resolve(null);
    });
    child.on('close', (code) => {
      state.exited = true;
      resolve(code);
    });
  });
  // ffmpeg ปิด stdin เองเมื่อล้ม — EPIPE ไม่ใช่สาเหตุจริง สาเหตุจริงอยู่ใน stderr
  child.stdin.on('error', () => undefined);

  const kill = () => child.kill('SIGKILL');
  signal.addEventListener('abort', kill, { once: true });

  const write = async (chunk: Buffer): Promise<boolean> => {
    if (state.exited) return false;
    if (!child.stdin.write(chunk)) {
      await Promise.race([once(child.stdin, 'drain'), exited]);
    }
    return !state.exited;
  };

  try {
    const total = media.segments.length;
    if (
      media.mapUrl &&
      !(await write(await fetchSegmentWithRetry(media.mapUrl, 'init segment', deps, signal)))
    ) {
      throw new ExportFailure('ตัวแปลงไฟล์หยุดก่อนรับ init segment', `ffmpeg stopped before the init segment: ${state.stderr.trim()}`);
    }
    for (let i = 0; i < total; i += 1) {
      const bytes = await fetchSegmentWithRetry(
        media.segments[i].url,
        `segment ${i + 1}/${total}`,
        deps,
        signal,
      );
      if (!(await write(bytes))) {
        // ffmpeg ปิดก่อนได้ครบ — ห้ามปล่อยไฟล์ที่ขาดช่วงออกไปเป็นหลักฐาน แม้ exit code จะเป็น 0
        await exited;
        // Killed by our own abort (timeout / shutdown): that reason is the real cause, not "ffmpeg stopped".
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new ExportFailure('ยกเลิกการแปลงไฟล์', 'aborted');
        }
        throw new ExportFailure(
          `ตัวแปลงไฟล์หยุดก่อนได้ภาพครบ (segment ${i + 1}/${total})`,
          `ffmpeg stopped early at segment ${i + 1}/${total}: ${state.stderr.trim()}`,
        );
      }
      await input.onProgress(i + 1, total);
    }
    child.stdin.end();
    const code = await exited;
    if (state.spawnError) throw state.spawnError;
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new ExportFailure('ยกเลิกการแปลงไฟล์', 'aborted');
    }
    if (code !== 0) {
      const detail = state.stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
      throw new ExportFailure('แปลงไฟล์ไม่สำเร็จ', `ffmpeg exit ${String(code)}${detail ? `: ${detail}` : ''}`);
    }
  } catch (error) {
    kill();
    await exited;
    throw state.spawnError ?? error;
  } finally {
    signal.removeEventListener('abort', kill);
  }
}

/** SHA-256 + ขนาดของไฟล์ที่ได้ — เก็บไว้ในแถว ให้ตรวจภายหลังได้ว่าไฟล์ที่ส่งต่อกันไม่ถูกแก้ */
export async function fileDigest(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), size };
}
