import { notFound } from './http';
import type { AuthUser } from '../services/auth.service';

// ════════════════════════════════════════════════════════════════════
//  ขอบเขตข้อมูลฟาร์ม (v2): เห็น/แก้ได้เฉพาะเจ้าของ — แอดมินก็ไม่เห็นฟาร์มลูกค้า
//  (ขายเป็นบริการ → ข้อมูลฟาร์มเป็นของลูกค้า) · ไม่ใช่ของเรา = 404 (กันไล่เดา id)
// ════════════════════════════════════════════════════════════════════

/** โยน 404 ถ้าไม่มี หรือไม่ใช่ของผู้ใช้คนนี้ — คืนแถวเดิม (ไม่ null) */
export function assertOwned<T extends { ownerId: number }>(row: T | null | undefined, user: AuthUser, what = 'ข้อมูล'): T {
  if (!row || row.ownerId !== user.id) throw notFound(`ไม่พบ${what}`);
  return row;
}

export const ownerWhere = (user: AuthUser) => ({ ownerId: user.id });
