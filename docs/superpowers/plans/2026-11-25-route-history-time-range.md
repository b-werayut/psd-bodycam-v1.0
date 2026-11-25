# ประวัติเส้นทาง: เลือกช่วงเวลาเอง (≤ 36 ชม.) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า ประวัติเส้นทาง เลือกวัน + เวลาเริ่ม และวัน + เวลาสิ้นสุดเองได้ ข้ามวันได้ ยาวสุด 36 ชม. แล้วได้แผนที่ ลำดับเหตุการณ์ และระยะทางรวมของช่วงนั้น

**Architecture:** server ขยายเพดานช่วงของ `GET /tracking/devices/:id/history` เป็น 36 ชม. (ค่าคงที่เดียว) · client เก็บช่วงที่โหลดใน URL เหมือนเดิม แต่มีช่องกรอก (draft) แยกจากช่วงที่โหลด — โหลดเมื่อกด ดูเส้นทาง เท่านั้น · helper เวลาไทยเป็นฟังก์ชันล้วนใน `historyRange.ts`

**Tech Stack:** NestJS + Vitest (server) · React 18 + react-router + TanStack Query + Vitest/Testing Library (client)

**Spec:** `docs/superpowers/specs/2026-11-25-route-history-time-range-design.md`

## Global Constraints

- ช่วงยาวสุด **36 ชม.** ทั้ง server (`HISTORY_MAX_RANGE_HOURS`) และ client (`HISTORY_MAX_HOURS`)
- วันและเวลาในช่องกรอกเป็น **เวลาไทย (UTC+7) เสมอ** ไม่ขึ้นกับ time zone ของเครื่อง — ใช้เลขคณิตกับ `Date.UTC` แบบ helper เดิม ห้ามใช้ `new Date('yyyy-MM-ddTHH:mm')` (ตีความเป็นเวลาเครื่อง)
- แก้ช่องไม่โหลด · ทุกการโหลดเขียน audit `VIEW_GPS_HISTORY` — query ยังเป็น `staleTime: Infinity`, ไม่ refetch เอง
- ข้อความบนจอ th / en ผ่าน i18n · ไม่เอ่ยถึงที่มาของข้อมูล (DL64)
- ไม่แตะเพดาน 24 ชม. ของเรื่องอื่น (ค้นวิดีโอย้อนหลัง `evidenceRange`, export, playback)
- **ห้าม commit** — ผู้ใช้ commit เอง · จบงานให้เสนอข้อความ commit

## Review Focus

1. เครื่องผู้ใช้ไม่ได้ตั้งเวลาไทย ⇒ ช่วงที่โหลดต้องตรงกับที่กรอกตามเวลาไทย — Task 2 ทดสอบด้วยค่า UTC ตายตัว
2. แก้ URL เองให้เกิน 36 ชม. / กลับด้าน ⇒ ถอยไปทั้งวันของวันนี้ ไม่ยิงคำขอที่ server จะตอบ 400 — Task 2
3. หลังกด วันก่อน / วันถัดไป / ทั้งวัน ช่องกรอกต้องแสดงช่วงที่โหลดจริง — Task 4
4. ลบเวลาในช่องจนว่าง ⇒ ปุ่ม ดูเส้นทาง กดไม่ได้ ไม่ crash — Task 2 + Task 4
5. ช่วงทั้งวัน (00:00 → 00:00 วันถัดไป) ไม่ถือว่าคร่อมวัน ⇒ แถวลำดับเหตุการณ์ไม่มีวันนำหน้า — Task 2

---

### Task 1: Server — เพดาน 36 ชม.

**Files:**
- Modify: `server/src/modules/tracking/history-range.ts:3,6`
- Test: `server/src/modules/tracking/history-range.test.ts`, `server/src/modules/tracking/tracking-read.int-test.ts:132`

**Interfaces:**
- Produces: `HISTORY_MAX_RANGE_HOURS = 36` · `parseHistoryRange(fromRaw, toRaw, now?)` signature เดิม

- [ ] **Step 1: แก้ test ให้ใช้กติกาใหม่**

`history-range.test.ts`:
- test แรกเปลี่ยนชื่อเป็น `'accepts up to 36 hours and returns Dates'` · from `'2026-11-21T15:00:00Z'` to `'2026-11-23T03:00:00Z'` ⇒ คืน Date ทั้งคู่
- test INVALID_RANGE: แทนบรรทัด 25 ด้วย `parseHistoryRange('2026-11-21T14:59:59Z', '2026-11-23T03:00:00Z', now)` ⇒ `'INVALID_RANGE'` · ชื่อ test `… more than 36 h …`
- เพิ่ม: ข้อความของ error ที่เกินช่วงมี `'36 ชั่วโมง'`

