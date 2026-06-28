import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { serialize } from '../lib/serialize';
import { idParam } from '../lib/validation';
import {
  requireSystemEdit,
  systemIdFromParam,
  systemIdFromBox,
  systemIdFromFilterTank,
} from '../middleware/auth';
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
  notifyEmail: z.string().email().nullable().optional(), // อีเมลแจ้งเตือนเฉพาะระบบ (ข้อ 4)
  note: z.string().optional(),
});

const boxBody = z.object({
  code: z.string().min(1),
  label: z.string().nullable().optional(),
  color: z.string().max(32).nullable().optional(), // สีพื้นกล่อง (ข้อ 1.11)
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

// สร้างกล่องเป็นตาราง row × column (แถวเป็นตัวอักษร A.. สูงสุด 26 แถว)
const generateGridBody = z.object({
  rows: z.number().int().min(1).max(26),
  cols: z.number().int().min(1).max(50),
})

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
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listSystems(req.user!)));
  }),
);

systemRouter.post(
  '/',
  validate({ body: systemBody }),
  asyncHandler(async (req, res) => {
    // เจ้าของระบบ = ผู้สร้าง (เว้นแต่ระบุ ownerId มาเอง) → ใช้คุมสิทธิ์แก้ไขภายหลัง
    const ownerId = (req.body.ownerId as number | undefined) ?? req.user!.id;
    res.status(201).json(serialize(await svc.createSystem({ ...req.body, ownerId })));
  }),
);

systemRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.getSystem(Number(req.params.id), req.user!)));
  }),
);

systemRouter.patch(
  '/:id',
  validate({ params: idParam, body: systemBody.partial() }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateSystem(Number(req.params.id), req.body)));
  }),
);

systemRouter.delete(
  '/:id',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromParam()),
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
    res.json(serialize(await svc.listBoxes(Number(req.params.id), req.user!)));
  }),
);

systemRouter.post(
  '/:id/boxes',
  validate({ params: idParam, body: boxBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createBox(Number(req.params.id), req.body)));
  }),
);

// สร้างกล่องเป็นชุด (เช่น A1..A30) — สะดวกตอนตั้งระบบ/seed
systemRouter.post(
  '/:id/boxes/generate',
  validate({ params: idParam, body: generateBoxesBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.generateBoxes(Number(req.params.id), req.body));
  }),
);

// สร้างกล่องเป็นตาราง row × column (เช่น 6×5 → A1..F5)
systemRouter.post(
  '/:id/boxes/generate-grid',
  validate({ params: idParam, body: generateGridBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.generateBoxGrid(Number(req.params.id), req.body));
  }),
);

// ── /systems/:id/filter-tanks (nested) ───────────────────────────────
systemRouter.get(
  '/:id/filter-tanks',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.listFilterTanks(Number(req.params.id), req.user!)));
  }),
);

systemRouter.post(
  '/:id/filter-tanks',
  validate({ params: idParam, body: filterTankBody }),
  requireSystemEdit(systemIdFromParam()),
  asyncHandler(async (req, res) => {
    res.status(201).json(serialize(await svc.createFilterTank(Number(req.params.id), req.body)));
  }),
);

// ── /boxes/:id (update/delete รายกล่อง) ──────────────────────────────
export const boxRouter = Router();

boxRouter.patch(
  '/:id',
  validate({ params: idParam, body: boxBody.partial() }),
  requireSystemEdit(systemIdFromBox),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateBox(Number(req.params.id), req.body)));
  }),
);

boxRouter.delete(
  '/:id',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromBox),
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
  requireSystemEdit(systemIdFromFilterTank),
  asyncHandler(async (req, res) => {
    res.json(serialize(await svc.updateFilterTank(Number(req.params.id), req.body)));
  }),
);

filterTankRouter.delete(
  '/:id',
  validate({ params: idParam }),
  requireSystemEdit(systemIdFromFilterTank),
  asyncHandler(async (req, res) => {
    await svc.deleteFilterTank(Number(req.params.id));
    res.status(204).end();
  }),
);
