// ════════════════════════════════════════════════════════════════════
//  feedingCycle — คณิตศาสตร์วงรอบให้อาหาร "ให้ N วัน เว้น M วัน" (pure ล้วน ไม่แตะ prisma)
//
//  ทำไมไม่ใช้ cron: คาบแบบ 3 วัน (2 เว้น 1) หารกับเดือนไม่ลงตัว — `*/3` จะรีเซ็ตทุกต้นเดือน
//  จึงคำนวณจาก anchorDate (วันแรกของช่วง "ให้") แทน
//  ⚠️ ใช้เวลา "ท้องถิ่น" ทั้งหมด — config/env.ts ตั้ง process.env.TZ='Asia/Bangkok' ไว้แล้ว
//  ⚠️ สำเนาอยู่ที่หน้าเว็บ src/lib/feedCycle.ts (demo + พรีวิว) — แก้กติกาต้องแก้คู่กัน
// ════════════════════════════════════════════════════════════════════

/** เที่ยงคืนของ "วันนั้น" ตามเวลาท้องถิ่น (ไทย) */
export function startOfLocalDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * "YYYY-MM-DD" ตามเวลาท้องถิ่น
 * ⚠️ ห้ามใช้ toISOString().slice(0,10) แทน — นั่นเป็น UTC ทำให้ช่วง 00:00–07:00 น. ได้ "วันเมื่อวาน"
 */
export function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "YYYY-MM-DD" → Date 00:00 เวลาไทย */
export function parseYmdLocal(s: string): Date {
  const [y, m, d] = s.split('-').map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** +n วัน (ใช้ setDate — ปลอดภัยกว่าบวก ms) */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

/** จำนวนวันเต็ม a − b (นับที่เที่ยงคืนท้องถิ่นทั้งคู่) ⚠️ ลำดับตรงข้ามกับ reminders/schedule.dayDiff */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime()) / 86_400_000);
}

export type CycleFields = {
  onDays: number;
  offDays: number;
  anchorDate: Date;
  timeOfDay?: string | null;
};

const DEFAULT_FEED_TIME = '18:00';

function parseTime(timeOfDay?: string | null): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay || DEFAULT_FEED_TIME).trim());
  if (!m) return [18, 0];
  return [Math.min(23, Math.max(0, parseInt(m[1], 10))), Math.min(59, Math.max(0, parseInt(m[2], 10)))];
}

/** วันนี้เป็น "วันให้อาหาร" ไหม — ตำแหน่งในวงรอบ < onDays = วันให้ */
export function isFeedDay(plan: CycleFields, day: Date): boolean {
  const cycle = plan.onDays + plan.offDays;
  if (plan.onDays <= 0 || cycle <= 0) return false;
  if (plan.offDays <= 0) return true;
  const pos = ((dayDiff(day, plan.anchorDate) % cycle) + cycle) % cycle;
  return pos < plan.onDays;
}

/**
 * ลำดับที่ของวันให้อาหาร นับจาก anchor (anchor = 0) — ใช้สลับอาหาร 2 อย่างทีละรอบ
 * วันก่อน anchor ได้ค่าติดลบ (ใช้ floor division จึงต่อเนื่องกัน)
 */
export function feedIndex(plan: CycleFields, day: Date): number {
  const cycle = Math.max(1, plan.onDays + plan.offDays);
  const diff = dayDiff(day, plan.anchorDate);
  const full = Math.floor(diff / cycle);
  const rem = diff - full * cycle;
  return full * plan.onDays + Math.min(rem, plan.onDays);
}

/** เวลาให้อาหารของวันที่กำหนด */
export function feedTimeOn(plan: Pick<CycleFields, 'timeOfDay'>, day: Date): Date {
  const [hh, mm] = parseTime(plan.timeOfDay);
  const c = startOfLocalDay(day);
  c.setHours(hh, mm, 0, 0);
  return c;
}
