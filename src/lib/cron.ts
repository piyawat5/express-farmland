/**
 * cron แบบเบาๆ (5 ฟิลด์: minute hour dayOfMonth month dayOfWeek)
 * รองรับ `*`, `*​/n`, `a-b`, `a,b,c`, ตัวเลขเดี่ยว — พอสำหรับ ReminderRule (เช่น "0 20 *​/2 * *")
 *
 * เขียนเองแทนการเพิ่ม dependency (cron-parser) เพื่อให้ deploy บน Plesk ง่าย
 * ใช้ "เวลาท้องถิ่นของ server" (getHours/getDate ฯลฯ) — single user จึงไม่ยุ่งเรื่อง timezone
 */

/** แตกฟิลด์ cron 1 ช่อง → เซ็ตของค่าที่ตรง */
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    const slash = part.split('/');
    if (slash.length === 2) {
      range = slash[0];
      step = parseInt(slash[1], 10);
    }
    let lo = min;
    let hi = max;
    if (range === '*' || range === '') {
      // คงค่า min..max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((v) => parseInt(v, 10));
      lo = a;
      hi = b;
    } else {
      lo = hi = parseInt(range, 10);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** เวลานี้ (รายนาที) ตรงกับ cron expression ไหม */
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron ต้องมี 5 ฟิลด์: "${expr}"`);
  const [m, h, dom, mon, dow] = parts;

  const minOk = parseField(m, 0, 59).has(date.getMinutes());
  const hourOk = parseField(h, 0, 23).has(date.getHours());
  const monOk = parseField(mon, 1, 12).has(date.getMonth() + 1);
  if (!minOk || !hourOk || !monOk) return false;

  // วันตามมาตรฐาน cron: ถ้าทั้ง dom และ dow ถูกจำกัด → match แบบ "หรือ"
  // ถ้าตัวใดเป็น `*` → ใช้อีกตัวตัดสิน (match แบบ "และ")
  const domOk = parseField(dom, 1, 31).has(date.getDate());
  const dowOk = parseField(dow, 0, 6).has(date.getDay()); // 0 = อาทิตย์
  const domR = dom !== '*';
  const dowR = dow !== '*';
  return domR && dowR ? domOk || dowOk : domOk && dowOk;
}

/** หาเวลาถัดไป (รายนาที) ที่ตรง cron — ไล่ทีละนาทีในกรอบ 1 ปี */
export function nextCronAfter(expr: string, from: Date): Date {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(expr, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new Error(`คำนวณรอบ cron ถัดไปไม่ได้ภายใน 1 ปี: "${expr}"`);
}
