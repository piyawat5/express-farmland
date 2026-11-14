// ════════════════════════════════════════════════════════════════════
//  วันที่ภาษาไทยแบบ "มีชื่อวัน" (ตรงกับ src/lib/date.ts ของหน้าเว็บ) — ใช้ในอีเมล/ชื่องานอัตโนมัติ
//  process.env.TZ = Asia/Bangkok (config/env.ts) → getDay/getDate เป็นเวลาไทยแล้ว
// ════════════════════════════════════════════════════════════════════

const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "วันจันทร์ที่ 3 พ.ย." */
export function fmtDayLong(d: Date): string {
  return `วัน${DOW[d.getDay()]}ที่ ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** "20:00 น." */
export function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} น.`;
}
