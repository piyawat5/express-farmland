import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import * as svc from '../services/system.service';

// ════════════════════════════════════════════════════════════════════
//  โมดูล A — CrabSystem / CrabBox / FilterTank
// ════════════════════════════════════════════════════════════════════

// ── schemas ──────────────────────────────────────────────────────────
const systemBody = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  waterVolumeL: z.number().positive().optional(),
  minLevelNote: z.string().optional(),
  maxLevelNote: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  ownerId: z.number().int().positive().optional(),
  note: z.string().optional(),
});

const boxBody = z.object({
  code: z.string().min(1),
  label: z.string().optional(),
  status: z.enum(['EMPTY', 'OCCUPIED']).optional(),
  note: z.string().optional(),
});

const generateBoxesBody = z
  .object({
    prefix: z.string().default('A'),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
    label: z.string().optional(),
  })
  .refine((d) => d.to >= d.from, { message: 'to ต้อง >= from' });

const filterTankBody = z.object({
  name: z.string().min(1),
  mediaType: z.string().optional(),
  cleanIntervalDays: z.number().int().positive().optional(),
  lastCleanedAt: z.coerce.date().optional(),
});

// ── /systems ─────────────────────────────────────────────────────────
export const systemRouter = Router();

systemRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(serialize(await svc.listSystems()));
  }),
);

systemRouter.post(
  '/',
  validate({ body: systemBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createSystem(req.body)));
  }),
);

systemRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getSystem(Number(req.params.id))));
  }),
);

systemRouter.patch(
  '/:id',
  validate({ params: idParam, body: systemBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateSystem(Number(req.params.id), req.body)));
  }),
);

systemRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteSystem(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── /systems/:id/boxes (nested) ──────────────────────────────────────
systemRouter.get(
  '/:id/boxes',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listBoxes(Number(req.params.id))));
  }),
);

systemRouter.post(
  '/:id/boxes',
  validate({ params: idParam, body: boxBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createBox(Number(req.params.id), req.body)));
  }),
);

// สร้างกล่องเป็นชุด (เช่น A1..A30) — สะดวกตอนตั้งระบบ/seed
systemRouter.post(
  '/:id/boxes/generate',
  validate({ params: idParam, body: generateBoxesBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.generateBoxes(Number(req.params.id), req.body));
  }),
);

// ── /systems/:id/filter-tanks (nested) ───────────────────────────────
systemRouter.get(
  '/:id/filter-tanks',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listFilterTanks(Number(req.params.id))));
  }),
);

systemRouter.post(
  '/:id/filter-tanks',
  validate({ params: idParam, body: filterTankBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createFilterTank(Number(req.params.id), req.body)));
  }),
);

// ── /boxes/:id (update/delete รายกล่อง) ──────────────────────────────
export const boxRouter = Router();

boxRouter.patch(
  '/:id',
  validate({ params: idParam, body: boxBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateBox(Number(req.params.id), req.body)));
  }),
);

boxRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteBox(Number(req.params.id));
    res.status(204).end();
  }),
);

// ── /filter-tanks/:id (update/delete รายถัง) ─────────────────────────
export const filterTankRouter = Router();

filterTankRouter.patch(
  '/:id',
  validate({ params: idParam, body: filterTankBody.partial() }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateFilterTank(Number(req.params.id), req.body)));
  }),
);

filterTankRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await svc.deleteFilterTank(Number(req.params.id));
    res.status(204).end();
  }),
);
