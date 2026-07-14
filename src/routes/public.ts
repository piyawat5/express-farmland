import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { getPublicShop } from '../services/public.service';

// ════════════════════════════════════════════════════════════════════
//  หน้าร้าน public (ข้อ 5) — ไม่ต้อง login (mount ก่อน requireAuth)
// ════════════════════════════════════════════════════════════════════

const router = Router();

router.get(
  '/shop/:slug',
  validate({ params: z.object({ slug: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    res.json(await getPublicShop(req.params.slug));
  }),
);

export default router;
