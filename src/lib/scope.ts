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

// ════════════════════════════════════════════════════════════════════
//  หมู่บ้านฟาร์ม (Phase 23) — สิทธิ์ "เข้าไปเดินชม" ซึ่งกว้างกว่าสิทธิ์เจ้าของ
//
//  ⚠️ นี่เป็นการอ่านข้ามผู้ใช้ครั้งแรกของแอป — ทุก list ที่มีอยู่กรองด้วย
//     ownerWhere/systemScopeWhere ทั้งหมด อย่าเอา 2 อย่างนี้ไปปนกัน
//     (สิทธิ์ "เดินชม" ไม่ได้แปลว่าแก้ไขได้ — การแก้ยังต้องผ่าน assertCanEditSystem เหมือนเดิม)
// ════════════════════════════════════════════════════════════════════

/** เข้าชมฟาร์ม (ระบบปู) นี้ได้ไหม — 1 query ใช้เป็นด่านของทั้ง REST และ WebSocket village.enter */
export async function canViewFarm(user: AuthUser, systemId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  const sys = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true, villageOpen: true },
  });
  // ownerId เป็น nullable — ระบบเก่า/seed ที่ไม่มีเจ้าของถือว่าไม่มีหมู่บ้าน (ไม่งั้นได้ฟาร์มที่ไล่ใครออกไม่ได้)
  if (!sys || sys.ownerId == null) return false;
  if (sys.ownerId === user.id) return true;
  if (sys.villageOpen) return true;
  const grant = await prisma.farmAccess.findUnique({
    where: { ownerId_visitorId: { ownerId: sys.ownerId, visitorId: user.id } },
    select: { status: true, revokedAt: true },
  });
  return grant?.status === 'APPROVED' && grant.revokedAt == null;
}

/** systemId ทั้งหมดที่ user "เดินเข้าชมได้" = ของตัวเอง + ที่ได้รับอนุญาต + ที่เปิดให้ทุกคน
 *  ADMIN → null = ไม่จำกัด (คอนเวนชันเดียวกับ ownedSystemIds) */
export async function visitableSystemIds(user: AuthUser): Promise<number[] | null> {
  if (isAdmin(user)) return null;
  const grants = await prisma.farmAccess.findMany({
    where: { visitorId: user.id, status: 'APPROVED', revokedAt: null },
    select: { ownerId: true },
  });
  const rows = await prisma.crabSystem.findMany({
    where: {
      OR: [
        { ownerId: user.id },
        { villageOpen: true, ownerId: { not: null } },
        ...(grants.length ? [{ ownerId: { in: grants.map((g) => g.ownerId) } }] : []),
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
