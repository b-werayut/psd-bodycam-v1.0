import { describe, expect, it } from 'vitest';

import {
  MAX_DRAWN_POINTS,
  buildRoute,
  dropSpikes,
  dropStaleStarts,
  simplifyLines,
  simplifySegments,
  smoothStationary,
  toRouteJson,
  type RoutePoint,
} from './route-builder';

const T0 = new Date('2026-09-01T03:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const RULES = { stopRadiusM: 50, stopMinMinutes: 5, gapSeconds: 90 };

type Place = { lat: number; lng: number };
const A: Place = { lat: 13.75, lng: 100.5 };
const B: Place = { lat: 13.77, lng: 100.52 };
const D: Place = { lat: 13.8, lng: 100.56 };
const E: Place = { lat: 13.82, lng: 100.58 };

function stay(place: Place, fromS: number, toS: number, stepS = 60): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (let s = fromS; s <= toS; s += stepS) out.push({ at: at(s), ...place });
  return out;
}

/** เลื่อนไปทางเหนือ/ตะวันออกเป็นเมตร (ประมาณ — พอสำหรับระยะไม่กี่กิโลเมตร) */
function shift(place: Place, northM: number, eastM = 0): Place {
  return {
    lat: place.lat + northM / 110_540,
    lng: place.lng + eastM / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
  };
}

function travel(from: Place, to: Place, fromS: number, toS: number, stepS = 15): RoutePoint[] {
  const out: RoutePoint[] = [];
  const steps = Math.round((toS - fromS) / stepS);
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    out.push({
      at: at(fromS + i * stepS),
      lat: from.lat + (to.lat - from.lat) * f,
      lng: from.lng + (to.lng - from.lng) * f,
    });
  }
  return out;
}

