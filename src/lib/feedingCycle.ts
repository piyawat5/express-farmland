// ════════════════════════════════════════════════════════════════════
//  feedingCycle — คณิตศาสตร์วงรอบให้อาหาร "ให้ N วัน เว้น M วัน" (Phase 21)
//
//  ทำไมไม่ใช้ cron: คาบแบบ 3 วัน (2 เว้น 1) หารกับเดือนไม่ลงตัว — `*/3` จะรีเซ็ต
//  ทุกต้นเดือน ทำให้รอบเพี้ยน จึงคำนวณจาก anchorDate (วันแรกของช่วง "ให้") แทน
//
//  โมดูลนี้ pure ล้วน (ไม่แตะ prisma) แบบเดียวกับ lib/cron.ts → เทสง่าย
//  ⚠️ ใช้เวลา "ท้องถิ่น" ทั้งหมด — config/env.ts ตั้ง process.env.TZ='Asia/Bangkok' ไว้แล้ว
// ════════════════════════════════════════════════════════════════════

/** เที่ยงคืนของ "วันนั้น" ตามเวลาท้องถิ่น (ไทย) */
export function startOfLocalDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * "YYYY-MM-DD" ตามเวลาท้องถิ่น
 * ⚠️ ห้ามใช้ toISOString().slice(0,10) แทน — นั่นเป็น UTC ทำให้ช่วง 00:00–07:00 น.
 * ได้ "วันเมื่อวาน" (เป็นบั๊กที่ทำให้รอบเปิดผิดวัน)
 */
export function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** +n วัน (ใช้ setDate — ปลอดภัยกว่าบวก ms เพราะข้าม DST/สิ้นเดือนได้ถูก) */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

/** จำนวน "วัน" เต็มระหว่าง 2 วัน (นับที่เที่ยงคืนท้องถิ่นทั้งคู่) */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime()) / 86_400_000);
}

export type CycleFields = {
  onDays: number;
  offDays: number;
  anchorDate: Date;
  timeOfDay?: string | null;
};

const DEFAULT_FEED_TIME = '20:00';

/** แยก "HH:mm" → [ชม., นาที] (ค่าผิดรูป → ใช้ดีฟอลต์) */
function parseTime(timeOfDay?: string | null): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay || DEFAULT_FEED_TIME).trim());
  if (!m) return [20, 0];
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return [hh, mm];
}

/**
 * วันนี้เป็น "วันให้อาหาร" ไหม
 * รอบ = onDays + offDays; ตำแหน่งในรอบ < onDays = วันให้
 * ใช้ ((x % n) + n) % n เพราะ JS % คืนค่าติดลบได้ (กรณีวันก่อน anchorDate)
 */
export function isFeedDay(plan: CycleFields, day: Date): boolean {
  const cycle = plan.onDays + plan.offDays;
  if (plan.onDays <= 0 || cycle <= 0) return false;
  if (plan.offDays <= 0) return true; // ให้ทุกวัน
  const pos = ((dayDiff(day, plan.anchorDate) % cycle) + cycle) % cycle;
  return pos < plan.onDays;
}

/** เวลาให้อาหารรอบถัดไปหลังจาก `after` (ตรงกับ timeOfDay ของแผน) */
export function nextFeedRunAt(plan: CycleFields, after: Date): Date | null {
  const cycle = plan.onDays + plan.offDays;
  if (plan.onDays <= 0 || cycle <= 0) return null;
  const [hh, mm] = parseTime(plan.timeOfDay);
  // ไล่ทีละวันไม่เกิน 1 รอบเต็ม + 1 วัน → เจอแน่นอน (กันวนไม่รู้จบ)
  for (let i = 0; i <= cycle + 1; i++) {
    const c = startOfLocalDay(addDays(after, i));
    c.setHours(hh, mm, 0, 0);
    if (c > after && isFeedDay(plan, c)) return c;
  }
  return null;
}

/** เวลาให้อาหารของวันที่กำหนด (ใช้ตอนเปิดรอบย้อนหลัง/เปิดเอง) */
export function feedTimeOn(plan: CycleFields, day: Date): Date {
  const [hh, mm] = parseTime(plan.timeOfDay);
  const c = startOfLocalDay(day);
  c.setHours(hh, mm, 0, 0);
  return c;
}

/** พรีวิววันให้อาหาร n วันข้างหน้า (โชว์ในหน้าตั้งค่าแผน ให้เห็นว่ารอบตกวันไหน) */
export function previewFeedDays(plan: CycleFields, from: Date, days = 14): { date: string; feed: boolean }[] {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    return { date: ymdLocal(d), feed: isFeedDay(plan, d) };
  });
}

