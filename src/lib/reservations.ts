// ── การจองปู (ข้อ 5) ────────────────────────────────────────────────────
// "จอง" = ปูอยู่ในใบขาย SELL/CONFIRMED โดย id ปูฝังใน note รูปแบบ "#1,2,3"
// (ไม่มีคอลัมน์ในตารางปู — derive จาก transaction) ใช้ตัดปูจองออกจากหน้าร้าน public

type TxnLike = { kind: string; status: string; note: string | null };

/** Set ของ crabId ที่ถูกจองไว้ (ใบ SELL/CONFIRMED) */
export function parseReservedCrabIds(txns: TxnLike[]): Set<number> {
  const ids = new Set<number>();
  for (const t of txns) {
    if (t.kind === 'SELL' && t.status === 'CONFIRMED') {
      const m = /#([\d,]+)/.exec(t.note ?? '');
      if (m) {
        for (const id of m[1].split(',').map(Number)) {
          if (!Number.isNaN(id)) ids.add(id);
        }
      }
    }
  }
  return ids;
}
