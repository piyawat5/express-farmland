import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import { requireSystemEdit, systemIdFromBody, systemIdFromCrab } from '../middleware/auth';
import * as svc from '../services/crab.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล B — Crab (ปู)
// ════════════════════════════════════════════════════════════════════

const crabType = z.enum(['MEAT', 'EGG', 'UNKNOWN']);
const crabSex = z.enum(['MALE', 'INTERSEX', 'FEMALE', 'UNKNOWN']);
const crabGrade = z.enum(['A', 'B']);
const crabStatus = z.enum(['FATTENING', 'READY', 'SOLD', 'DEAD']);

const crabBody = z.object({
  code: z.string().nullable().optional(),
  systemId: z.number().int().positive(),
  boxId: z.number().int().positive().nullable().optional(),
  cableTieColor: z.string().max(32).nullable().optional(), // สีเคเบิ้ลไทล์ (ข้อ 2.2)
  feedingNote: z.string().max(500).nullable().optional(), // พฤติกรรมการกิน (ข้อ 4)
  lastCheckedAt: z.coerce.date().nullable().optional(), // วันเช็คไข่/เนื้อ (ข้อ 8)
  type: crabType.optional(),
  sex: crabSex.optional(),
  grade: crabGrade.nullable().optional(),
  sourceSellerId: z.number().int().positive().nullable().optional(),
  buyerId: z.number().int().positive().nullable().optional(),
  lockedForBuyerId: z.number().int().positive().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  weightG: z.number().nonnegative().nullable().optional(),
  startFirmnessPct: z.number().int().min(0).max(100).nullable().optional(),
  currentFirmnessPct: z.number().int().min(0).max(100).nullable().optional(),
  readyAt: z.coerce.date().nullable().optional(),
  sellPrice: z.number().nonnegative().nullable().optional(),
  sellDate: z.coerce.date().nullable().optional(),
  status: crabStatus.optional(),
  round: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
});

const listQuery = z.object({
  systemId: z.coerce.number().int().positive().optional(),
  status: crabStatus.optional(),
  type: crabType.optional(),
});

const exportQuery = z.object({
  systemId: z.coerce.number().int().positive().optional(),
});

const router = Router();

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { systemId, status, type } = req.query as z.infer<typeof listQuery>;
    res.json(serialize(await svc.listCrabs(req.user!, { systemId, status, type })));
  }),
);

// ส่งออกรายงานปู CSV (ข้อ 6) — ต้องมาก่อน '/:id' ไม่งั้น 'export' โดนจับเป็น id
router.get(
  '/export',
  validate({ query: exportQuery }),
  asyncHandler(async (req, res) => {
    const { systemId } = req.query as z.infer<typeof exportQuery>;
    const csv = await svc.exportCrabsCsv(req.user!, systemId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="crabs-export.csv"');
    res.send(csv);
  }),
);

router.post(
  '/',
  validate({ body: crabBody }),
  requireSystemEdit(systemIdFromBody('systemId')),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createCrab(req.body)));
  }),
);

// ลบประวัติแยกโซน 1 รายการ (ข้อ 8) — path 2 segment ไม่ชนกับ '/:id'
router.delete(
  '/history/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteCrabHistory(Number(req.params.id), req.user!);
    res.status(204).end();
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getCrab(Number(req.params.id), req.user!)));
  }),
);

router.patch(
  '/:id',
  validate({ params: idParam, body: crabBody.partial() }),
  requireSystemEdit(systemIdFromCrab),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateCrab(Number(req.params.id), req.body)));
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromCrab),
  asyncHandler(async (req, res) => {
    await svc.deleteCrab(Number(req.params.id));
    res.status(204).end();
  }),
);

export default router;
