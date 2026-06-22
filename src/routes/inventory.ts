import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import * as svc from '../services/inventory.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล G — InventoryItem (คลังอาหาร/สาร/อุปกรณ์ + แจ้งเตือนใกล้หมด)
// ════════════════════════════════════════════════════════════════════

const category = z.enum(['FOOD', 'SUBSTANCE', 'EQUIPMENT', 'OTHER']);
const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

const body = z.object({
  name: z.string().min(1),
  category,
  currentQty: z.number().nonnegative().optional(),
  unit: z.string().min(1),
  lowThreshold: z.number().nonnegative().nullable().optional(),
  substanceId: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
});

const listQuery = z.object({
  category: category.optional(),
  lowOnly: boolQuery.optional(),
});

const router = Router();

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { category: cat, lowOnly } = req.query as z.infer<typeof listQuery>;
    res.json(serialize(await svc.listInventory(req.user!, { category: cat, lowOnly })));
  }),
);

router.post(
  '/',
  validate({ body }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createInventory(req.user!, req.body)));
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getInventory(Number(req.params.id), req.user!)));
  }),
);

router.patch(
  '/:id',
  validate({ params: idParam, body: body.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateInventory(Number(req.params.id), req.user!, req.body)));
  }),
);

// ปรับสต็อก: delta บวก = ซื้อเข้า, ลบ = ใช้ไป
router.post(
  '/:id/adjust',
  validate({ params: idParam, body: z.object({ delta: z.number() }) }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.adjustInventory(Number(req.params.id), req.user!, req.body.delta)));
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteInventory(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

export default router;