describe('buildRoute', () => {
  it('ไม่มีจุด -> ทุกอย่างว่าง และ start/end เป็น null', () => {
    expect(buildRoute([], RULES)).toEqual({
      start: null,
      end: null,
      segments: [],
      gaps: [],
      timeline: [],
      staleStartCount: 0,
      spikeCount: 0,
      smoothedCount: 0,
    });
  });

  it('อยู่นิ่ง 10 นาที -> จุดแวะ 1 จุด ไม่มีช่วงขาด', () => {
    const route = buildRoute(stay(A, 0, 600), RULES);

    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({
      kind: 'stop',
      index: 1,
      seconds: 600,
      noSignalSeconds: 0,
    });
    expect(route.gaps).toEqual([]);
    expect(route.segments).toHaveLength(1);
    expect(route.start).toEqual({ ...A, at: at(0) });
    expect(route.end).toEqual({ ...A, at: at(600) });
  });

  it('อยู่นิ่งสั้นกว่าเกณฑ์แล้วเคลื่อนที่ -> ไม่นับเป็นจุดแวะ', () => {
    const route = buildRoute([...stay(A, 0, 180), ...travel(A, B, 240, 840)], RULES);

    expect(route.timeline).toEqual([]);
  });

  it('พิกัดส่ายไปมารอบจุดเดิมในรัศมี -> ยังเป็นจุดแวะเดียว (ใช้จุดกึ่งกลางของกลุ่ม)', () => {
    const points: RoutePoint[] = [{ at: at(0), ...A }];
    for (let m = 1; m <= 10; m += 1) {
      // ±0.0002° ≈ ±22 ม. — ห่างจากจุดกึ่งกลางของกลุ่มไม่เกิน ~33 ม. ตลอด (±0.0003 จะหลุดรัศมี 50 ที่จุดที่ 3)
      points.push({ at: at(m * 60), lat: A.lat + (m % 2 ? 0.0002 : -0.0002), lng: A.lng });
    }

    const route = buildRoute(points, RULES);

    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({ kind: 'stop', seconds: 600 });
  });

  it('สองจุดห่างกันเท่ากับ gapSeconds พอดี = ไม่ขาด · เกิน 1 วินาที = ขาด', () => {
    const exact = buildRoute([{ at: at(0), ...A }, { at: at(90), ...B }], RULES);
    const over = buildRoute([{ at: at(0), ...A }, { at: at(91), ...B }], RULES);

    expect(exact.segments).toHaveLength(1);
    expect(exact.gaps).toEqual([]);
    expect(over.segments).toHaveLength(2);
    expect(over.gaps).toHaveLength(1);
    expect(over.gaps[0]).toMatchObject({ kind: 'gap', seconds: 91, from: A, to: B });
  });

  it('ขาดสัญญาณนานถึงเกณฑ์และปลายอยู่คนละที่ -> ขึ้นในรายการ', () => {
    const route = buildRoute([...travel(A, B, 0, 600), ...travel(D, E, 1200, 1800)], RULES);

    expect(route.gaps).toHaveLength(1);
    expect(route.gaps[0].seconds).toBe(600);
    expect(route.timeline.map((item) => item.kind)).toEqual(['gap']);
  });

  it('ขาดสัญญาณสั้นกว่าเกณฑ์ -> วาดเส้นประแต่ไม่ขึ้นในรายการ', () => {
    const route = buildRoute([...travel(A, B, 0, 600), ...travel(D, E, 720, 1200)], RULES);

    expect(route.gaps).toHaveLength(1);
    expect(route.gaps[0].seconds).toBe(120);
    expect(route.timeline).toEqual([]);
  });

  it('**ขาดสัญญาณแต่กลับมาที่เดิม -> จุดแวะเดียวข้ามช่วงขาด พร้อม noSignalSeconds · ไม่มีเส้นประ**', () => {
    const route = buildRoute([...stay(A, 0, 300), ...stay(A, 2400, 2700)], RULES);

    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({
      kind: 'stop',
      startAt: at(0),
      endAt: at(2700),
      seconds: 2700,
      noSignalSeconds: 2100,
    });
    expect(route.gaps).toEqual([]);
    expect(route.segments).toHaveLength(2);
  });

  it('แวะครบเกณฑ์แล้วโผล่ไกลออกไปหลังขาดสัญญาณ -> จุดแวะ + ช่วงขาด เรียงตามเวลา', () => {
    const route = buildRoute([...stay(A, 0, 300), ...travel(B, D, 2400, 3000)], RULES);

    expect(route.timeline.map((item) => item.kind)).toEqual(['stop', 'gap']);
    expect(route.timeline[1]).toMatchObject({ kind: 'gap', seconds: 2100 });
  });

  it('พิกัดโดดระหว่างสองช่วงขาด -> segment ที่มีจุดเดียว', () => {
    const route = buildRoute(
      [...travel(A, B, 0, 600), { at: at(1200), ...D }, ...travel(E, A, 1800, 2400)],
      RULES,
    );

    expect(route.segments.map((segment) => segment.length)).toEqual([2, 1, 2]);
    expect(route.gaps).toHaveLength(2);
  });

  it('จุดแวะหลายจุดได้หมายเลขเรียง 1, 2 ตามเวลา', () => {
    const route = buildRoute(
      [...stay(A, 0, 600), ...travel(A, B, 615, 1200), ...stay(B, 1215, 1815)],
      RULES,
    );

    const stops = route.timeline.filter((item) => item.kind === 'stop');
    expect(stops.map((stop) => (stop.kind === 'stop' ? stop.index : 0))).toEqual([1, 2]);
  });
});

/** แทนจุดที่ index ใน `points` ด้วยพิกัดใหม่ (เวลาเดิม) */
function replaceAt(points: RoutePoint[], index: number, place: Place): RoutePoint[] {
  return points.map((point, i) => (i === index ? { at: point.at, ...place } : point));
}

/** รถวิ่งผ่านด้วยความเร็วคงที่ ไปถึงปลายแล้วกลับรถทันที วิ่งเลยจุดเริ่มต่อไป */
function uTurn(kph: number, stepS: number, outS: number): RoutePoint[] {
  const metersPerSecond = kph / 3.6;
  const out: RoutePoint[] = [];
  for (let s = -300; s <= outS * 2 + 300; s += stepS) {
    const northM = s <= outS ? metersPerSecond * s : metersPerSecond * (2 * outS - s);
    out.push({ at: at(s), ...shift(A, northM) });
  }
  return out;
}

