import {
  metersBetween,
  secondsBetween,
  staleRunAt,
  STALE_START_RULES,
  type RoutePoint,
  type StaleStartRules,
} from './stale-start';

// Port of the reference route-builder.ts without road matching (no OSRM: no movingRuns /
// matchSegments). The stale-start rule lives in stale-start.ts, shared with the GPS ingest.

export type { RoutePoint } from './stale-start';

export type RouteRules = {
  stopRadiusM: number;
  stopMinMinutes: number;
  gapSeconds: number;
};

export type LatLng = { lat: number; lng: number };

export type RouteStop = {
  kind: 'stop';
  index: number;
  startAt: Date;
  endAt: Date;
  seconds: number;
  lat: number;
  lng: number;
  noSignalSeconds: number;
};

export type RouteGap = {
  kind: 'gap';
  startAt: Date;
  endAt: Date;
  seconds: number;
  from: LatLng;
  to: LatLng;
};

export type RouteEndpoint = { lat: number; lng: number; at: Date };

export type DrawnLine = Array<[number, number]>;

export type BuiltRoute = {
  start: RouteEndpoint | null;
  end: RouteEndpoint | null;
  segments: DrawnLine[];
  gaps: RouteGap[];
  timeline: Array<RouteStop | RouteGap>;
  /** จุดแรกหลังกล้องเพิ่งเชื่อมต่อที่เป็นพิกัดค้าง/พิกัดเพี้ยน จึงไม่ใช้เป็นจุดเริ่มและไม่นำมาวาด (ข้อมูลดิบยังอยู่ครบ) */
  staleStartCount: number;
  /** จุดที่ GPS เด้งออกไปแล้วกลับที่เดิม จึงไม่นำมาวาดและไม่นำมาหาจุดแวะ (ข้อมูลดิบยังอยู่ครบ) */
  spikeCount: number;
  /** จุดที่ถูกเลื่อนไปค่ากลางของจุดข้างเคียงเพราะกล้องแทบไม่ขยับ (ข้อมูลดิบยังอยู่ครบ) */
  smoothedCount: number;
};

export const MAX_DRAWN_POINTS = 2000;
const INITIAL_EPSILON_M = 5;
const MAX_SIMPLIFY_ROUNDS = 20;

/**
 * เกณฑ์ "เด้งไป-กลับ" — GPS สะท้อนตึก/อยู่ในอาคาร โยนพิกัดออกไปหลายร้อยเมตรถึงหลายกิโลแล้วจุดถัดไปกลับที่เดิม
 * ตัวกรอง 200 กม./ชม. ตอนรับข้อมูลจับไม่ได้ เพราะจุดห่างกัน 35–60 วิ ความเร็วที่คำนวณได้จึงแค่ 50–180
 *
 * ต้องครบทุกข้อ (เทียบกับจุดล่าสุดที่เก็บไว้ = anchor):
 * - ทุกจุดที่ออกไปห่าง anchor ≥ `minDistanceM` และออกไปติดกันไม่เกิน `maxPoints` จุด
 * - จุดถัดไปกลับมาใกล้ anchor ไม่เกิน `returnRatio` ของระยะที่ไกลที่สุด
 * - ไปกลับภายใน `maxSeconds` — นานกว่านั้นอาจไปจริงระหว่างที่ไม่มีสัญญาณ
 * - ความเร็วไปกลับขั้นต่ำ (2 × ระยะ ÷ เวลา) ≥ `minRoundTripKph` — เดินไปแล้วเดินกลับจึงไม่โดน
 * - ⚠️ ระยะที่ออกไป ≥ `contextFactor` × ระยะของช่วงก่อน anchor และหลังจุดที่กลับ — **ข้อนี้คือสิ่งที่กันรถกลับรถจริง**
 *   รถที่วิ่งอยู่ทุกช่วงยาวพอ ๆ กัน ปลายกลับรถจึงห่างไม่เกิน ~2 ช่วง ส่วน GPS เด้งออกจากกลุ่มจุดที่แทบไม่ขยับ
 *   ไม่มีช่วงรอบข้างให้เทียบเลย (มีแค่ 3 จุด) = ไม่ตัด
 *
 * ⚠️ แยกไม่ออก: รถจอดอยู่ ออกไปกลับรถแล้วกลับมาจอดจุดเดิมภายใน 3 จุด/5 นาที — หน้าตาเหมือน GPS เด้งทุกประการ
 * จึงต้องแสดงจำนวนจุดที่ตัดบนจอเสมอ ห้ามตัดเงียบ
 */
