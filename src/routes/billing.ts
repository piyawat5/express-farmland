import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { serialize } from '../lib/serialize';
import { validate } from '../middleware/validate';
import * as subs from '../services/subscription.service';
import { getShopSettings } from '../services/settings.service';

// ════════════════════════════════════════════════════════════════════
//  /api/billing — ฝั่งลูกค้า (ใช้ได้แม้ยังไม่มีสิทธิ์ใช้งาน — หน้า "รอเปิดใช้งาน")
// ════════════════════════════════════════════════════════════════════

const router = Router();

/** ข้อมูลร้านสำหรับหน้ารอเปิดใช้งาน: พร้อมเพย์ + ช่องทางติดต่อ */
router.get(
  '/shop',
  asyncHandler(async (_req, res) => {
    const s = await getShopSettings();
    res.json({
      shopName: s.shopName,
      promptPayId: s.promptPayId,
      promptPayName: s.promptPayName,
      phone: s.phone,
      facebookName: s.facebookName,
      facebookUrl: s.facebookUrl,
      lineOaUrl: s.lineOaUrl,
      graceDays: s.graceDays,
    });
  }),
);

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json(serialize(await subs.listActivePlans()));
  }),
);

/** สิทธิ์ของฉัน + สลิปที่ส่งไป + ประวัติสิทธิ์ */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json(serialize(await subs.getMyBilling(req.user!.id)));
  }),
);

const slipBody = z.object({
  planId: z.number().int().positive(),
  amount: z.number().positive().optional(),
  // รูปอัปผ่าน POST /api/uploads/image?kind=slip มาก่อน
  imageUrl: z.string().url(),
  imagePublicId: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

router.post(
  '/slips',
  validate({ body: slipBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await subs.createSlip(req.user!.id, req.body)));
  }),
);

export default router;
