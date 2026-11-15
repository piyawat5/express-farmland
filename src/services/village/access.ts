import { prisma } from '../../lib/prisma';

// ════════════════════════════════════════════════════════════════════
//  สิทธิ์เดินเข้าฟาร์ม (P9) — แยกไฟล์เพื่อให้ lib/realtime import ได้โดยไม่วนกลับมาหา service
//
//  เจ้าของ = เข้าได้เสมอ (ตกแต่งฟาร์มตัวเองได้แม้ยังไม่เข้าร่วมหมู่บ้าน)
//  คนอื่น  = ทั้งคู่ต้อง "เข้าร่วมหมู่บ้าน" แล้ว + (เจ้าของเปิดฟาร์มให้ทุกคน หรือ อนุมัติให้คนนี้)
//  ⚠️ แอดมินไม่มีสิทธิ์พิเศษ (v1 เข้าได้ทุกฟาร์ม — v2 ข้อมูลฟาร์มเห็นเฉพาะเจ้าของ)
// ════════════════════════════════════════════════════════════════════

export async function isJoined(userId: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { villageJoinedAt: true, active: true } });
  return !!u?.active && u.villageJoinedAt != null;
}

export async function canViewFarm(user: { id: number }, systemId: number): Promise<boolean> {
  const sys = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true, villageOpen: true, owner: { select: { villageJoinedAt: true, active: true } } },
  });
  if (!sys) return false;
  if (sys.ownerId === user.id) return true;
  if (!sys.owner.active || sys.owner.villageJoinedAt == null) return false;
  if (!(await isJoined(user.id))) return false;
  if (sys.villageOpen) return true;
  const grant = await prisma.farmAccess.findUnique({
    where: { ownerId_visitorId: { ownerId: sys.ownerId, visitorId: user.id } },
    select: { status: true, revokedAt: true },
  });
  return grant?.status === 'APPROVED' && grant.revokedAt == null;
}