export const SPIKE_RULES = {
  minDistanceM: 250,
  returnRatio: 0.35,
  maxPoints: 3,
  maxSeconds: 300,
  minRoundTripKph: 30,
  contextFactor: 5,
} as const;

export type SpikeRules = { [K in keyof typeof SPIKE_RULES]: number };

/** จำนวนจุดตั้งแต่ `start` ที่เด้งออกไปจาก anchor (จุดล่าสุดใน `kept`) แล้วกลับ — 0 = ไม่ใช่ */
function spikeRunAt(
  points: RoutePoint[],
  start: number,
  kept: RoutePoint[],
  rules: SpikeRules,
): number {
  const anchor = kept[kept.length - 1];
  let farthest = 0;
  for (let length = 1; length <= rules.maxPoints && start + length < points.length; length += 1) {
    const distance = metersBetween(anchor, points[start + length - 1]);
    if (distance < rules.minDistanceM) return 0;
    farthest = Math.max(farthest, distance);

    const back = points[start + length];
    const seconds = (back.at.getTime() - anchor.at.getTime()) / 1000;
    if (seconds > rules.maxSeconds) return 0;
    if (metersBetween(anchor, back) > farthest * rules.returnRatio) continue;
    if (((2 * farthest) / seconds) * 3.6 < rules.minRoundTripKph) continue;

    const neighbourLegs: number[] = [];
    if (kept.length >= 2) neighbourLegs.push(metersBetween(kept[kept.length - 2], anchor));
    const after = points[start + length + 1];
    if (after) neighbourLegs.push(metersBetween(back, after));
    if (neighbourLegs.length === 0) continue;
    if (farthest < rules.contextFactor * Math.max(...neighbourLegs)) continue;

    return length;
  }
  return 0;
}

/** ตัดจุดเด้งไป-กลับ — `keptIndex` = index ของจุดที่เหลือใน `points` (ใช้หาช่วงไม่มีสัญญาณจากจุดดิบ) */
export function dropSpikes(points: RoutePoint[], rules: SpikeRules = SPIKE_RULES) {
  const kept: RoutePoint[] = [];
  const keptIndex: number[] = [];
  let spikeCount = 0;
  let i = 0;
  while (i < points.length) {
    const run = kept.length > 0 ? spikeRunAt(points, i, kept, rules) : 0;
    if (run > 0) {
      spikeCount += run;
      i += run;
      continue;
    }
    kept.push(points[i]);
    keptIndex.push(i);
    i += 1;
  }
  return { kept, keptIndex, spikeCount };
}

/** ตัดพิกัดค้างตอนเพิ่งเชื่อมต่อ — `keptIndex` = index ของจุดที่เหลือใน `points` (ใช้หาช่วงไม่มีสัญญาณจากจุดดิบ) */
export function dropStaleStarts(
  points: RoutePoint[],
  gapSeconds: number,
  rules: StaleStartRules = STALE_START_RULES,
) {
  const kept: RoutePoint[] = [];
  const keptIndex: number[] = [];
  let staleStartCount = 0;
  let i = 0;
  while (i < points.length) {
    const startsSignal = i === 0 || secondsBetween(points[i - 1].at, points[i].at) > gapSeconds;
    const run = startsSignal ? staleRunAt(points, i, rules) : 0;
    if (run > 0) {
      staleStartCount += run;
      i += run;
      continue;
    }
    kept.push(points[i]);
    keptIndex.push(i);
    i += 1;
  }
  return { kept, keptIndex, staleStartCount };
}

