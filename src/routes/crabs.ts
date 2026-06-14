import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import * as svc from '../services/crab.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล B — Crab (ปู)
// ════════════════════════════════════════════════════════════════════

const crabType = z.enum(['MEAT', 'EGG', 'UNKNOWN']);
const crabStatus = z.enum(['FATTENING', 'READY', 'SOLD', 'DEAD']);

const crabBody = z.object({
  code: z.string().nullable().optional(),
  systemId: z.number().int().positive(),
  boxId: z.number().int().positive().nullable().optional(),
  type: crabType.optional(),
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

const router = Router();

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { systemId, status, type } = req.query as z.infer<typeof listQuery>;
    res.json(serialize(await svc.listCrabs({ systemId, status, type })));
  }),
);

router.post(
  '/',
  validate({ body: crabBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createCrab(req.body)));
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getCrab(Number(req.params.id))));
  }),
);

router.patch(
  '/:id',
  validate({ params: idParam, body: crabBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateCrab(Number(req.params.id), req.body)));
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteCrab(Number(req.params.id));
    res.status(204).end();
  }),
);

export default router;
