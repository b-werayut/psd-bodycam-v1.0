/**
 * อ่าน HLS playlist ที่ DSS ส่งมาสำหรับ playback — ใช้ตอนแปลงเป็น MP4 (worker ดึง segment เองแล้ว pipe เข้า ffmpeg)
 * pure ทั้งไฟล์: ไม่มี network ไม่มี clock
 */

export type HlsSegment = { url: string; durationSeconds: number; sequence: number };

export type HlsVariant = { url: string; bandwidth: number | null };

export type HlsMediaPlaylist = {
  kind: 'media';
  segments: HlsSegment[];
  /** `#EXT-X-MAP` = segment แบบ fMP4 ต้องส่ง init segment ก่อน · null = MPEG-TS */
  mapUrl: string | null;
  targetDurationSeconds: number | null;
  endList: boolean;
  /** เหตุที่แปลงไม่ได้ (null = แปลงได้) — ตรวจครั้งเดียวที่นี่ ผู้เรียกไม่ต้องรู้รายละเอียดของ tag */
  unsupported: string | null;
  /** English text for the server log only (never shown to the user): the tag value behind `unsupported`. */
  unsupportedDetail: string | null;
};

export type HlsMasterPlaylist = { kind: 'master'; variants: HlsVariant[] };

export type HlsPlaylist = HlsMediaPlaylist | HlsMasterPlaylist;

// A name starts the list or follows a comma: anchoring it keeps a long unbroken run of name
// characters from being rescanned at every position (SonarQube S8786)
const ATTR = /(?:^|,)\s*([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = line.slice(line.indexOf(':') + 1);
  for (const match of body.matchAll(ATTR)) {
    out[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return out;
}

function resolveUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

export function parsePlaylist(body: string, baseUrl: string): HlsPlaylist {
  const lines = body.split(/\r?\n/).map((line) => line.trim());

  if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: HlsVariant[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const uri = lines.slice(i + 1).find((line) => line && !line.startsWith('#'));
      if (!uri) continue;
      const bandwidth = Number(attributes(lines[i]).BANDWIDTH);
      variants.push({
        url: resolveUrl(uri, baseUrl),
        bandwidth: Number.isFinite(bandwidth) ? bandwidth : null,
      });
    }
    return { kind: 'master', variants };
  }

  const segments: HlsSegment[] = [];
  let sequence = 0;
  let pendingDuration: number | null = null;
  let mapUrl: string | null = null;
  let targetDurationSeconds: number | null = null;
  let endList = false;
  let unsupported: string | null = null;
  let unsupportedDetail: string | null = null;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const value = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
      if (Number.isInteger(value) && value >= 0) sequence = value;
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const value = Number(line.slice('#EXT-X-TARGETDURATION:'.length));
      if (Number.isFinite(value) && value > 0) targetDurationSeconds = value;
    } else if (line.startsWith('#EXTINF:')) {
      const value = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      pendingDuration = Number.isFinite(value) && value >= 0 ? value : 0;
    } else if (line.startsWith('#EXT-X-MAP')) {
      const uri = attributes(line).URI;
      if (!uri) continue;
      const resolved = resolveUrl(uri, baseUrl);
      if (mapUrl && mapUrl !== resolved) {
        unsupported ??= 'playlist มี init segment (EXT-X-MAP) หลายชุด';
        unsupportedDetail ??= 'playlist has several EXT-X-MAP init segments';
      }
      mapUrl ??= resolved;
    } else if (line.startsWith('#EXT-X-KEY')) {
      const method = (attributes(line).METHOD ?? '').toUpperCase();
      if (method && method !== 'NONE') {
        unsupported ??= 'playlist ถูกเข้ารหัส — ยังไม่รองรับการแปลง';
        unsupportedDetail ??= `playlist is encrypted (EXT-X-KEY METHOD=${method.slice(0, 40)})`;
      }
    } else if (line.startsWith('#EXT-X-BYTERANGE')) {
      unsupported ??= 'playlist ใช้ segment แบบ byte-range — ยังไม่รองรับการแปลง';
      unsupportedDetail ??= 'playlist uses EXT-X-BYTERANGE segments';
    } else if (line === '#EXT-X-ENDLIST') {
      endList = true;
    } else if (!line.startsWith('#')) {
      segments.push({
        url: resolveUrl(line, baseUrl),
        durationSeconds: pendingDuration ?? 0,
        sequence,
      });
      sequence += 1;
      pendingDuration = null;
    }
  }

  return { kind: 'media', segments, mapUrl, targetDurationSeconds, endList, unsupported, unsupportedDetail };
}

/** ภาพหลักฐานเอาคุณภาพสูงสุด — bandwidth ไม่ระบุนับเป็น 0 · เท่ากันเอาตัวแรก */
export function pickVariant(variants: HlsVariant[]): HlsVariant | null {
  let best: HlsVariant | null = null;
  for (const variant of variants) {
    if (!best || (variant.bandwidth ?? 0) > (best.bandwidth ?? 0)) best = variant;
  }
  return best;
}

/** playlist ที่โหลดซ้ำ (ยังไม่มี ENDLIST) — รวม segment ใหม่ต่อท้ายโดยไม่ซ้ำ ใช้ media sequence เป็นตัวตน */
export function mergeSegments(known: HlsSegment[], fresh: HlsSegment[]): HlsSegment[] {
  const last = known.length ? known[known.length - 1].sequence : -1;
  return [...known, ...fresh.filter((segment) => segment.sequence > last)];
}

export function coveredSeconds(segments: HlsSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
}

/**
 * playlist ที่ไม่มี ENDLIST จะรอต่อหรือพอแล้ว — ครบช่วงที่ขอ (เผื่อหนึ่ง segment) หรือไม่มี segment ใหม่นานเกิน idle
 * ไม่ล้มเมื่อได้ไม่ครบ: ไฟล์ที่ได้อาจสั้นกว่าช่วงที่ขอ — MediaSeconds บันทึกไว้ในแถว แต่หน้าจอยังไม่แสดงค่านี้
 */
export function playlistSettled(input: {
  endList: boolean;
  coveredSeconds: number;
  requestedSeconds: number;
  targetDurationSeconds: number | null;
  idleMs: number;
  idleLimitMs: number;
}): boolean {
  if (input.endList) return true;
  const tolerance = input.targetDurationSeconds ?? 2;
  if (input.coveredSeconds >= input.requestedSeconds - tolerance) return true;
  return input.idleMs >= input.idleLimitMs;
}