describe('dropSpikes', () => {
  const FAR = shift(A, 1000);

  it('อยู่นิ่งแล้วจุดเดียวเด้งไป 1 กม. แล้วกลับที่เดิม -> ตัดจุดนั้น', () => {
    const points = replaceAt(stay(A, 0, 600, 40), 5, FAR);

    const result = dropSpikes(points);

    expect(result.spikeCount).toBe(1);
    expect(result.kept).toHaveLength(points.length - 1);
    expect(result.kept).not.toContainEqual(points[5]);
    expect(result.keptIndex).not.toContain(5);
  });

  it('เด้งออกไปติดกัน 2 จุดแล้วกลับ -> ตัดทั้ง 2 จุด', () => {
    const points = replaceAt(replaceAt(stay(A, 0, 600, 40), 5, FAR), 6, shift(A, 1400, 300));

    expect(dropSpikes(points).spikeCount).toBe(2);
  });

  it.each([
    [60, 35, 60],
    [60, 50, 60],
    [90, 15, 30],
    [40, 35, 120],
  ])(
    '**รถจริงวิ่ง %i กม./ชม. (ทุก %i วิ) ไป %i วิแล้วกลับรถ -> ไม่ตัดอะไรเลย**',
    (kph, stepS, outS) => {
      expect(dropSpikes(uTurn(kph, stepS, outS)).spikeCount).toBe(0);
    },
  );

  it('เคลื่อนที่ออกไปแล้วไม่กลับ -> ไม่ตัด', () => {
    const away = shift(A, 1500);
    const points = [
      ...stay(A, 0, 200, 40),
      ...travel(A, away, 240, 400, 40),
      ...stay(away, 440, 800, 40),
    ];

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('ออกไปไกลไม่ถึง 250 ม. -> ไม่ตัด (ปล่อยให้จุดแวะรับมือเอง)', () => {
    const points = replaceAt(stay(A, 0, 600, 40), 5, shift(A, 200));

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('ไปแล้วกลับมาไม่ใกล้ที่เดิม (เกิน 35% ของระยะที่ออกไป) -> ไม่ตัด', () => {
    const points = [
      ...stay(A, 0, 160, 40),
      { at: at(200), ...FAR },
      ...stay(shift(A, 600), 240, 600, 40),
    ];

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('ไปกลับช้ากว่า 30 กม./ชม. (เดินไปแล้วเดินกลับ) -> ไม่ตัด', () => {
    const points = [
      ...stay(A, 0, 120, 120),
      { at: at(240), ...shift(A, 300) },
      ...stay(A, 360, 840, 120),
    ];

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('หายไปนานเกิน 5 นาทีแล้วกลับ -> ไม่ตัด (อาจไปจริงระหว่างที่ไม่มีสัญญาณ)', () => {
    const points = [...stay(A, 0, 160, 40), { at: at(320), ...FAR }, ...stay(A, 480, 800, 40)];

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('มีแค่ 3 จุด ไม่มีการเคลื่อนที่รอบข้างให้เทียบ -> ไม่ตัด', () => {
    const points = [{ at: at(0), ...A }, { at: at(40), ...FAR }, { at: at(80), ...A }];

    expect(dropSpikes(points).spikeCount).toBe(0);
  });

  it('จุดแรกและจุดสุดท้ายไม่ถูกตัดเสมอ', () => {
    const points = replaceAt(replaceAt(stay(A, 0, 400, 40), 0, FAR), 10, FAR);

    const result = dropSpikes(points);

    expect(result.kept[0]).toEqual(points[0]);
    expect(result.kept[result.kept.length - 1]).toEqual(points[10]);
  });
});

describe('dropStaleStarts', () => {
  const GAP = 90;
  /** ห่าง A ราว 5.8 กม. — แบบพิกัดค้างที่กล้อง 1000026/1000027 ส่งมาตอนเพิ่งเชื่อมต่อ */
  const OLD = shift(A, -5000, -3000);

  it('**เริ่มวันด้วยพิกัดค้างที่อยู่ไกล แล้ว 3 นาทีต่อมาได้พิกัดใหม่ที่นิ่ง -> ตัดจุดแรก**', () => {
    const points = [{ at: at(0), ...OLD }, ...stay(A, 180, 600, 40)];

    const result = dropStaleStarts(points, GAP);

    expect(result.staleStartCount).toBe(1);
    expect(result.kept[0]).toEqual(points[1]);
    expect(result.keptIndex[0]).toBe(1);
  });

  it('พิกัดค้างซ้ำ 2 จุดก่อนได้พิกัดใหม่ -> ตัดทั้ง 2 จุด', () => {
    const points = [{ at: at(0), ...OLD }, { at: at(40), ...OLD }, ...stay(A, 180, 600, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(2);
  });

  it('**กล้องกลับมาเชื่อมต่อกลางวันแล้วส่งพิกัดค้าง -> ตัดเฉพาะจุดแรกหลังขาดสัญญาณ**', () => {
    const points = [...stay(A, 0, 600, 40), { at: at(1200), ...OLD }, ...stay(B, 1260, 1800, 40)];

    const result = dropStaleStarts(points, GAP);

    expect(result.staleStartCount).toBe(1);
    expect(result.kept).not.toContainEqual(points[16]);
  });

  it('จุดที่ไม่ใช่จุดแรกหลังขาดสัญญาณ -> ไม่ใช้กฎนี้ (ปล่อยให้ dropSpikes ตัดสิน)', () => {
    const points = [...stay(A, 0, 200, 40), { at: at(240), ...OLD }, ...stay(B, 280, 600, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(0);
  });

  it('**รถออกวิ่งทันทีหลังเปิดกล้อง (ทุกช่วงยาวพอ ๆ กัน) -> ไม่ตัด**', () => {
    expect(dropStaleStarts(travel(A, D, 0, 600, 35), GAP).staleStartCount).toBe(0);
  });

  it('ห่างพิกัดใหม่ไม่ถึง 250 ม. -> ไม่ตัด', () => {
    const points = [{ at: at(0), ...shift(A, 200) }, ...stay(A, 40, 600, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(0);
  });

  it('ได้พิกัดใหม่หลังเกิน 5 นาที -> ไม่ตัด (อาจเดินทางจริงระหว่างที่ไม่มีสัญญาณ)', () => {
    const points = [{ at: at(0), ...OLD }, ...stay(A, 360, 900, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(0);
  });

  it('ไปถึงพิกัดใหม่ช้ากว่า 30 กม./ชม. -> ไม่ตัด (เดินไปได้จริง)', () => {
    const points = [{ at: at(0), ...shift(A, 1000) }, ...stay(A, 290, 900, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(0);
  });

  it('ไม่มีจุดถัดจากพิกัดใหม่ให้เทียบ -> ไม่ตัด', () => {
    const points = [
      { at: at(0), ...OLD },
      { at: at(180), ...A },
    ];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(0);
  });

  it('ข้อจำกัดที่ยอมรับ: เปิดกล้องขณะรถวิ่งแล้วจอดในช่วงถัดไป -> จุดแรก (ซึ่งจริง) ถูกตัด', () => {
    const points = [{ at: at(0), ...shift(A, -1000) }, ...stay(A, 60, 600, 40)];

    expect(dropStaleStarts(points, GAP).staleStartCount).toBe(1);
  });
});

describe('buildRoute — พิกัดค้างตอนกล้องเพิ่งเชื่อมต่อ', () => {
  const OLD = shift(A, -5000, -3000);

  it('**จุดเริ่มเป็นพิกัดใหม่ ไม่มีเส้นประจากพิกัดค้าง และนับใน staleStartCount**', () => {
    const route = buildRoute([{ at: at(0), ...OLD }, ...stay(A, 180, 900, 40)], RULES);

    expect(route.staleStartCount).toBe(1);
    expect(route.start).toEqual({ ...A, at: at(180) });
    expect(route.gaps).toEqual([]);
    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({ kind: 'stop', startAt: at(180) });
    expect(route.segments.flat()).not.toContainEqual([OLD.lat, OLD.lng]);
  });

  it('กลับมาเชื่อมต่อกลางวัน -> เส้นประจากจุดก่อนขาดสัญญาณไปพิกัดใหม่ ไม่ผ่านพิกัดค้าง', () => {
    const points = [...stay(A, 0, 600, 40), { at: at(1200), ...OLD }, ...stay(B, 1260, 1800, 40)];

    const route = buildRoute(points, RULES);

    expect(route.staleStartCount).toBe(1);
    expect(route.gaps).toHaveLength(1);
    expect(route.gaps[0]).toMatchObject({ startAt: at(600), endAt: at(1200), from: A, to: B });
    expect(route.segments.flat()).not.toContainEqual([OLD.lat, OLD.lng]);
  });
});

describe('buildRoute — จุดเด้งไป-กลับ', () => {
  const FAR = shift(A, 1000);

  it('อยู่นิ่ง 10 นาทีมีจุดเด้ง -> จุดแวะเดียว เส้นไม่ผ่านจุดเด้ง และนับใน spikeCount', () => {
    const route = buildRoute(replaceAt(stay(A, 0, 600, 40), 5, FAR), RULES);

    expect(route.spikeCount).toBe(1);
    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({ kind: 'stop', seconds: 600, noSignalSeconds: 0 });
    expect(route.segments.flat()).not.toContainEqual([FAR.lat, FAR.lng]);
  });

  it('**ตัดจุดเด้งแล้วช่วงห่างเกิน gapSeconds -> ไม่กลายเป็นช่วงขาดสัญญาณ (กล้องมีสัญญาณ แค่พิกัดเพี้ยน)**', () => {
    // จุดดิบห่างกันไม่เกิน 50 วิ แต่หลังตัดจุดที่ 130 วิ จุดที่เหลือห่างกัน 100 วิ (> 90)
    // ช่วงรวม 220 วิ ไม่ถึงเกณฑ์จุดแวะ — ถ้านับผิดจะโผล่เป็นช่วงขาดใน gaps
    const points: RoutePoint[] = [
      ...stay(A, 0, 80, 40),
      { at: at(130), ...FAR },
      ...stay(A, 180, 220, 40),
    ];

    const route = buildRoute(points, RULES);

    expect(route.spikeCount).toBe(1);
    expect(route.gaps).toEqual([]);
    expect(route.segments).toHaveLength(1);
  });

  it('ไม่มีสัญญาณจริงหลังจุดเด้ง -> นับเฉพาะช่วงที่เงียบจริงใน noSignalSeconds', () => {
    // จุดเด้งที่ 280 วิ แล้วเงียบ 280 -> 400 (120 วิ) · ช่วงจุดที่เหลือ 240 -> 400 = 160 วิ
    const points = [...stay(A, 0, 240, 40), { at: at(280), ...FAR }, ...stay(A, 400, 900, 40)];

    const route = buildRoute(points, RULES);

    expect(route.spikeCount).toBe(1);
    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({ kind: 'stop', noSignalSeconds: 120 });
  });

  it('ไม่มีสัญญาณจริงหลังจุดเด้ง แล้วโผล่คนละกลุ่ม -> ช่วงขาดเริ่มที่จุดเด้ง ปลายเส้นประเป็นจุดที่เหลือ', () => {
    const later = shift(A, 0, 100);
    const points = [...stay(A, 0, 80, 40), { at: at(120), ...FAR }, ...stay(later, 240, 600, 40)];

    const route = buildRoute(points, RULES);

    expect(route.spikeCount).toBe(1);
    expect(route.gaps).toHaveLength(1);
    expect(route.gaps[0]).toMatchObject({
      startAt: at(120),
      endAt: at(240),
      seconds: 120,
      from: A,
      to: later,
    });
  });
});

/** อยู่กับที่แต่พิกัดแกว่ง ±meters วนเหนือ/ใต้/ตะวันออก/ตะวันตก/ตรงจุด (ไม่ถึงเกณฑ์จุดเด้ง 250 ม.) */
function jitter(place: Place, fromS: number, toS: number, stepS: number, meters: number) {
  const offsets: Array<[number, number]> = [
    [meters, 0],
    [-meters, 0],
    [0, meters],
    [0, -meters],
    [0, 0],
  ];
  const out: RoutePoint[] = [];
  for (let s = fromS, i = 0; s <= toS; s += stepS, i += 1) {
    const [north, east] = offsets[i % offsets.length];
    out.push({ at: at(s), ...shift(place, north, east) });
  }
  return out;
}

const metersFrom = (a: Place, b: Place) =>
  Math.hypot(
    (a.lat - b.lat) * 110_540,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  );

describe('smoothStationary', () => {
  const GAP = 90;

  it('อยู่กับที่แต่พิกัดแกว่ง ±150 ม. -> จุดกลางถูกดึงกลับมาที่เดิม · จุดแรก/สุดท้ายไม่แตะ', () => {
    const raw = jitter(A, 0, 560, 40, 150);

    const { points, smoothedCount } = smoothStationary(raw, GAP);

    expect(smoothedCount).toBeGreaterThan(0);
    for (const point of points.slice(1, -1)) expect(metersFrom(point, A)).toBeLessThan(1);
    expect(points[0]).toEqual(raw[0]);
    expect(points[points.length - 1]).toEqual(raw[raw.length - 1]);
    expect(points.map((point) => point.at)).toEqual(raw.map((point) => point.at));
  });

  it('**เดินทางเป็นเส้นตรง -> ไม่แตะเลย**', () => {
    const raw = travel(A, B, 0, 600, 40);

    const { points, smoothedCount } = smoothStationary(raw, GAP);

    expect(smoothedCount).toBe(0);
    expect(points).toEqual(raw);
  });

  it('**วิ่งตามถนนที่เลี้ยวทุก 2 ช่วง (ผังตาราง) -> ไม่แตะเลย ไม่ตัดมุมเลี้ยว**', () => {
    const raw: RoutePoint[] = [];
    let north = 0;
    let east = 0;
    for (let i = 0; i < 20; i += 1) {
      raw.push({ at: at(i * 40), ...shift(A, north, east) });
      if (Math.floor(i / 2) % 2 === 0) north += 400;
      else east += 400;
    }

    const { points, smoothedCount } = smoothStationary(raw, GAP);

    expect(smoothedCount).toBe(0);
    expect(points).toEqual(raw);
  });

  it('**ถนนคดเคี้ยว (ขึ้นเหนือ-ลงใต้สลับกันขณะวิ่งไปตะวันออก) -> ไม่แตะ — กันมัธยฐานตัดยอดโค้งของการเดินทางจริง**', () => {
    // ถ้าไม่มีเกณฑ์ระยะขจัด ยอดโค้งแต่ละยอดจะถูกดึงลง ~280 ม. (ค่ามัธยฐานของ lat ในหน้าต่าง)
    const raw: RoutePoint[] = [];
    let north = 0;
    let east = 0;
    for (let i = 0; i < 20; i += 1) {
      raw.push({ at: at(i * 40), ...shift(A, north, east) });
      north += Math.floor(i / 2) % 2 === 0 ? 283 : -283;
      east += 283;
    }

    const { points, smoothedCount } = smoothStationary(raw, GAP);

    expect(smoothedCount).toBe(0);
    expect(points).toEqual(raw);
  });

  it('จุดห่างกันเกิน 2 เท่าของ gapSeconds -> ไม่มีเพื่อนบ้านให้ใช้ ไม่แตะ', () => {
    const raw = jitter(A, 0, 2000, 200, 150);

    expect(smoothStationary(raw, GAP).smoothedCount).toBe(0);
  });

  it('ข้อจำกัดที่ยอมรับ: ปลายกลับรถถูกตัดมนไม่เกิน 1 ช่วงระหว่างจุด', () => {
    // 60 กม./ชม. ทุก 50 วิ = ช่วงละ ~833 ม. · จุดที่ 300 วิคือปลายกลับรถพอดี
    const raw = uTurn(60, 50, 300);
    const tip = raw.findIndex((point) => point.at.getTime() === at(300).getTime());

    const { points } = smoothStationary(raw, GAP);

    const moved = metersFrom(points[tip], raw[tip]);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(834);
  });
});

describe('buildRoute — ปรับให้เรียบช่วงที่อยู่กับที่', () => {
  it('อยู่กับที่ 10 นาทีแต่พิกัดแกว่ง ±150 ม. (เกินรัศมีจุดแวะ 50 ม.) -> ยังหาจุดแวะเจอ และนับใน smoothedCount', () => {
    const raw = jitter(A, 0, 600, 40, 150);

    const route = buildRoute(raw, RULES);

    expect(route.smoothedCount).toBeGreaterThan(0);
    expect(route.timeline).toHaveLength(1);
    expect(route.timeline[0]).toMatchObject({ kind: 'stop' });
    expect(route.start).toEqual({ ...raw[0], at: raw[0].at });
  });
});

describe('simplifySegments', () => {
  it('เส้นตรง 5,000 จุด -> เหลือ 2 จุด', () => {
    const line = travel(A, B, 0, 5000 * 10 - 10, 10);

    const [simplified] = simplifySegments([line]);

    expect(simplified).toEqual([
      [line[0].lat, line[0].lng],
      [line[line.length - 1].lat, line[line.length - 1].lng],
    ]);
  });

  it('ซิกแซ็ก 5,000 จุด -> รวมไม่เกินเพดาน และจุดแรก/สุดท้ายอยู่รอด', () => {
    const zigzag: RoutePoint[] = Array.from({ length: 5000 }, (_, i) => ({
      at: at(i * 10),
      lat: A.lat + (i % 2 ? 0.001 : -0.001),
      lng: A.lng + i * 0.0002,
    }));

    const [simplified] = simplifySegments([zigzag]);

    expect(simplified.length).toBeLessThanOrEqual(MAX_DRAWN_POINTS);
    expect(simplified[0]).toEqual([zigzag[0].lat, zigzag[0].lng]);
    expect(simplified[simplified.length - 1]).toEqual([zigzag[4999].lat, zigzag[4999].lng]);
  });

  it('ทุก segment เก็บจุดต้นและปลายของตัวเอง', () => {
    const result = simplifySegments([travel(A, B, 0, 30), travel(D, E, 600, 630)]);

    expect(result.map((segment) => segment.length)).toEqual([2, 2]);
    expect(result[1][0]).toEqual([D.lat, D.lng]);
  });
});

describe('simplifyLines (เส้นที่ปรับตามถนนแล้ว)', () => {
  it('ให้ผลเท่ากับ simplifySegments ของจุดชุดเดียวกัน (Douglas–Peucker ชุดเดียว)', () => {
    const segments = [travel(A, B, 0, 600), travel(D, E, 1200, 1800)];
    const lines = segments.map((s) => s.map((p) => [p.lat, p.lng] as [number, number]));

    expect(simplifyLines(lines)).toEqual(simplifySegments(segments));
  });

  it('รวมไม่เกินเพดานที่ส่งมา', () => {
    const zigzag = Array.from(
      { length: 3000 },
      (_, i) => [A.lat + (i % 2 ? 0.001 : -0.001), A.lng + i * 0.0002] as [number, number],
    );

    expect(simplifyLines([zigzag], 500)[0].length).toBeLessThanOrEqual(500);
  });
});

describe('toRouteJson', () => {
  it('แปลงเวลาเป็น ISO string ทั้ง start/end/gaps/timeline', () => {
    const json = toRouteJson(buildRoute([...stay(A, 0, 300), ...travel(B, D, 2400, 2430)], RULES));

    expect(json.start?.at).toBe(at(0).toISOString());
    expect(json.gaps[0].startAt).toBe(at(300).toISOString());
    expect(json.timeline[0]).toMatchObject({
      kind: 'stop',
      startAt: at(0).toISOString(),
      endAt: at(300).toISOString(),
    });
  });
});