/**
 * ปรับให้เรียบเฉพาะช่วงที่กล้อง "แทบไม่ขยับ" — GPS ในเมือง/ในอาคารแกว่งรอบจุดเดิมหลายร้อยเมตรแบบสุ่มทิศ
 * ซึ่งไม่ใช่รูปไป-กลับ `dropSpikes` จึงจับไม่ได้ (กล้อง 1000027 วันที่ 2026-10-07 ช่วง 14:00–15:50)
 *
 * - แทนพิกัดด้วยค่ามัธยฐานแยกแกน lat/lng ของจุดข้างเคียงข้างละ `halfWindow` จุด
 *   นับเฉพาะเพื่อนบ้านที่ห่างไม่เกิน 2 × `gapSeconds` (นิยามความสดเดียวกับช่วงขาดสัญญาณ)
 * - ⚠️ หน้าต่างต้องสมมาตรเสมอ (ข้างที่สั้นกว่ากำหนดขนาด) — หน้าต่างเบี้ยวที่ต้น/ปลายช่วงดึงจุดเข้าด้านในหนึ่งช่วงเต็ม
 *   จุดแรก/สุดท้ายของทั้งเส้นจึงไม่ถูกแตะ (หมุดเริ่ม/สิ้นสุดตรงกับข้อมูลจริง)
 * - ⚠️ **ทำเฉพาะหน้าต่างที่ระยะขจัด (จุดแรก→จุดสุดท้าย) ≤ `maxStraightness` ของระยะทางเดิน** — คือวนอยู่ที่เดิม
 *   ถ้าไม่มีข้อนี้ มัธยฐานแยกแกนจะตัดยอดโค้งของการเดินทางจริงบนถนนคดเคี้ยวออกนอกถนนได้ถึงหนึ่งช่วง
 *   (วัดกับข้อมูลจริง 1000027 วันที่ 2026-10-06 ได้ ~500 ม.) · มุมเลี้ยวตั้งฉากแบบผังตารางไม่โดนอยู่แล้ว
 * - ข้อจำกัดที่ยอมรับ: ปลายกลับรถ (ระยะขจัดเป็น 0) ถูกตัดมนไม่เกินหนึ่งช่วงระหว่างจุด
 */
export const SMOOTH_RULES = {
  halfWindow: 2,
  maxStraightness: 0.5,
} as const;

export type SmoothRules = { [K in keyof typeof SMOOTH_RULES]: number };

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function smoothStationary(
  points: RoutePoint[],
  gapSeconds: number,
  rules: SmoothRules = SMOOTH_RULES,
) {
  const maxNeighbourMs = 2 * gapSeconds * 1000;
  let smoothedCount = 0;
  const smoothed = points.map((point, i) => {
    let left = 0;
    while (
      left < rules.halfWindow &&
      i - left - 1 >= 0 &&
      point.at.getTime() - points[i - left - 1].at.getTime() <= maxNeighbourMs
    ) {
      left += 1;
    }
    let right = 0;
    while (
      right < rules.halfWindow &&
      i + right + 1 < points.length &&
      points[i + right + 1].at.getTime() - point.at.getTime() <= maxNeighbourMs
    ) {
      right += 1;
    }
    const half = Math.min(left, right);
    if (half === 0) return point;

    const window = points.slice(i - half, i + half + 1);
    let path = 0;
    for (let j = 1; j < window.length; j += 1) path += metersBetween(window[j - 1], window[j]);
    if (path === 0) return point;
    if (metersBetween(window[0], window[window.length - 1]) > path * rules.maxStraightness) {
      return point;
    }

    const lat = medianOf(window.map((p) => p.lat));
    const lng = medianOf(window.map((p) => p.lng));
    if (lat === point.lat && lng === point.lng) return point;
    smoothedCount += 1;
    return { at: point.at, lat, lng };
  });
  return { points: smoothed, smoothedCount };
}

type Silence = { startAt: Date; endAt: Date; seconds: number };

/**
 * ช่วงที่ไม่มีพิกัดเลยเกิน `gapSeconds` ระหว่างจุดดิบ index `from`..`to`
 * ⚠️ นับจากจุดดิบ ไม่ใช่จุดที่เหลือหลังตัด — จุดเด้งแปลว่ากล้องมีสัญญาณแต่พิกัดเพี้ยน
 * นับจากจุดที่เหลือจะเปลี่ยนการตัดจุดเด้งทุกครั้งให้กลายเป็น "ไม่มีสัญญาณ"
 */
