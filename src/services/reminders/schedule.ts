import type { RepeatType } from '@prisma/client';

// ════════════════════════════════════════════════════════════════════
//  คำนวณรอบแจ้งเตือน (pure — ไม่แตะ DB, ใช้ร่วมกับ mock ของหน้าเว็บได้ตรงกัน)
//  เวลาเป็นเวลาไทยเสมอ (process.env.TZ = Asia/Bangkok)
//
//  หลัก: รอบถัดไปนับจาก "วันที่ทำจริง" — ทำช้า 2 วัน รอบหน้าก็เลื่อนตาม (ไม่เด้งถี่ไล่ตามรอบเดิม)
// ════════════════════════════════════════════════════════════════════

export const DAY_MS = 86_400_000;

export type ScheduleRule = {
  repeat: RepeatType;
  everyDays: number | null;
  weekdays: string | null;
  timeOfDay: string;
};

export function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** วันเดียวกับ day แต่เวลา "HH:mm" */
export function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  const x = new Date(day.getTime());
  x.setHours(h || 0, m || 0, 0, 0);
  return x;
}

/** ห่างกันกี่วันตามปฏิทิน (b − a) — ไม่ใช่ 24 ชม. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** "2026-11-14" (วันของไทย) → Date 00:00 — ห้ามใช้ new Date('YYYY-MM-DD') เพราะเป็น UTC */
export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "1,4" → [1, 4] (0 = อาทิตย์) */
export function parseWeekdays(s: string | null | undefined): number[] {
  if (!s) return [];
  const set = new Set(
    s
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((n) => n >= 0 && n <= 6),
  );
  return [...set].sort((a, b) => a - b);
}

/** ชั่วโมงส่งอีเมล "8,12,16,20" → [8, 12, 16, 20] */
export function parseHours(s: string | null | undefined): number[] {
  if (!s) return [];
  const set = new Set(
    s
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((n) => n >= 0 && n <= 23),
  );
  return [...set].sort((a, b) => a - b);
}

/** วันแรกตั้งแต่ from (รวม from) ที่เป็นวันในสัปดาห์ที่เลือก */
function nextWeekdayOnOrAfter(from: Date, days: number[]): Date | null {
  if (!days.length) return null;
  let d = startOfDay(from);
  for (let i = 0; i < 7; i++) {
    if (days.includes(d.getDay())) return d;
    d = addDays(d, 1);
  }
  return null;
}

/** กฎแบบนี้สร้างงานตามเวลาไหม (ให้อาหาร = ตามแผนให้อาหาร P4, เช็คปู = ตามปูที่ถึงรอบ) */
export const isTimeBased = (r: { repeat: RepeatType }) => r.repeat === 'EVERY_DAYS' || r.repeat === 'WEEKDAYS' || r.repeat === 'ONCE';

/**
 * รอบแรกนับจากตอนนี้ (สร้างใหม่ / เปิดใช้ใหม่): วันนี้ถ้ายังไม่เลยเวลา ไม่งั้นรอบถัดไปที่ตรงกฎ
 * ONCE ไม่ใช้ฟังก์ชันนี้ (ผู้ใช้เลือกวันเอง)
 */
export function firstDueFrom(rule: ScheduleRule, now: Date): Date | null {
  switch (rule.repeat) {
    case 'EVERY_DAYS': {
      const today = atTime(now, rule.timeOfDay);
      return today > now ? today : atTime(addDays(now, 1), rule.timeOfDay);
    }
    case 'WEEKDAYS': {
      const days = parseWeekdays(rule.weekdays);
      let d = nextWeekdayOnOrAfter(now, days);
      if (!d) return null;
      if (atTime(d, rule.timeOfDay) <= now) d = nextWeekdayOnOrAfter(addDays(d, 1), days);
      return d ? atTime(d, rule.timeOfDay) : null;
    }
    default:
      return null;
  }
}

/** รอบแรกเมื่อผู้ใช้เลือก "เริ่มวัน" เอง (วันนั้นเลยเวลาแล้วก็ยังนับวันนั้น = ขึ้นเป็นงานทันที) */
export function firstDueOn(rule: ScheduleRule, startDay: Date): Date | null {
  switch (rule.repeat) {
    case 'EVERY_DAYS':
    case 'ONCE':
      return atTime(startDay, rule.timeOfDay);
    case 'WEEKDAYS': {
      const d = nextWeekdayOnOrAfter(startDay, parseWeekdays(rule.weekdays));
      return d ? atTime(d, rule.timeOfDay) : null;
    }
    default:
      return null;
  }
}

/** รอบถัดไปหลังทำเสร็จ/ข้ามเมื่อ `at` — null = ไม่มีรอบต่อ (ครั้งเดียว) */
export function nextDueAfter(rule: ScheduleRule, at: Date): Date | null {
  switch (rule.repeat) {
    case 'EVERY_DAYS':
      return atTime(addDays(startOfDay(at), Math.max(1, rule.everyDays ?? 1)), rule.timeOfDay);
    case 'WEEKDAYS': {
      // นับตั้งแต่วันพรุ่งนี้ของวันที่ทำ (ทำวันพุธแทนวันจันทร์ → รอบถัดไปคือวันที่ตรงกฎหลังวันพุธ)
      const d = nextWeekdayOnOrAfter(addDays(startOfDay(at), 1), parseWeekdays(rule.weekdays));
      return d ? atTime(d, rule.timeOfDay) : null;
    }
    default:
      return null;
  }
}

/**
 * รอบที่คาดว่าจะเกิดในช่วง [from, to] (โชว์ในปฏิทินเป็น "ตามแผน") — สมมติว่าทำตรงเวลาทุกรอบ
 * `start` = รอบถัดไปที่ยังไม่มีงาน
 */
export function projectDues(rule: ScheduleRule, start: Date | null, from: Date, to: Date, max = 62): Date[] {
  const out: Date[] = [];
  let cur = start;
  let guard = 0;
  while (cur && cur <= to && out.length < max && guard++ < 400) {
    if (cur >= from) out.push(cur);
    if (rule.repeat === 'ONCE') break;
    cur = nextDueAfter(rule, cur);
  }
  return out;
}

/** "ทุก 4 วัน" · "ทุกวันจันทร์, พฤหัส" · "ครั้งเดียว" — ใช้ในอีเมล */
const DOW_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export function repeatLabel(rule: ScheduleRule): string {
  switch (rule.repeat) {
    case 'EVERY_DAYS':
      return rule.everyDays === 1 ? 'ทุกวัน' : `ทุก ${rule.everyDays} วัน`;
    case 'WEEKDAYS':
      return `ทุก ${parseWeekdays(rule.weekdays)
        .map((d) => DOW_SHORT[d])
        .join(' ')}`;
    case 'ONCE':
      return 'ครั้งเดียว';
    case 'FEEDING_PLAN':
      return 'ตามแผนให้อาหาร';
  }
}