`tracking-read.int-test.ts:132`: `iso(t0 + 25 * 3_600_000)` ⇒ `iso(t0 + 37 * 3_600_000)`

- [ ] **Step 2: รัน unit test ให้ fail**

Run: `cd server; npx vitest run src/modules/tracking/history-range.test.ts`
Expected: FAIL — 36 ชม. ถูกปฏิเสธ

- [ ] **Step 3: `HISTORY_MAX_RANGE_HOURS = 36` และ doc comment บรรทัด 6 เป็น "at most 36 h"**

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd server; npx vitest run src/modules/tracking/history-range.test.ts` ⇒ PASS
Run: `cd server; npx vitest run --config vitest.integration.config.ts src/modules/tracking/tracking-read.int-test.ts` ⇒ PASS (5 tests)

---

### Task 2: Client — helper ช่วงเวลาไทย

**Files:**
- Modify: `client/src/features/tracking-history/historyRange.ts`
- Test: `client/src/features/tracking-history/historyRange.test.ts`

**Interfaces:**
- Produces (ทั้งหมด export จาก `historyRange.ts`):
  - `HISTORY_MAX_HOURS = 36`
  - `type RangeFields = { startDate: string; startTime: string; endDate: string; endTime: string }` — `yyyy-MM-dd` / `HH:mm` เวลาไทย
  - `type HistoryWindow = { from: string; to: string }` — UTC ISO
  - `type RangeProblem = 'incomplete' | 'endBeforeStart' | 'tooLong' | 'future'`
  - `bangkokInstant(dateYmd: string, timeHm: string): string | null` — UTC ISO · `null` เมื่อรูปแบบผิดหรือวันที่ไม่มีจริง
  - `rangeFieldsOf(window: HistoryWindow): RangeFields`
  - `windowOfFields(fields: RangeFields): HistoryWindow | null`
  - `rangeProblem(window: HistoryWindow | null, now?: Date): RangeProblem | null` — ลำดับตรวจ: null ⇒ `incomplete` · to ≤ from ⇒ `endBeforeStart` · เกิน 36 ชม. ⇒ `tooLong` · from > now ⇒ `future`
  - `shiftWindow(window: HistoryWindow, days: number): HistoryWindow` — เลื่อนทั้งช่วง `days × 24 ชม.`
  - `spansDays(window: HistoryWindow): boolean` — วันไทยของ `from` ≠ วันไทยของ `to − 1 ms`
  - เดิมคงไว้: `dayWindowOf`, `bangkokDateOf`, `shiftDay`, `isFutureDay`, `parseHistoryQuery`, `historySearch`, `historyHref` (สองตัวหลังใช้ `HISTORY_MAX_HOURS` ใหม่โดยอัตโนมัติ)

- [ ] **Step 1: เขียน test ที่ fail** (`now` = `2026-11-23T03:00:00Z` ของไฟล์เดิม)

```ts
describe('Bangkok date + time fields', () => {
  it('bangkokInstant: Bangkok wall time -> UTC, whatever the browser zone', () => {
    expect(bangkokInstant('2026-11-24', '20:00')).toBe('2026-11-24T13:00:00.000Z');
    expect(bangkokInstant('2026-11-25', '06:30')).toBe('2026-11-24T23:30:00.000Z');
    expect(bangkokInstant('2026-02-30', '10:00')).toBeNull();
    expect(bangkokInstant('2026-11-24', '')).toBeNull();
    expect(bangkokInstant('', '10:00')).toBeNull();
  });

  it('rangeFieldsOf <-> windowOfFields round-trip, crossing midnight', () => {
    const window = { from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' };
    expect(rangeFieldsOf(window)).toEqual({ startDate: '2026-11-21', startTime: '20:00', endDate: '2026-11-22', endTime: '06:00' });
    expect(windowOfFields(rangeFieldsOf(window))).toEqual(window);
  });

  it('a whole day ends at 00:00 of the next day', () => {
    expect(rangeFieldsOf(dayWindowOf('2026-11-22'))).toEqual({ startDate: '2026-11-22', startTime: '00:00', endDate: '2026-11-23', endTime: '00:00' });
  });
});

describe('rangeProblem', () => {
  const at = (from: string, to: string) => ({ from, to });
  it('null when valid; exactly 36 h is valid', () => {
    expect(rangeProblem(at('2026-11-21T15:00:00.000Z', '2026-11-23T03:00:00.000Z'), now)).toBeNull();
  });
  it('incomplete, endBeforeStart, tooLong, future', () => {
    expect(rangeProblem(null, now)).toBe('incomplete');
    expect(rangeProblem(at('2026-11-22T10:00:00.000Z', '2026-11-22T10:00:00.000Z'), now)).toBe('endBeforeStart');
    expect(rangeProblem(at('2026-11-21T14:59:00.000Z', '2026-11-23T03:00:00.000Z'), now)).toBe('tooLong');
    expect(rangeProblem(at('2026-11-23T03:01:00.000Z', '2026-11-23T05:00:00.000Z'), now)).toBe('future');
  });
});

describe('shiftWindow / spansDays', () => {
  it('shifts the whole window by days', () => {
    expect(shiftWindow({ from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' }, -1))
      .toEqual({ from: '2026-11-20T13:00:00.000Z', to: '2026-11-20T23:00:00.000Z' });
  });
  it('a whole day does not span days; 20:00 -> 06:00 does', () => {
    expect(spansDays(dayWindowOf('2026-11-22'))).toBe(false);
    expect(spansDays({ from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' })).toBe(true);
  });
});
```

แก้ test เดิม:
- `parseHistoryQuery`: ชื่อ `'keeps a valid range of at most 36 h'` · เพิ่ม: from `2026-11-21T15:00:00.000Z` to `2026-11-23T03:00:00.000Z` (36 ชม. พอดี) ถูกเก็บไว้ · from `2026-11-21T14:59:00.000Z` to เดิม (36 ชม. 1 นาที) ถอยไปวันนี้
- `historyHref` (ชื่อ `… its last 36 h`): ช่วง `2026-11-20T00:00Z` → `2026-11-22T12:00Z` ⇒ `from=2026-11-21T00%3A00%3A00.000Z&to=2026-11-22T12%3A00%3A00.000Z`

- [ ] **Step 2: รันให้ fail**

Run: `cd client; npx vitest run src/features/tracking-history/historyRange.test.ts`
Expected: FAIL — ฟังก์ชันใหม่ยังไม่มี / 36 ชม. ยังถูกปฏิเสธ

- [ ] **Step 3: implement ตาม Interfaces** — `bangkokInstant` ตรวจ `^\d{4}-\d{2}-\d{2}$` + `^\d{2}:\d{2}$` และตรวจวันที่ไม่ล้น (แบบ `dayBoundsBangkok` ใน `lib/time.ts`) · `rangeFieldsOf` ใช้ `bangkokDateOf` + เวลา `HH:mm` จาก instant + 7 ชม. · แก้คอมเมนต์หัวไฟล์ (24 ⇒ 36)

- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม ⇒ PASS

---

### Task 3: Client — แถวลำดับเหตุการณ์มีวันเมื่อช่วงคร่อมวัน

**Files:**
- Modify: `client/src/features/tracking-history/historyTimeline.ts`
- Test: `client/src/features/tracking-history/historyTimeline.test.ts`

**Interfaces:**
- Consumes: `formatDayMonth(value, locale)` จาก `@/lib/time` (`25 พ.ย.` / `25 Nov`)
- Produces: `timelineView(item: RouteTimelineItem, language: Language, withDate = false): TimelineView` — เมื่อ `withDate` เวลา `from` / `to` ของทั้ง stop และ gap = `` `${formatDayMonth(iso)} ${formatTime(iso)}` ``

- [ ] **Step 1: test ที่ fail** — `'with dates when the window spans days'`: stop เดิมของไฟล์ (`startAt 2026-11-23T01:00Z`) กับ `timelineView(stop, 'th', true).params` ⇒ `from: '23 พ.ย. 08:00'`, `to: '23 พ.ย. 08:20'` · gap เดิมกับ `withDate` ⇒ `from: '23 พ.ย. 09:00'` · test เดิมไม่ส่ง `withDate` ต้องผ่านเหมือนเดิม
- [ ] **Step 2: รันให้ fail** — `cd client; npx vitest run src/features/tracking-history/historyTimeline.test.ts`
- [ ] **Step 3: implement** — เปลี่ยนแค่ `clock` ใน `timelineView`
- [ ] **Step 4: รันให้ผ่าน**

---

### Task 4: Client — หน้าจอเลือกช่วงเวลา

**Files:**
- Modify: `client/src/features/tracking-history/HistoryPage.tsx`, `client/src/i18n/locales/th/tracking.ts`, `client/src/i18n/locales/en/tracking.ts`
- Test: `client/src/features/tracking-history/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: ทุกตัวของ Task 2 · `timelineView(item, language, withDate)` ของ Task 3

**หน้าจอ** (แทนช่อง วันที่ + ปุ่มลูกศรเดิม; ช่องกล้องคงเดิม)
```
เริ่ม   [date: history-start-date] [time: history-start-time]   สิ้นสุด [date: history-end-date] [time: history-end-time]   [ดูเส้นทาง]
[ทั้งวัน]  [‹ วันก่อนหน้า]  [วันถัดไป ›]
<ข้อความปัญหาของช่วง (role="alert") เมื่อมี>
```
- `draft: RangeFields` = `rangeFieldsOf(query)` และตั้งใหม่ทุกครั้งที่ `query.from` / `query.to` เปลี่ยน
- **ดูเส้นทาง**: `disabled` เมื่อ `rangeProblem(windowOfFields(draft))` ไม่เป็น null · กดแล้ว `go({ window })`
- **ทั้งวัน**: `dayWindowOf(draft.startDate)` แล้วโหลด · `disabled` เมื่อ `startDate` ว่าง / อยู่ในอนาคต
- **วันก่อนหน้า / วันถัดไป**: `shiftWindow(query, ∓1/±1)` แล้วโหลด · วันถัดไป `disabled` เมื่อ `from` ของช่วงที่เลื่อนแล้ว > ตอนนี้
- เปลี่ยนกล้อง: โหลดด้วย `query.from` / `query.to` (เหมือนเดิม)
- ลำดับเหตุการณ์: `timelineView(item, language, spansDays(query))`
- `go` รับ `{ deviceId?, window? }` แทน `{ deviceId?, day? }`

**i18n** (เพิ่มทั้ง th / en · ลบ `tracking.history.date` ที่ไม่ใช้แล้ว · `tracking.history.description` 24 ⇒ 36):

| key | th | en |
|---|---|---|
| `tracking.history.rangeStart` | เริ่ม | Start |
| `tracking.history.rangeEnd` | สิ้นสุด | End |
| `tracking.history.startDate` / `startTime` | วันที่เริ่ม / เวลาเริ่ม | Start date / Start time |
| `tracking.history.endDate` / `endTime` | วันที่สิ้นสุด / เวลาสิ้นสุด | End date / End time |
| `tracking.history.show` | ดูเส้นทาง | Show route |
| `tracking.history.wholeDay` | ทั้งวัน | Whole day |
| `tracking.history.rangeIncomplete` | กรอกวันและเวลาให้ครบ | Fill in both dates and times |
| `tracking.history.rangeEndBeforeStart` | เวลาสิ้นสุดต้องหลังเวลาเริ่ม | The end must be after the start |
| `tracking.history.rangeTooLong` | ช่วงเวลาต้องไม่เกิน {hours} ชั่วโมง | The range can be {hours} hours at most |
| `tracking.history.rangeFuture` | เวลาเริ่มต้องไม่อยู่ในอนาคต | The start cannot be in the future |

(`startDate` ฯลฯ เป็น label ของช่อง — `rangeStart` / `rangeEnd` เป็นหัวกลุ่ม · `{hours}` = `HISTORY_MAX_HOURS`)

- [ ] **Step 1: test ที่ fail** (ใน `HistoryPage.test.tsx` · วันใช้ `shiftDay(bangkokDateOf(new Date()), -2)` = `d2` และ `-1` = `d1` ให้อยู่ในอดีตเสมอ)
  - `'editing the fields does not load; Show route loads the Bangkok window'`: เปิด `q(today)` · ตั้ง start `d2` `20:00`, end `d1` `06:00` ⇒ `historyApi.history` ยังถูกเรียก 1 ครั้ง · กด `ดูเส้นทาง` ⇒ เรียกครั้งที่ 2 ด้วย `('1', bangkokInstant(d2,'20:00'), bangkokInstant(d1,'06:00'))`
  - `'a range over 36 h, a reversed range or an empty time cannot be shown'`: start `d2 00:00` end `d1 13:00` (37 ชม.) ⇒ ปุ่ม disabled + ข้อความ `ช่วงเวลาต้องไม่เกิน 36 ชั่วโมง` · end ก่อน start ⇒ `เวลาสิ้นสุดต้องหลังเวลาเริ่ม` · ลบเวลาเริ่ม ⇒ `กรอกวันและเวลาให้ครบ`
  - `'Whole day loads the start date; previous day shifts a custom window by 24 h and updates the fields'`: จากช่วง `d1 20:00 → today 06:00` (เปิดด้วย URL) กด `วันก่อนหน้า` ⇒ เรียกด้วยช่วงเลื่อน −24 ชม. และช่องเริ่มแสดง `d2` `20:00` · กด `ทั้งวัน` ⇒ เรียกด้วย `dayWindowOf(d2)`
  - `'timeline rows carry the day when the window spans days'`: เปิดช่วง `d1 20:00 → today 06:00` ⇒ ปุ่มแถวจุดแวะชื่อ `/จุดแวะที่ 1 · 23 พ\.ย\. 08:00/` (fixture `startAt` = `2026-11-23T01:00Z`) · เปิด `q(today)` (ทั้งวัน) ⇒ `/จุดแวะที่ 1 · 08:00/`
  - test เดิม `'previous day moves the window; next day is disabled on today'` คงไว้ (ชื่อปุ่มเดิม)
- [ ] **Step 2: รันให้ fail** — `cd client; npx vitest run src/features/tracking-history/HistoryPage.test.tsx`
- [ ] **Step 3: implement หน้าจอ + i18n ตามด้านบน** — ช่องใช้ `Input` จาก `@/components/ui/input` (`type="date"` มี `max` = วันนี้, `type="time"`) · `min-h-11` เหมือนปุ่มเดิม · จอแคบให้กลุ่ม เริ่ม / สิ้นสุด ขึ้นบรรทัดใหม่ได้ (`flex-wrap`)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม ⇒ PASS แล้ว `cd client; npm run typecheck; npm run lint; npm test` ⇒ ผ่านทั้งหมด

---

### Task 5: เอกสาร + ตรวจทั้งระบบ

**Files:**
- Modify: `docs/blueprint/05-api-design.md:87` ("ช่วงเกิน 24 ชม." ⇒ 36) · `docs/blueprint/06-frontend-architecture.md:147` (เลือกกล้อง + ช่วงเริ่ม–สิ้นสุดเวลาไทย ≤ 36 ชม. ข้ามวันได้ · โหลดเมื่อกด ดูเส้นทาง · ทั้งวัน / วันก่อน / วันถัดไป เลื่อนทั้งช่วง 24 ชม. · แถวมีวันเมื่อคร่อมวัน) · `docs/blueprint/09-risks-open-questions.md` (เพิ่ม DL77 ท้ายตาราง)
- ไม่แตะ: `08-implementation-roadmap.md:89` (ผลวัด 24 ชม. เป็นข้อเท็จจริงที่วัดไว้) และ ≤ 24 ชม. ของวิดีโอย้อนหลัง / export

- [ ] **Step 1: DL77** — `| DL77 | **ประวัติเส้นทางเลือกช่วงเวลาเองได้ ข้ามวันได้ ไม่เกิน 36 ชม.** (Q53 · 2026-11-25): ช่องเริ่ม / สิ้นสุด (วัน + เวลาไทย) โหลดเมื่อกด ดูเส้นทาง · ทั้งวัน · วันก่อน / ถัดไปเลื่อนทั้งช่วง 24 ชม. · แถวลำดับเหตุการณ์มีวันเมื่อช่วงคร่อมวัน · server `HISTORY_MAX_RANGE_HOURS` 36 · ไม่แตะเพดาน 24 ชม. ของวิดีโอย้อนหลัง | หัวหน้าคำนวณระยะเดินทางของเที่ยว / กะที่ข้ามเที่ยงคืน · 36 ชม. ≈ 8,600 จุด ต่ำกว่าเพดานอ่าน 50,000 | ผู้ใช้: ระยะทางของช่วงเวลาที่เลือก ข้ามวันได้ ไม่เกิน 36 ชม. แบบ ก · ผู้ออกแบบ (ทั้งวัน, เลื่อนทั้งช่วง, วันในแถว) |`
- [ ] **Step 2: แก้ Part 5, Part 6 ตาม Files**
- [ ] **Step 3: ตรวจ server** — `cd server; npm run lint; npm run typecheck; npm test` ⇒ ผ่าน · `npx vitest run --config vitest.integration.config.ts src/modules/tracking` ⇒ ผ่าน
- [ ] **Step 4: ตรวจในเบราว์เซอร์** — preview `api` + `client` · login `admin` (dev seed) · `/tracking/history` กล้อง `1000027` ช่วง `18/11 00:00 → 19/11 12:00` (36 ชม.) ⇒ 200 และ URL ตรงช่วงที่กรอก · 37 ชม. ⇒ ปุ่มกดไม่ได้ · screenshot
- [ ] **Step 5: เสนอข้อความ commit** (ไม่ commit เอง)
