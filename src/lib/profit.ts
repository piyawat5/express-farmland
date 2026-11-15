// ════════════════════════════════════════════════════════════════════
//  บัญชี (P6) — กติกาที่ไม่ผูกกับ DB (pure) · ⚠️ สำเนาอยู่ที่หน้าเว็บ src/lib/profit.ts (demo ใช้) แก้คู่กัน
//
//  หมวดบัญชี (คำง่ายแทนศัพท์บัญชี):
//    ต้นทุนปู (ทางตรง)        ซื้อปู* · อาหาร (*ซื้อในสต็อก + ลงเอง) · สาร/จุลินทรีย์
//    ค่าใช้จ่ายฟาร์ม (ทางอ้อม)  ค่าไฟ · ค่าน้ำ · อุปกรณ์ · ค่าแรง · อื่นๆ
//    รายรับ                   ขายปู* · อื่นๆ                    (* = ระบบลงให้จากต้นทาง)
//
//  กำไรรายล็อต = ขายได้ − ราคาล็อต − ส่วนแบ่งค่าอาหาร/ค่าฟาร์ม
//    ส่วนแบ่ง: รวมค่าใช้จ่ายที่ไม่ใช่ซื้อปูเป็น "กอง" รายเดือน → หารด้วยจำนวน "ตัว-วัน" ของปูทั้งฟาร์มในเดือนนั้น
//    → ล็อตได้ส่วนแบ่งตามจำนวนวันที่ปูของล็อตอยู่ในฟาร์ม (ปูอยู่นาน/ตัวเยอะ = กินอาหาร/ไฟมากกว่า)
// ════════════════════════════════════════════════════════════════════

export type LedgerGroup = 'DIRECT' | 'INDIRECT' | 'INCOME';
/** หมวดทั้งหมด (CRAB / SALE = ระบบลงให้เท่านั้น) */
export type LedgerCat = 'CRAB' | 'FEED' | 'SUBSTANCE' | 'ELECTRIC' | 'WATER' | 'EQUIPMENT' | 'LABOR' | 'OTHER' | 'SALE' | 'INCOME';

export const CATEGORY_GROUP: Record<LedgerCat, LedgerGroup> = {
  CRAB: 'DIRECT',
  FEED: 'DIRECT',
  SUBSTANCE: 'DIRECT',
  ELECTRIC: 'INDIRECT',
  WATER: 'INDIRECT',
  EQUIPMENT: 'INDIRECT',
  LABOR: 'INDIRECT',
  OTHER: 'INDIRECT',
  SALE: 'INCOME',
  INCOME: 'INCOME',
};

/** ชื่อหมวด (ใช้เป็นชื่อรายการที่ลงเองแล้วไม่ได้เขียนโน้ต) */
export const CATEGORY_LABEL: Record<LedgerCat, string> = {
  CRAB: 'ซื้อปู',
  FEED: 'อาหาร',
  SUBSTANCE: 'สาร/จุลินทรีย์',
  ELECTRIC: 'ค่าไฟ',
  WATER: 'ค่าน้ำ',
  EQUIPMENT: 'อุปกรณ์',
  LABOR: 'ค่าแรง',
  OTHER: 'อื่นๆ',
  SALE: 'ขายปู',
  INCOME: 'รายรับอื่นๆ',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM" ของเวลาไทย (process.env.TZ = Asia/Bangkok) */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** วันแรกของเดือน 00:00 (เวลาไทย) */
export function monthStart(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
}

export function addMonths(key: string, n: number): string {
  const d = monthStart(key);
  d.setMonth(d.getMonth() + n);
  return monthKey(d);
}

/** เดือนตั้งแต่ from ถึง to (รวมทั้งสองฝั่ง) — กันวนไม่จบด้วยเพดาน 240 เดือน */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to && out.length < 240; k = addMonths(k, 1)) out.push(k);
  return out;
}

const DAY = 86_400_000;

/** ช่วงที่ปู 1 ตัวอยู่ในฟาร์ม (ตั้งแต่วันรับเข้าล็อต ถึงวันขาย/ตาย/ตอนนี้) */
export type Stay = { lotId: number; from: Date; to: Date };

/** แบ่งช่วง → [เดือน, จำนวนวัน (มีเศษได้)] */
function stayByMonth(s: Stay): [string, number][] {
  const out: [string, number][] = [];
  if (s.to.getTime() <= s.from.getTime()) return out;
  let cur = s.from;
  while (cur.getTime() < s.to.getTime()) {
    const key = monthKey(cur);
    const nextStart = monthStart(addMonths(key, 1));
    const end = nextStart.getTime() < s.to.getTime() ? nextStart : s.to;
    out.push([key, (end.getTime() - cur.getTime()) / DAY]);
    cur = end;
  }
  return out;
}

/**
 * แบ่งกองค่าใช้จ่ายรายเดือนให้แต่ละล็อตตามจำนวนตัว-วัน
 * @param pool เดือน → ยอดค่าอาหาร/ค่าฟาร์มของเดือนนั้น
 * @returns lotId → ส่วนแบ่ง (บาท ยังไม่ปัด) · เดือนที่ไม่มีปูเลย = ไม่มีใครรับ (ไม่นับ)
 */
export function shareCosts(stays: Stay[], pool: Map<string, number>): Map<number, number> {
  const parts = stays.map((s) => ({ lotId: s.lotId, months: stayByMonth(s) }));
  const daysInMonth = new Map<string, number>();
  for (const p of parts) for (const [k, d] of p.months) daysInMonth.set(k, (daysInMonth.get(k) ?? 0) + d);
  const out = new Map<number, number>();
  for (const p of parts) {
    let share = 0;
    for (const [k, d] of p.months) {
      const total = daysInMonth.get(k) ?? 0;
      const cost = pool.get(k) ?? 0;
      if (total > 0 && cost > 0) share += (cost * d) / total;
    }
    out.set(p.lotId, (out.get(p.lotId) ?? 0) + share);
  }
  return out;
}

// ── ตัวช่วยค่าไฟ ──────────────────────────────────────────────────────

export type ElectricDevice = { key: string; name: string; watts: number; qty: number; hours: number };

/** หน่วยไฟ (kWh) ต่อเดือน — คิดเดือนละ 30 วันเท่ากันทุกเดือน (ตัวเลขที่ผู้ใช้เห็นกับที่ลงบัญชีจะตรงกัน) */
export function electricUnits(devices: ElectricDevice[]): number {
  return devices.reduce((s, d) => s + (d.watts * d.qty * d.hours * 30) / 1000, 0);
}

/** ค่าไฟประมาณต่อเดือน (บาท ปัดเต็ม) */
export function electricMonthly(devices: ElectricDevice[], rate: number): number {
  return Math.round(electricUnits(devices) * rate);
}