// ── คะแนนการกิน (ใช้ทำ "หลอดพลัง" = เฉลี่ย 5 รอบล่าสุด) ──
// ป้ายชุดเดียวกับที่หน้าเว็บใช้อยู่ (CrabsView.FEEDING_TAGS) — เก็บลง Crab.feedingNote เหมือนเดิม
export const FEEDING_TAGS = ['ไม่กินปลา', 'ไม่กินหอย', 'กินปลาปกติ', 'กินหอยปกติ', 'กินน้อย'] as const;

/**
 * คะแนน 0–100: กินครบทุกอย่างที่บันทึกในรอบนี้=100 (รอบให้อาหารชนิดเดียวก็เต็ม 100 ได้ ไม่ต้องมีทั้งปลา+หอย)
 * · ให้ 2 ชนิดแต่ปฏิเสธไปอย่างนึง (มีแท็ก "ไม่กิน...")=65 · กินน้อย=35 · ปฏิเสธทั้งหมด/ไม่มีข้อมูล=0
 */
export function scoreFromTags(tags: string[]): number {
  const ateNormal = tags.includes('กินปลาปกติ') || tags.includes('กินหอยปกติ');
  const refusedSome = tags.includes('ไม่กินปลา') || tags.includes('ไม่กินหอย');
  const little = tags.includes('กินน้อย');

  if (ateNormal && !refusedSome && !little) return 100;
  if (ateNormal && refusedSome) return 65;
  if (little) return 35;
  return 0;
}

// ── อาหารของรอบ + ผลการกินแบบติ๊กทีเดียว (Phase 24, 2026-09-13) ──
// รอบนึงให้อาหารชนิดเดียว (ดูข้อมูลจริง: เกือบทุกรอบมีแต่ป้ายปลา หรือแต่ป้ายหอย)
// → รู้อาหารของรอบแล้ว ปูแต่ละตัวเหลือแค่ 3 สถานะ แล้วแปลงกลับเป็นป้ายชุดเดิม
// เพื่อไม่ให้ Crab.feedingNote / ป้ายบนกล่อง / scoreFromTags / หลอดพลัง ต้องแก้ตาม

export const FOOD_TYPES = ['FISH', 'SHELLFISH', 'MIXED'] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

export const EAT_RESULTS = ['ATE', 'LITTLE', 'NONE'] as const;
export type EatResult = (typeof EAT_RESULTS)[number];

const FISH_TAGS = ['กินปลาปกติ', 'ไม่กินปลา'];
const SHELL_TAGS = ['กินหอยปกติ', 'ไม่กินหอย'];

/** ผลการกิน + อาหารของรอบ → ป้าย (MIXED = ได้ทั้งปลาและหอย) */
export function tagsForResult(result: EatResult, food: FoodType): string[] {
  if (result === 'LITTLE') return ['กินน้อย'];
  const fish = food !== 'SHELLFISH';
  const shell = food !== 'FISH';
  if (result === 'ATE') return [...(fish ? ['กินปลาปกติ'] : []), ...(shell ? ['กินหอยปกติ'] : [])];
  return [...(fish ? ['ไม่กินปลา'] : []), ...(shell ? ['ไม่กินหอย'] : [])];
}

/** ป้ายเดิม → ผลการกิน 3 สถานะ (ใช้ตอนเปลี่ยนอาหารของรอบย้อนหลัง) — กินอย่าง/ไม่กินอย่าง = กินน้อย */
export function resultFromTags(tags: string[]): EatResult {
  const score = scoreFromTags(tags);
  if (score === 100) return 'ATE';
  if (score === 0) return 'NONE';
  return 'LITTLE';
}

/**
 * อนุมานอาหารของรอบเก่า (ก่อนมีคอลัมน์ foodType) จากป้ายของทุกตัวในรอบ
 * นับ "จำนวนตัว" ที่มีป้ายปลา/หอย — ฝั่งน้อยมีไม่ถึงครึ่งของฝั่งมาก = ถือว่ากดผิดไม่กี่ตัว
 * (ข้อมูลจริง: ปลา 32 + หอย 3 = FISH, ปลา 26 + หอย 26 = MIXED)
 */
export function inferFoodType(tagLists: string[][]): FoodType | null {
  let fish = 0;
  let shell = 0;
  for (const tags of tagLists) {
    if (tags.some((t) => FISH_TAGS.includes(t))) fish++;
    if (tags.some((t) => SHELL_TAGS.includes(t))) shell++;
  }
  if (!fish && !shell) return null;
  const major = Math.max(fish, shell);
  const minor = Math.min(fish, shell);
  if (minor / major >= 0.5) return 'MIXED';
  return fish > shell ? 'FISH' : 'SHELLFISH';
}