function silencesBetween(
  points: RoutePoint[],
  from: number,
  to: number,
  gapSeconds: number,
): Silence[] {
  const out: Silence[] = [];
  for (let i = from + 1; i <= to; i += 1) {
    const seconds = secondsBetween(points[i - 1].at, points[i].at);
    if (seconds > gapSeconds) out.push({ startAt: points[i - 1].at, endAt: points[i].at, seconds });
  }
  return out;
}

type Cluster = { first: number; last: number; sumLat: number; sumLng: number; count: number };

/** จับกลุ่มจุดที่อยู่ในรัศมีจากจุดกึ่งกลางของกลุ่ม — กลุ่มข้ามช่วงขาดสัญญาณได้ (กรณีเข้าอาคารแล้วออกมาที่เดิม) */
function clusterPoints(points: RoutePoint[], radiusM: number) {
  const clusters: Cluster[] = [];
  const clusterOf: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const current = clusters[clusters.length - 1];
    if (current) {
      const distance = metersBetween(
        { lat: current.sumLat / current.count, lng: current.sumLng / current.count },
        point,
      );
      if (distance <= radiusM) {
        current.last = i;
        current.sumLat += point.lat;
        current.sumLng += point.lng;
        current.count += 1;
        clusterOf.push(clusters.length - 1);
        continue;
      }
    }
    clusters.push({ first: i, last: i, sumLat: point.lat, sumLng: point.lng, count: 1 });
    clusterOf.push(clusters.length - 1);
  }
  return { clusters, clusterOf };
}

export function buildRoute(raw: RoutePoint[], rules: RouteRules): BuiltRoute {
  if (raw.length === 0) {
    return {
      start: null,
      end: null,
      segments: [],
      gaps: [],
      timeline: [],
      staleStartCount: 0,
      spikeCount: 0,
      smoothedCount: 0,
    };
  }

  // ลำดับสำคัญ: ตัดพิกัดค้างก่อน — ไม่งั้น dropSpikes ใช้พิกัดค้างเป็น anchor
  // แล้วจึงตัดจุดเด้ง — ค่ามัธยฐานที่มีจุดเด้ง 2 กม. ปนอยู่ในหน้าต่างจะถูกดึงเพี้ยน
  const fresh = dropStaleStarts(raw, rules.gapSeconds);
  const { kept, keptIndex: despikedIndex, spikeCount } = dropSpikes(fresh.kept);
  const keptIndex = despikedIndex.map((i) => fresh.keptIndex[i]);
  const { points, smoothedCount } = smoothStationary(kept, rules.gapSeconds);
  const silences = (fromKept: number, toKept: number) =>
    silencesBetween(raw, keptIndex[fromKept], keptIndex[toKept], rules.gapSeconds);

  const minStopSeconds = rules.stopMinMinutes * 60;
  const { clusters, clusterOf } = clusterPoints(points, rules.stopRadiusM);
  const isStop = clusters.map(
    (cluster) => secondsBetween(points[cluster.first].at, points[cluster.last].at) >= minStopSeconds,
  );

  const stops: RouteStop[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    if (!isStop[clusterIndex]) return;
    const noSignalSeconds = silences(cluster.first, cluster.last).reduce(
      (sum, silence) => sum + silence.seconds,
      0,
    );
    const startAt = points[cluster.first].at;
    const endAt = points[cluster.last].at;
    stops.push({
      kind: 'stop',
      index: stops.length + 1,
      startAt,
      endAt,
      seconds: secondsBetween(startAt, endAt),
      lat: cluster.sumLat / cluster.count,
      lng: cluster.sumLng / cluster.count,
      noSignalSeconds,
    });
  });

  const gaps: RouteGap[] = [];
  const segments: RoutePoint[][] = [];
  let segment: RoutePoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const silent = silences(i - 1, i);
    if (silent.length > 0) {
      segments.push(segment);
      segment = [];
      const insideOneStop = clusterOf[i - 1] === clusterOf[i] && isStop[clusterOf[i]];
      if (!insideOneStop) {
        // ไม่มีจุดเด้ง = ช่วงเดียวระหว่าง prev กับ cur ตรงกับของเดิมทุกประการ
        // มีจุดเด้งคั่น = เวลาเป็นช่วงที่เงียบจริง แต่ปลายเส้นประเป็นจุดที่เชื่อถือได้ (prev/cur) ไม่ใช่จุดเด้ง
        const startAt = silent[0].startAt;
        const endAt = silent[silent.length - 1].endAt;
        gaps.push({
          kind: 'gap',
          startAt,
          endAt,
          seconds: secondsBetween(startAt, endAt),
          from: { lat: prev.lat, lng: prev.lng },
          to: { lat: cur.lat, lng: cur.lng },
        });
      }
    }
    segment.push(cur);
  }
  segments.push(segment);

  const timeline = [...stops, ...gaps.filter((gap) => gap.seconds >= minStopSeconds)].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  const first = points[0];
  const last = points[points.length - 1];
  return {
    start: { lat: first.lat, lng: first.lng, at: first.at },
    end: { lat: last.lat, lng: last.lng, at: last.at },
    segments: simplifySegments(segments),
    gaps,
    timeline,
    staleStartCount: fresh.staleStartCount,
    spikeCount,
    smoothedCount,
  };
}

