import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler, notFound } from '../lib/http';
import { canViewFarm } from '../lib/scope';
import { verifyAccessToken, type AuthUser } from '../services/auth.service';

// ════════════════════════════════════════════════════════════════════
//  Auth middleware — requireAuth / requireAdmin / ownership (RBAC ข้อ 1.2)
//  หลักการ: อ่านได้ทุกคนที่ login; แก้ได้เฉพาะ admin หรือเจ้าของระบบนั้น
// ════════════════════════════════════════════════════════════════════

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function bearerToken(req: Request): string | null {
  const h = req.get('authorization');
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** ต้อง login (มี access token valid) — ใส่ req.user */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  req.user = verifyAccessToken(token);
  next();
});

/** ต้องเป็น admin */
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  if (req.user.role !== 'ADMIN') throw new AppError(403, 'ต้องเป็นผู้ดูแลระบบ (admin)');
  next();
});

/** admin ผ่านเสมอ; farm owner ต้องเป็นเจ้าของระบบนั้น ไม่งั้น 403 */
export async function assertCanEditSystem(user: AuthUser, systemId: number): Promise<void> {
  if (user.role === 'ADMIN') return;
  const system = await prisma.crabSystem.findUnique({
    where: { id: systemId },
    select: { ownerId: true },
  });
  if (!system) throw notFound('ไม่พบระบบปูนี้');
  if (system.ownerId !== user.id) throw new AppError(403, 'แก้ไขได้เฉพาะระบบปูของตัวเอง');
}

/**
 * หมู่บ้านฟาร์ม (Phase 23) — assert สิทธิ์ "เข้าไปเดินชม" (กว้างกว่าสิทธิ์แก้ไข)
 * ⚠️ โยน 404 ไม่ใช่ 403 โดยตั้งใจ (ตาม assertOwnership) — ถ้าเป็น 403 endpoint นี้
 *    จะกลายเป็นเครื่องมือไล่เดาว่า systemId ไหนมีอยู่จริงในฐานข้อมูล
 */
export async function assertCanViewFarm(user: AuthUser, systemId: number): Promise<void> {
  if (!(await canViewFarm(user, systemId))) {
    throw notFound('ไม่พบฟาร์มนี้ หรือยังไม่ได้รับอนุญาตให้เข้าชม');
  }
}

type SystemIdResolver = (req: Request) => number | null | Promise<number | null>;

/** middleware คู่กับ requireSystemEdit แต่เป็นระดับ "อ่าน/เดินชม" */
export const requireFarmView = (getSystemId: SystemIdResolver) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
    const systemId = await getSystemId(req);
    if (systemId == null) throw notFound('ไม่พบฟาร์มที่เกี่ยวข้อง');
    await assertCanViewFarm(req.user, systemId);
    next();
  });

/** middleware กันการแก้ระบบของคนอื่น — resolve systemId จาก request แล้วเช็คสิทธิ์ */
export const requireSystemEdit = (getSystemId: SystemIdResolver) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
    const systemId = await getSystemId(req);
    if (systemId == null) throw notFound('ไม่พบระบบที่เกี่ยวข้อง');
    await assertCanEditSystem(req.user, systemId);
    next();
  });

// ── resolvers: หา systemId จากแหล่งต่างๆ ของ request ──────────────────
export const systemIdFromParam =
  (param = 'id'): SystemIdResolver =>
  (req) => {
    const v = Number(req.params[param]);
    return Number.isFinite(v) ? v : null;
  };

export const systemIdFromBody =
  (field = 'systemId'): SystemIdResolver =>
  (req) => {
    const v = (req.body as Record<string, unknown> | undefined)?.[field];
    return v == null ? null : Number(v);
  };

const systemIdByEntity =
  (loader: (id: number) => Promise<{ systemId: number | null } | null>): SystemIdResolver =>
  async (req) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return null;
    const row = await loader(id);
    return row?.systemId ?? null;
  };

export const systemIdFromCrab = systemIdByEntity((id) =>
  prisma.crab.findUnique({ where: { id }, select: { systemId: true } }),
);
export const systemIdFromBox = systemIdByEntity((id) =>
  prisma.crabBox.findUnique({ where: { id }, select: { systemId: true } }),
);
export const systemIdFromFilterTank = systemIdByEntity((id) =>
  prisma.filterTank.findUnique({ where: { id }, select: { systemId: true } }),
);
export const systemIdFromWaterTest = systemIdByEntity((id) =>
  prisma.waterTest.findUnique({ where: { id }, select: { systemId: true } }),
);
export const systemIdFromDosingCalibration = systemIdByEntity((id) =>
  prisma.dosingCalibration.findUnique({ where: { id }, select: { systemId: true } }),
);
export const systemIdFromFeedingRound = systemIdByEntity((id) =>
  prisma.feedingRound.findUnique({ where: { id }, select: { systemId: true } }),
);

/**
 * dosing rule แก้ได้: rule ของระบบ → ต้องเป็นเจ้าของระบบ; rule กลาง (systemId=null) → ต้องเป็นเจ้าของกฎ
 * (per-user: กฎกลางผูกเจ้าของผ่าน ownerId แล้ว — ADMIN ผ่านเสมอ)
 */
export const requireDosingRuleEdit = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  const rule = await prisma.dosingRule.findUnique({
    where: { id: Number(req.params.id) },
    select: { systemId: true, ownerId: true },
  });
  if (!rule) throw notFound('ไม่พบกฎการปรุงน้ำนี้');
  if (rule.systemId != null) {
    await assertCanEditSystem(req.user, rule.systemId);
  } else if (req.user.role !== 'ADMIN' && rule.ownerId !== req.user.id) {
    throw new AppError(403, 'แก้ไขได้เฉพาะกฎของตัวเอง');
  }
  next();
});
