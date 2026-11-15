// ════════════════════════════════════════════════════════════════════
//  น้ำ (P5) — กติกาล้วนๆ ไม่แตะ DB
//  ⚠️ สำเนาอยู่ที่หน้าเว็บ src/lib/water.ts (demo ใช้คำนวณเหมือนกัน) — แก้ที่หนึ่งต้องแก้อีกที่
// ════════════════════════════════════════════════════════════════════

export type WaterStatus = 'LOW' | 'HIGH' | 'OK' | 'NA';
export type WaterWhenT = 'LOW' | 'HIGH';
export type WaterDoT = 'DOSE' | 'WARN' | 'RETEST';

export type RuleLike = {
  when: WaterWhenT;
  action: WaterDoT;
  substanceId: number | null;
  amount: number | null;
  doseUnit: string | null;
  effect: number | null;
  note: string | null;
};

/** เทียบค่ากับเกณฑ์ — ไม่มีเกณฑ์ทั้งคู่ = NA (แสดงค่าเฉยๆ) */
export function statusOf(value: number, min: number | null, max: number | null): WaterStatus {
  if (min == null && max == null) return 'NA';
  if (min != null && value < min) return 'LOW';
  if (max != null && value > max) return 'HIGH';
  return 'OK';
}

/** ปัดจำนวนที่ต้องใส่ให้ตวงได้จริง: ≥ 10 = จำนวนเต็ม · น้อยกว่านั้น = ทีละครึ่ง (อย่างน้อยครึ่ง) */
export function roundDose(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 10) return Math.round(x);
  return Math.max(0.5, Math.round(x * 2) / 2);
}

/**
 * จำนวนสารที่ต้องใส่ (calibration ต่อระบบ — ตัวเลขที่ผู้ใช้กรอกเอง):
 *   "ใส่ [amount] [หน่วย] ค่าจะขึ้น [effect]" → 1 หน่วยเปลี่ยน effect/amount
 *   ต่ำ → ดันขึ้นถึง "สูงสุด" (ไม่มีสูงสุด = ต่ำสุด) · สูง → ลดลงถึง "ต่ำสุด" (ไม่มี = สูงสุด)
 *   ไม่ได้ใส่ effect = ใส่เท่า amount ทุกครั้ง (เช่น จุลินทรีย์ 1 ขวด)
 */
export function doseFor(value: number, min: number | null, max: number | null, rule: Pick<RuleLike, 'when' | 'amount' | 'effect'>): number | null {
  if (!rule.amount || rule.amount <= 0) return null;
  if (!rule.effect || rule.effect <= 0) return rule.amount;
  const target = rule.when === 'LOW' ? (max ?? min) : (min ?? max);
  if (target == null) return rule.amount;
  const gap = Math.abs(target - value);
  return roundDose(gap / (rule.effect / rule.amount));
}

/** 1250 → "1,250" · 0.250 → "0.25" */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** จำนวนที่ใส่: 0.5 → "ครึ่ง" */
export const fmtAmount = (n: number) => (n === 0.5 ? 'ครึ่ง' : fmtNum(n));

/** ข้อความคำแนะนำ (เก็บเป็น label ตอนกด "ทำแล้ว" ด้วย) */
export function adviceLabel(a: {
  action: WaterDoT | null;
  substanceName: string | null;
  amount: number | null;
  unit: string | null;
  note: string | null;
}): string {
  if (a.action === 'DOSE') {
    const what = `ใส่${a.substanceName ?? 'สาร'}`;
    const qty = a.amount != null ? ` ${fmtAmount(a.amount)} ${a.unit ?? ''}`.trimEnd() : '';
    return `${what}${qty}${a.note ? ` · ${a.note}` : ''}`;
  }
  if (a.action === 'RETEST') return `วัดซ้ำพรุ่งนี้${a.note ? ` · ${a.note}` : ''}`;
  if (a.action === 'WARN') return a.note || 'จัดการให้ค่ากลับเข้าเกณฑ์';
  return '';
}

/** ค่าเริ่มต้นของหน่วยใส่สาร */
export const DOSE_UNITS = ['ช้อนชา', 'ช้อนแกง', 'แก้ว', 'กรัม', 'มล.', 'ขวด', 'ซอง'];
