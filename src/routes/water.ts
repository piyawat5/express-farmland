import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam, pageQuery } from '../lib/validation';
import * as svc from '../services/water.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล C — WaterTest / WaterTarget (+ dosing preview)
// ════════════════════════════════════════════════════════════════════

const waterParam = z.enum([
  'PH',
  'ALKALINITY',
  'MAGNESIUM',
  'CALCIUM',
  'SALINITY',
  'AMMONIA',
  'NITRITE',
]);

/** ค่าน้ำ 7 พารามิเตอร์ (กรอกเฉพาะตัวที่วัด) */
const waterValues = z.object({
  ph: z.number().nullable().optional(),
  alkalinity: z.number().nullable().optional(),
  magnesium: z.number().nullable().optional(),
  calcium: z.number().nullable().optional(),
  salinity: z.number().nullable().optional(),
  ammonia: z.number().nullable().optional(),
  nitrite: z.number().nullable().optional(),
});

const waterTestBody = waterValues.extend({
  testedAt: z.coerce.date().default(() => new Date()),
  note: z.string().optional(),
});

const waterTargetBody = z.object({
  parameter: waterParam,
  minTarget: z.number().nullable().optional(),
  maxTarget: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
});

// ── nested ใต้ /systems/:id ───────────────────────────────────────────
export const waterSystemRouter = Router();

waterSystemRouter.get(
  '/:id/water-tests',
  validate({ params: idParam, query: pageQuery }),
  asyncHandler(async (req, res) => {
    const { skip, take } = req.query as z.infer<typeof pageQuery>;
    res.json(serialize(await svc.listWaterTests(Number(req.params.id), { skip, take })));
  }),
);

waterSystemRouter.post(
  '/:id/water-tests',
  validate({ params: idParam, body: waterTestBody }),
  asyncHandler(async (req, res) => {
    const result = await svc.createWaterTest({ ...req.body, systemId: Number(req.params.id) });
    res.status(201).json(serialize(result));
  }),
);

waterSystemRouter.get(
  '/:id/water-targets',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listWaterTargets(Number(req.params.id))));
  }),
);

// ตั้ง/แก้ช่วงเป้าหมายของพารามิเตอร์หนึ่ง (upsert)
waterSystemRouter.put(
  '/:id/water-targets',
  validate({ params: idParam, body: waterTargetBody }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.upsertWaterTarget(Number(req.params.id), req.body)));
  }),
);

// ประเมินคำแนะนำการปรุงน้ำจากค่าที่กรอก โดยไม่บันทึก
waterSystemRouter.post(
  '/:id/dosing-preview',
  validate({ params: idParam, body: waterValues }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.previewDosing(Number(req.params.id), req.body)));
  }),
);

// ── /water-tests/:id (รายตัว) ─────────────────────────────────────────
export const waterTestRouter = Router();

waterTestRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getWaterTest(Number(req.params.id))));
  }),
);

waterTestRouter.patch(
  '/:id',
  validate({ params: idParam, body: waterTestBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateWaterTest(Number(req.params.id), req.body)));
  }),
);

waterTestRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteWaterTest(Number(req.params.id));
    res.status(204).end();
  }),
);
