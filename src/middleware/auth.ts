import type { Request } from 'express';
import { AppError, asyncHandler } from '../lib/http';
import { verifyAccessToken, type AuthUser } from '../services/auth.service';
import { getAccess } from '../services/subscription.service';

// ════════════════════════════════════════════════════════════════════
//  Auth middleware — 3 ชั้น
//    requireAuth               ล็อกอินแล้ว (ใช้ได้กับหน้ารอเปิดใช้งาน / อัปสลิป / แจ้งบัค)
//    requireActiveSubscription มีสิทธิ์ใช้งาน (ทุกอย่างของฟาร์ม) — ไม่มี = 402
//    requireAdmin              หลังบ้าน
//  สิทธิ์ระดับข้อมูล (เจ้าของฟาร์ม) จะเพิ่มใน P2 พร้อม model ฟาร์ม
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

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  req.user = verifyAccessToken(token);
  next();
});

export const requireAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  if (req.user.role !== 'ADMIN') throw new AppError(403, 'ต้องเป็นผู้ดูแลระบบ');
  next();
});

/**
 * ต้องมีสิทธิ์ใช้งานที่ยังไม่หมดอายุ (แอดมินผ่านเสมอ)
 * ตอบ 402 + code SUBSCRIPTION_REQUIRED → หน้าเว็บพาไปหน้า "รอเปิดใช้งาน" เอง
 * เช็คสถานะบัญชีถูกระงับด้วย (access token ยังไม่หมดอายุก็ใช้ต่อไม่ได้)
 */
export const requireActiveSubscription = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw new AppError(401, 'ต้องเข้าสู่ระบบก่อน');
  const access = await getAccess(req.user.id);
  if (access.reason === 'SUSPENDED') throw new AppError(403, 'บัญชีนี้ถูกระงับ กรุณาติดต่อแอดมิน');
  if (!access.active) {
    throw new AppError(402, 'ยังไม่ได้เปิดใช้งาน หรือหมดอายุแล้ว', {
      code: 'SUBSCRIPTION_REQUIRED',
      reason: access.reason,
    });
  }
  next();
});