type Xy = [number, number];

function toMeters(point: [number, number], origin: [number, number]): Xy {
  const kx = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  return [(point[1] - origin[1]) * kx, (point[0] - origin[0]) * 110_540];
}

function distanceToSegment(p: Xy, a: Xy, b: Xy): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker แบบ stack (ไม่ recursive — 17,000 จุดต่อ segment ได้โดยไม่ล้น stack) */
function douglasPeucker(line: DrawnLine, epsilonM: number): DrawnLine {
  if (line.length <= 2) return line.slice();
  const origin = line[0];
  const xy = line.map((point) => toMeters(point, origin));
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = -1;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceToSegment(xy[i], xy[start], xy[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > epsilonM) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

const countPoints = (lines: DrawnLine[]) => lines.reduce((sum, line) => sum + line.length, 0);

export function simplifySegments(
  segments: RoutePoint[][],
  maxPoints = MAX_DRAWN_POINTS,
): DrawnLine[] {
  return simplifyLines(
    segments.map((segment) => segment.map((point) => [point.lat, point.lng] as [number, number])),
    maxPoints,
  );
}

/** Douglas–Peucker จาก 5 ม. คูณ 2 จนรวมไม่เกิน `maxPoints` — ใช้ทั้งเส้นจากพิกัดจริงและเส้นที่ปรับตามถนน */
export function simplifyLines(lines: DrawnLine[], maxPoints = MAX_DRAWN_POINTS): DrawnLine[] {
  let epsilon = INITIAL_EPSILON_M;
  let result = lines.map((line) => douglasPeucker(line, epsilon));
  for (let round = 0; round < MAX_SIMPLIFY_ROUNDS && countPoints(result) > maxPoints; round += 1) {
    epsilon *= 2;
    result = lines.map((line) => douglasPeucker(line, epsilon));
  }
  return result;
}

const iso = (date: Date) => date.toISOString();

const gapJson = (gap: RouteGap) => ({
  kind: 'gap' as const,
  startAt: iso(gap.startAt),
  endAt: iso(gap.endAt),
  seconds: gap.seconds,
  from: gap.from,
  to: gap.to,
});

export function toRouteJson(route: BuiltRoute) {
  return {
    start: route.start ? { lat: route.start.lat, lng: route.start.lng, at: iso(route.start.at) } : null,
    end: route.end ? { lat: route.end.lat, lng: route.end.lng, at: iso(route.end.at) } : null,
    segments: route.segments,
    gaps: route.gaps.map(gapJson),
    timeline: route.timeline.map((item) =>
      item.kind === 'stop'
        ? { ...item, startAt: iso(item.startAt), endAt: iso(item.endAt) }
        : gapJson(item),
    ),
  };
}
