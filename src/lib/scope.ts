import type { AuthUser } from '../services/auth.service';
import { prisma } from './prisma';
import { notFound } from './http';

// ════════════════════════════════════════════════════════════════════
//  Per-user data isolation — helper กลางสำหรับกรองข้อมูลตามเจ้าของ
//  หลักการ: FARM_OWNER เห็น/แก้ได้เฉพาะของตัวเอง; ADMIN เห็น/แก้ได้ทุกคน (god mode)
//
//  2 กลุ่มโมเดล:
//   - กลุ่ม 1 (system-scoped): เจ้าของ = CrabSystem.ownerId → ใช้ systemScopeWhere / ownedSystemIds
//   - กลุ่ม 2 (มี ownerId ตรงๆ): Contact/Substance/InventoryItem/DosingRule/ReminderRule/LedgerEntry
//                                 → ใช้ ownerWhere / assertOwnership
// ════════════════════════════════════════════════════════════════════

export const isAdmin = (user: AuthUser) => user.role === 'ADMIN';

/** systemId ทั้งหมดที่ user เป็นเจ้าของ; ADMIN → null = ไม่จำกัด */
export async function ownedSystemIds(user: AuthUser): Promise<number[] | null> {
  if (isAdmin(user)) return null;
  const rows = await prisma.crabSystem.findMany({
    where: { ownerId: user.id },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * where-fragment สำหรับ field `systemId` (โมเดลกลุ่ม 1)
 * - ADMIN: ไม่กรอง (หรือกรองตาม filterSystemId ถ้าระบุ)
 * - FARM_OWNER: จำกัดเฉพาะระบบของตัวเอง; ถ้าขอ systemId ที่ไม่ใช่ของตัวเอง → คืน clause ที่ไม่ match อะไรเลย
 */
export async function systemScopeWhere(
  user: AuthUser,
  filterSystemId?: number,
): Promise<{ systemId?: number | { in: number[] } }> {
  if (isAdmin(user)) {
    return filterSystemId == null ? {} : { systemId: filterSystemId };
  }
  const ids = await ownedSystemIds(user);
  const owned = ids ?? [];
  if (filterSystemId != null) {
    return { systemId: { in: owned.includes(filterSystemId) ? [filterSystemId] : [] } };
  }
  return { systemId: { in: owned } };
}

/** where-fragment สำหรับโมเดลที่มี `ownerId` ตรงๆ (กลุ่ม 2); ADMIN → {} = ไม่กรอง */
export const ownerWhere = (user: AuthUser): { ownerId?: number } =>
  isAdmin(user) ? {} : { ownerId: user.id };

/** assert ว่า user เข้าถึง entity ที่เจ้าของ = ownerId ได้ (ADMIN ผ่านเสมอ) — ไม่ผ่าน → 404 (ไม่บอกว่ามีอยู่) */
export function assertOwnership(user: AuthUser, ownerId: number | null | undefined): void {
  if (isAdmin(user)) return;
  if (ownerId !== user.id) throw notFound('ไม่พบข้อมูลนี้');
}
